import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, count, eq, lt, sql } from 'drizzle-orm';
import { dueDate, Frequency, payout } from '../common/schedule';
import { DB, Db } from '../db/database.module';
import { contributions, Group, groups, Member, members, Round, rounds } from '../db/schema';
import { commitmentOf, draw, newSeed, verify } from '../draw/draw';
import { CreateGroupDto, DrawDto, MemberDto, StartGroupDto } from './dto';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export interface RoundView {
  number: number;
  dueDate: string;
  status: Round['status'];
  commitment: string;
  /** revealed only after the draw */
  seed: string | null;
  publicEntropy: string | null;
  winner: { id: string; name: string } | null;
  pot: number;
  payout: number | null;
  fee: number | null;
  drawnAt: Date | null;
  paid: { memberId: string; name: string; amount: number; paidAt: Date }[];
  unpaid: { memberId: string; name: string }[];
}

@Injectable()
export class GroupsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ------------------------------------------------------------------ groups

  async create(dto: CreateGroupDto) {
    const id = await this.db.transaction(async (tx) => {
      const [g] = await tx
        .insert(groups)
        .values({
          name: dto.name,
          contribution: dto.contribution,
          frequency: dto.frequency,
          adminFeePct: dto.adminFeePct,
        })
        .returning({ id: groups.id });
      if (dto.members.length) {
        await tx.insert(members).values(dto.members.map((m) => ({ ...m, groupId: g.id })));
      }
      return g.id;
    });
    return this.detail(id);
  }

  async list() {
    const [rows, memberCounts, drawnCounts] = await Promise.all([
      this.db.select().from(groups).orderBy(asc(groups.createdAt)),
      this.db
        .select({ groupId: members.groupId, n: count() })
        .from(members)
        .groupBy(members.groupId),
      this.db
        .select({ groupId: rounds.groupId, n: count() })
        .from(rounds)
        .where(eq(rounds.status, 'drawn'))
        .groupBy(rounds.groupId),
    ]);
    const m = new Map(memberCounts.map((c) => [c.groupId, c.n]));
    const d = new Map(drawnCounts.map((c) => [c.groupId, c.n]));
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      contribution: g.contribution,
      frequency: g.frequency,
      status: g.status,
      members: m.get(g.id) ?? 0,
      roundsDrawn: d.get(g.id) ?? 0,
    }));
  }

  async detail(id: string) {
    const group = await this.group(id);
    const memberRows = await this.members(this.db, id);
    const roundRows = await this.db
      .select()
      .from(rounds)
      .where(eq(rounds.groupId, id))
      .orderBy(asc(rounds.number));
    const byId = new Map(memberRows.map((m) => [m.id, m]));
    const { pot, fee, net } = payout(group.contribution, memberRows.length, group.adminFeePct);
    return {
      ...group,
      members: memberRows.map(({ id, name, phone }) => ({ id, name, phone })),
      potPerRound: pot,
      feePerRound: fee,
      payoutPerRound: net,
      rounds: roundRows.map((r) => ({
        number: r.number,
        dueDate: r.dueDate,
        status: r.status,
        commitment: r.commitment,
        winner: r.winnerId ? { id: r.winnerId, name: byId.get(r.winnerId)?.name ?? '?' } : null,
      })),
    };
  }

  async addMember(groupId: string, dto: MemberDto) {
    const group = await this.group(groupId);
    if (group.status !== 'open') {
      throw new ConflictException('members can only join before the arisan starts');
    }
    try {
      const [m] = await this.db
        .insert(members)
        .values({ ...dto, groupId })
        .returning();
      return { id: m.id, name: m.name, phone: m.phone };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`member "${dto.name}" already exists`);
      throw e;
    }
  }

  async start(groupId: string, dto: StartGroupDto) {
    await this.db.transaction(async (tx) => {
      const group = await this.group(groupId, tx);
      if (group.status !== 'open') throw new ConflictException(`arisan is already ${group.status}`);
      const count = (await this.members(tx, groupId)).length;
      if (count < 2) throw new UnprocessableEntityException('an arisan needs at least 2 members');
      await tx
        .update(groups)
        .set({ status: 'running', startDate: dto.startDate })
        .where(eq(groups.id, groupId));
      await this.openRound(tx, { ...group, startDate: dto.startDate }, 1);
    });
    return this.detail(groupId);
  }

  // ------------------------------------------------------------------ rounds

  async round(groupId: string, number: number): Promise<RoundView> {
    const group = await this.group(groupId);
    const r = await this.findRound(this.db, groupId, number);
    return this.view(this.db, group, r);
  }

  async pay(groupId: string, number: number, memberId: string) {
    const group = await this.group(groupId);
    const r = await this.findRound(this.db, groupId, number);
    if (r.status !== 'collecting') throw new ConflictException(`round ${number} is already drawn`);
    const member = (await this.members(this.db, groupId)).find((m) => m.id === memberId);
    if (!member) throw new NotFoundException('member is not part of this arisan');
    try {
      await this.db
        .insert(contributions)
        .values({ roundId: r.id, memberId, amount: group.contribution });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`${member.name} already paid round ${number}`);
      }
      throw e;
    }
    return this.view(this.db, group, r);
  }

  async draw(groupId: string, number: number, dto: DrawDto): Promise<RoundView> {
    return this.db.transaction(async (tx) => {
      const group = await this.group(groupId, tx);
      const r = await this.findRound(tx, groupId, number, true);
      if (r.status !== 'collecting')
        throw new ConflictException(`round ${number} is already drawn`);
      const current = await this.view(tx, group, r);
      if (current.unpaid.length) {
        throw new ConflictException({
          message: 'everyone must pay before the draw',
          unpaid: current.unpaid.map((m) => m.name),
        });
      }
      const all = await this.members(tx, groupId);
      const eligible = await this.eligibleBefore(tx, groupId, number, all);
      const result = draw({
        seed: r.seed,
        publicEntropy: dto.publicEntropy,
        roundNumber: number,
        eligible: eligible.map((m) => m.id),
      });
      const { fee, net } = payout(group.contribution, all.length, group.adminFeePct);
      const [updated] = await tx
        .update(rounds)
        .set({
          status: 'drawn',
          publicEntropy: dto.publicEntropy,
          winnerId: result.winner,
          payout: net,
          fee,
          drawnAt: new Date(),
        })
        .where(eq(rounds.id, r.id))
        .returning();

      if (eligible.length > 1) {
        await this.openRound(tx, group, number + 1);
      } else {
        await tx.update(groups).set({ status: 'finished' }).where(eq(groups.id, groupId));
      }
      return this.view(tx, group, updated);
    });
  }

  /** Recompute a past draw from the revealed seed — anyone can do this. */
  async verify(groupId: string, number: number) {
    await this.group(groupId);
    const r = await this.findRound(this.db, groupId, number);
    if (r.status !== 'drawn' || !r.winnerId || r.publicEntropy === null) {
      throw new ConflictException('round has not been drawn yet; only the commitment is public');
    }
    const all = await this.members(this.db, groupId);
    const eligible = await this.eligibleBefore(this.db, groupId, number, all);
    const v = verify({
      seed: r.seed,
      commitment: r.commitment,
      publicEntropy: r.publicEntropy,
      roundNumber: number,
      eligible: eligible.map((m) => m.id),
      claimedWinner: r.winnerId,
    });
    return {
      valid: v.valid,
      commitmentMatches: v.commitmentMatches,
      winnerMatches: v.winnerMatches,
      inputs: {
        seed: r.seed,
        commitment: r.commitment,
        publicEntropy: r.publicEntropy,
        eligibleInOrder: v.recomputed.ordered,
      },
      steps: {
        message: v.recomputed.message,
        hmacSha256: v.recomputed.digest,
        index: v.recomputed.index,
        winner: v.recomputed.winner,
      },
      howToCheck:
        'sha256(seed) must equal commitment; HMAC-SHA256(key=seed, message + "|" + attempt) → first 16 hex chars as an unsigned 64-bit integer, modulo the number of eligible members (attempt starts at 0, retried only for the tiny biased range).',
    };
  }

  /** Who paid how much and who received what — the "buku arisan". */
  async ledger(groupId: string) {
    const group = await this.group(groupId);
    const all = await this.members(this.db, groupId);
    const paidRows = await this.db
      .select({
        memberId: contributions.memberId,
        total: sql<number>`sum(${contributions.amount})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(contributions)
      .innerJoin(rounds, eq(rounds.id, contributions.roundId))
      .where(eq(rounds.groupId, groupId))
      .groupBy(contributions.memberId);
    const wins = await this.db
      .select({ memberId: rounds.winnerId, number: rounds.number, payout: rounds.payout })
      .from(rounds)
      .where(and(eq(rounds.groupId, groupId), eq(rounds.status, 'drawn')));
    const paid = new Map(paidRows.map((p) => [p.memberId, p]));
    const won = new Map(wins.map((w) => [w.memberId, w]));
    const totalRounds = all.length;
    const rows = all.map((m) => {
      const p = paid.get(m.id);
      const w = won.get(m.id);
      const contributed = p?.total ?? 0;
      const received = w?.payout ?? 0;
      return {
        memberId: m.id,
        name: m.name,
        roundsPaid: p?.count ?? 0,
        contributed,
        received,
        wonRound: w?.number ?? null,
        net: received - contributed,
        stillOwes: (totalRounds - (p?.count ?? 0)) * group.contribution,
      };
    });
    return {
      group: { id: group.id, name: group.name, status: group.status, totalRounds },
      members: rows,
      totals: {
        contributed: rows.reduce((s, r) => s + r.contributed, 0),
        paidOut: rows.reduce((s, r) => s + r.received, 0),
        fees: wins.length * payout(group.contribution, all.length, group.adminFeePct).fee,
      },
    };
  }

  // ----------------------------------------------------------------- helpers

  private async group(id: string, conn: Conn = this.db): Promise<Group> {
    if (!isUuid(id)) throw new NotFoundException('arisan not found');
    const [g] = await conn.select().from(groups).where(eq(groups.id, id));
    if (!g) throw new NotFoundException('arisan not found');
    return g;
  }

  private members(conn: Conn, groupId: string): Promise<Member[]> {
    return conn
      .select()
      .from(members)
      .where(eq(members.groupId, groupId))
      .orderBy(asc(members.joinedAt), asc(members.name));
  }

  private async findRound(conn: Conn, groupId: string, number: number, lock = false) {
    const q = conn
      .select()
      .from(rounds)
      .where(and(eq(rounds.groupId, groupId), eq(rounds.number, number)));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw new NotFoundException(`round ${number} not found`);
    return r;
  }

  private async eligibleBefore(conn: Conn, groupId: string, number: number, all: Member[]) {
    const previous = await conn
      .select({ winnerId: rounds.winnerId })
      .from(rounds)
      .where(and(eq(rounds.groupId, groupId), lt(rounds.number, number)));
    const winners = new Set(previous.map((p) => p.winnerId));
    return all.filter((m) => !winners.has(m.id));
  }

  private async openRound(conn: Conn, group: Group, number: number) {
    if (!group.startDate) throw new Error('group has no start date');
    const seed = newSeed();
    await conn.insert(rounds).values({
      groupId: group.id,
      number,
      dueDate: dueDate(group.startDate, group.frequency as Frequency, number),
      commitment: commitmentOf(seed),
      seed,
    });
  }

  private async view(conn: Conn, group: Group, r: Round): Promise<RoundView> {
    const all = await this.members(conn, group.id);
    const paidRows = await conn.select().from(contributions).where(eq(contributions.roundId, r.id));
    const paidBy = new Map(paidRows.map((c) => [c.memberId, c]));
    const byId = new Map(all.map((m) => [m.id, m]));
    return {
      number: r.number,
      dueDate: r.dueDate,
      status: r.status,
      commitment: r.commitment,
      seed: r.status === 'drawn' ? r.seed : null,
      publicEntropy: r.publicEntropy,
      winner: r.winnerId ? { id: r.winnerId, name: byId.get(r.winnerId)?.name ?? '?' } : null,
      pot: group.contribution * all.length,
      payout: r.payout,
      fee: r.fee,
      drawnAt: r.drawnAt,
      paid: all
        .filter((m) => paidBy.has(m.id))
        .map((m) => {
          const c = paidBy.get(m.id) as (typeof paidRows)[number];
          return { memberId: m.id, name: m.name, amount: c.amount, paidAt: c.paidAt };
        }),
      unpaid: all.filter((m) => !paidBy.has(m.id)).map((m) => ({ memberId: m.id, name: m.name })),
    };
  }
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}
