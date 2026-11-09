import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, count, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { DB, Db } from '../db/database.module';
import {
  Draw,
  draws,
  Participant,
  Prize,
  participants,
  prizes,
  Ticket,
  tickets,
  Undian,
  undian,
} from '../db/schema';
import { commitmentOf, DRAW_VERSION, draw, newSeed, verify } from '../draw/draw';
import { toCsv } from './csv';
import { CreateUndianDto, DrawDto, ParticipantDto, PrizeDto } from './dto';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export interface DrawView {
  slot: number;
  prize: { id: string; name: string };
  status: 'pending' | 'drawn';
  commitment: string;
  /** revealed only after this slot is drawn */
  seed: string | null;
  publicEntropy: string | null;
  winner: { ticket: string; participantId: string; name: string } | null;
  drawnAt: Date | null;
}

export function ticketCode(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`;
}

@Injectable()
export class UndianService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ------------------------------------------------------------------ undian

  async create(dto: CreateUndianDto) {
    const id = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(undian)
        .values({
          name: dto.name,
          description: dto.description,
          allowMultipleWins: dto.allowMultipleWins,
          ticketPrefix: dto.ticketPrefix,
        })
        .returning();
      if (dto.prizes.length) {
        await tx
          .insert(prizes)
          .values(dto.prizes.map((p, i) => ({ ...p, undianId: u.id, position: i + 1 })));
      }
      for (const p of dto.participants) await this.insertParticipant(tx, u, p);
      return u.id;
    });
    return this.detail(id);
  }

  async list() {
    const [rows, participantCounts, ticketCounts, drawn] = await Promise.all([
      this.db.select().from(undian).orderBy(asc(undian.createdAt)),
      this.countBy(participants.undianId, participants),
      this.countBy(tickets.undianId, tickets),
      this.db
        .select({ undianId: draws.undianId, n: count() })
        .from(draws)
        .where(isNotNull(draws.ticketId))
        .groupBy(draws.undianId),
    ]);
    const p = new Map(participantCounts.map((c) => [c.undianId, c.n]));
    const t = new Map(ticketCounts.map((c) => [c.undianId, c.n]));
    const d = new Map(drawn.map((c) => [c.undianId, c.n]));
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      status: u.status,
      participants: p.get(u.id) ?? 0,
      tickets: t.get(u.id) ?? 0,
      drawn: d.get(u.id) ?? 0,
    }));
  }

  async detail(id: string) {
    const u = await this.undian(id);
    const [prizeRows, people, ticketRows, drawRows] = await Promise.all([
      this.prizes(this.db, id),
      this.participants(this.db, id),
      this.tickets(this.db, id),
      this.draws(this.db, id),
    ]);
    const codesOf = groupBy(ticketRows, (t) => t.participantId);
    const views = this.views(prizeRows, people, ticketRows, drawRows);
    return {
      ...u,
      prizes: prizeRows.map(({ id, name, quantity, position }) => ({
        id,
        name,
        quantity,
        position,
      })),
      // registration order = order of the first ticket (codes are sequential)
      participants: sortBy(people, (p) => codesOf.get(p.id)?.[0]?.code ?? '').map(
        ({ id, name, contact }) => ({
          id,
          name,
          contact,
          tickets: (codesOf.get(id) ?? []).map((t) => t.code),
        }),
      ),
      totals: {
        participants: people.length,
        tickets: ticketRows.length,
        prizeUnits: prizeRows.reduce((s, p) => s + p.quantity, 0),
        drawn: drawRows.filter((d) => d.ticketId).length,
      },
      draws: views.map(({ seed: _seed, ...rest }) => rest), // seeds only via the draw endpoints
    };
  }

  async addParticipant(id: string, dto: ParticipantDto) {
    return this.db.transaction(async (tx) => {
      const u = await this.undian(id, tx, true);
      this.assertDraft(u, 'participants can only register before the undian is locked');
      try {
        return await this.insertParticipant(tx, u, dto);
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ConflictException(`participant "${dto.name}" is already registered`);
        }
        throw e;
      }
    });
  }

  async addPrize(id: string, dto: PrizeDto) {
    return this.db.transaction(async (tx) => {
      const u = await this.undian(id, tx, true);
      this.assertDraft(u, 'prizes can only be added before the undian is locked');
      const existing = await this.prizes(tx, id);
      const [p] = await tx
        .insert(prizes)
        .values({ ...dto, undianId: id, position: existing.length + 1 })
        .returning();
      return { id: p.id, name: p.name, quantity: p.quantity, position: p.position };
    });
  }

  /** Close registration and publish one sha256 commitment per prize unit. */
  async lock(id: string) {
    await this.db.transaction(async (tx) => {
      const u = await this.undian(id, tx, true);
      this.assertDraft(u, `undian is already ${u.status}`);
      const prizeRows = await this.prizes(tx, id);
      const units = prizeRows.reduce((s, p) => s + p.quantity, 0);
      if (units === 0) throw new UnprocessableEntityException('add at least one prize first');
      const people = (await this.participants(tx, id)).length;
      const entries = (await this.tickets(tx, id)).length;
      const needed = u.allowMultipleWins ? entries : people;
      if (needed < units) {
        throw new UnprocessableEntityException(
          u.allowMultipleWins
            ? `${units} prizes but only ${entries} tickets`
            : `${units} prizes but only ${people} participants (each can win once)`,
        );
      }
      let slot = 0;
      const rows = prizeRows.flatMap((p) =>
        Array.from({ length: p.quantity }, () => {
          const seed = newSeed();
          slot += 1;
          return { undianId: id, prizeId: p.id, slot, seed, commitment: commitmentOf(seed) };
        }),
      );
      await tx.insert(draws).values(rows);
      await tx
        .update(undian)
        .set({ status: 'locked', lockedAt: new Date() })
        .where(eq(undian.id, id));
    });
    return this.detail(id);
  }

  // ------------------------------------------------------------------- draws

  /** Draw the next pending slot, reveal its seed, finish the undian after the last one. */
  async drawNext(id: string, dto: DrawDto): Promise<DrawView> {
    return this.db.transaction(async (tx) => {
      const u = await this.undian(id, tx, true);
      if (u.status === 'draft') throw new ConflictException('lock the undian before drawing');
      if (u.status === 'finished') throw new ConflictException('every prize has been drawn');
      const [next] = await tx
        .select()
        .from(draws)
        .where(and(eq(draws.undianId, id), isNull(draws.ticketId)))
        .orderBy(asc(draws.slot))
        .limit(1)
        .for('update');
      /* c8 ignore next */
      if (!next) throw new ConflictException('every prize has been drawn');

      const eligible = await this.eligibleBefore(tx, u, next.slot);
      const result = draw({
        seed: next.seed,
        publicEntropy: dto.publicEntropy,
        slot: next.slot,
        eligible: eligible.map((t) => t.code),
      });
      const winner = eligible.find((t) => t.code === result.winner) as Ticket;
      await tx
        .update(draws)
        .set({ publicEntropy: dto.publicEntropy.trim(), ticketId: winner.id, drawnAt: new Date() })
        .where(eq(draws.id, next.id));

      const [{ n: pending }] = await tx
        .select({ n: count() })
        .from(draws)
        .where(and(eq(draws.undianId, id), isNull(draws.ticketId)));
      if (pending === 0) {
        await tx.update(undian).set({ status: 'finished' }).where(eq(undian.id, id));
      }
      return this.drawView(tx, id, next.slot);
    });
  }

  async getDraw(id: string, slot: number) {
    await this.undian(id);
    return this.drawView(this.db, id, slot);
  }

  /** Recompute a past draw from the revealed seed — anyone can do this. */
  async verify(id: string, slot: number) {
    const u = await this.undian(id);
    const d = await this.findDraw(this.db, id, slot);
    if (!d.ticketId || d.publicEntropy === null) {
      throw new ConflictException('slot has not been drawn yet; only the commitment is public');
    }
    const eligible = await this.eligibleBefore(this.db, u, slot);
    const [won] = await this.db.select().from(tickets).where(eq(tickets.id, d.ticketId));
    const v = verify({
      seed: d.seed,
      commitment: d.commitment,
      publicEntropy: d.publicEntropy,
      slot,
      eligible: eligible.map((t) => t.code),
      claimedWinner: won.code,
    });
    return {
      valid: v.valid,
      commitmentMatches: v.commitmentMatches,
      winnerMatches: v.winnerMatches,
      inputs: {
        version: DRAW_VERSION,
        slot,
        seed: d.seed,
        commitment: d.commitment,
        publicEntropy: d.publicEntropy,
        eligibleInOrder: v.recomputed.ordered,
      },
      steps: {
        message: v.recomputed.message,
        hmacSha256: v.recomputed.digest,
        attempts: v.recomputed.attempts,
        index: v.recomputed.index,
        winner: v.recomputed.winner,
      },
      howToCheck:
        'sha256(seed) must equal commitment; HMAC-SHA256(key=seed, message + "|" + attempt) → first 16 hex chars as an unsigned 64-bit integer; if it is below 2^64 - (2^64 mod #tickets) take it modulo the number of eligible tickets, otherwise try the next attempt (starting at 0).',
    };
  }

  /** Winners per prize, in draw order. */
  async results(id: string) {
    const u = await this.undian(id);
    const [prizeRows, people, ticketRows, drawRows] = await Promise.all([
      this.prizes(this.db, id),
      this.participants(this.db, id),
      this.tickets(this.db, id),
      this.draws(this.db, id),
    ]);
    const views = this.views(prizeRows, people, ticketRows, drawRows);
    const contactOf = new Map(people.map((p) => [p.id, p.contact]));
    return {
      undian: { id: u.id, name: u.name, status: u.status },
      prizes: prizeRows.map((p) => {
        const mine = views.filter((v) => v.prize.id === p.id);
        return {
          name: p.name,
          quantity: p.quantity,
          winners: mine
            .filter((v) => v.winner)
            .map((v) => ({
              slot: v.slot,
              ticket: v.winner?.ticket,
              name: v.winner?.name,
              contact: contactOf.get(v.winner?.participantId ?? '') ?? '',
            })),
          pending: mine.filter((v) => !v.winner).length,
        };
      }),
    };
  }

  /** Same as results, flattened to CSV with everything needed to re-verify each draw. */
  async resultsCsv(id: string) {
    await this.undian(id);
    const [prizeRows, people, ticketRows, drawRows] = await Promise.all([
      this.prizes(this.db, id),
      this.participants(this.db, id),
      this.tickets(this.db, id),
      this.draws(this.db, id),
    ]);
    const rows = this.views(prizeRows, people, ticketRows, drawRows)
      .filter((v) => v.winner)
      .map((v) => [
        v.slot,
        v.prize.name,
        v.winner?.ticket,
        v.winner?.name,
        v.drawnAt?.toISOString(),
        v.publicEntropy,
        v.commitment,
        v.seed,
      ]);
    return toCsv(
      ['slot', 'prize', 'ticket', 'winner', 'drawn_at', 'public_entropy', 'commitment', 'seed'],
      rows,
    );
  }

  /** "Cek nomor undian": whose ticket is this and did it win? */
  async ticket(id: string, code: string) {
    await this.undian(id);
    const [t] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.undianId, id), eq(tickets.code, code.trim().toUpperCase())));
    if (!t) throw new NotFoundException(`ticket ${code} not found`);
    const [owner] = await this.db
      .select()
      .from(participants)
      .where(eq(participants.id, t.participantId));
    const [won] = await this.db
      .select({ slot: draws.slot, prize: prizes.name })
      .from(draws)
      .innerJoin(prizes, eq(prizes.id, draws.prizeId))
      .where(eq(draws.ticketId, t.id));
    return { ticket: t.code, participant: owner.name, won: won ?? null };
  }

  // ----------------------------------------------------------------- helpers

  private async insertParticipant(tx: Tx, u: Undian, dto: ParticipantDto) {
    const [p] = await tx
      .insert(participants)
      .values({ undianId: u.id, name: dto.name, contact: dto.contact })
      .returning();
    const [{ n }] = await tx.select({ n: count() }).from(tickets).where(eq(tickets.undianId, u.id));
    const rows = Array.from({ length: dto.tickets }, (_, i) => ({
      undianId: u.id,
      participantId: p.id,
      code: ticketCode(u.ticketPrefix, n + i + 1),
    }));
    const inserted = await tx.insert(tickets).values(rows).returning();
    return { id: p.id, name: p.name, contact: p.contact, tickets: inserted.map((t) => t.code) };
  }

  private assertDraft(u: Undian, message: string) {
    if (u.status !== 'draft') throw new ConflictException(message);
  }

  private async undian(id: string, conn: Conn = this.db, lock = false): Promise<Undian> {
    if (!isUuid(id)) throw new NotFoundException('undian not found');
    const q = conn.select().from(undian).where(eq(undian.id, id));
    const [u] = lock ? await q.for('update') : await q;
    if (!u) throw new NotFoundException('undian not found');
    return u;
  }

  private countBy(
    col: typeof participants.undianId | typeof tickets.undianId,
    table: typeof participants | typeof tickets,
  ) {
    return this.db.select({ undianId: col, n: count() }).from(table).groupBy(col);
  }

  private prizes(conn: Conn, id: string): Promise<Prize[]> {
    return conn.select().from(prizes).where(eq(prizes.undianId, id)).orderBy(asc(prizes.position));
  }

  private participants(conn: Conn, id: string): Promise<Participant[]> {
    return conn
      .select()
      .from(participants)
      .where(eq(participants.undianId, id))
      .orderBy(asc(participants.createdAt), asc(participants.name));
  }

  private tickets(conn: Conn, id: string): Promise<Ticket[]> {
    return conn.select().from(tickets).where(eq(tickets.undianId, id)).orderBy(asc(tickets.code));
  }

  private draws(conn: Conn, id: string): Promise<Draw[]> {
    return conn.select().from(draws).where(eq(draws.undianId, id)).orderBy(asc(draws.slot));
  }

  private async findDraw(conn: Conn, id: string, slot: number) {
    const [d] = await conn
      .select()
      .from(draws)
      .where(and(eq(draws.undianId, id), eq(draws.slot, slot)));
    if (!d) throw new NotFoundException(`draw slot ${slot} not found`);
    return d;
  }

  /**
   * Tickets that could win `slot`: every ticket that has not won an earlier slot and, unless
   * multiple wins are allowed, whose owner has not won yet either.
   */
  private async eligibleBefore(conn: Conn, u: Undian, slot: number): Promise<Ticket[]> {
    const all = await this.tickets(conn, u.id);
    const earlier = await conn
      .select({ ticketId: draws.ticketId })
      .from(draws)
      .where(and(eq(draws.undianId, u.id), lt(draws.slot, slot), isNotNull(draws.ticketId)));
    const wonTickets = new Set(earlier.map((d) => d.ticketId));
    const wonPeople = new Set(all.filter((t) => wonTickets.has(t.id)).map((t) => t.participantId));
    return all.filter(
      (t) => !wonTickets.has(t.id) && (u.allowMultipleWins || !wonPeople.has(t.participantId)),
    );
  }

  private async drawView(conn: Conn, id: string, slot: number): Promise<DrawView> {
    const d = await this.findDraw(conn, id, slot);
    const [prizeRows, people, ticketRows] = await Promise.all([
      this.prizes(conn, id),
      this.participants(conn, id),
      this.tickets(conn, id),
    ]);
    return this.views(prizeRows, people, ticketRows, [d])[0];
  }

  private views(
    prizeRows: Prize[],
    people: Participant[],
    ticketRows: Ticket[],
    drawRows: Draw[],
  ): DrawView[] {
    const prizeById = new Map(prizeRows.map((p) => [p.id, p]));
    const personById = new Map(people.map((p) => [p.id, p]));
    const ticketById = new Map(ticketRows.map((t) => [t.id, t]));
    return drawRows.map((d) => {
      const t = d.ticketId ? ticketById.get(d.ticketId) : undefined;
      const prize = prizeById.get(d.prizeId) as Prize;
      return {
        slot: d.slot,
        prize: { id: prize.id, name: prize.name },
        status: t ? 'drawn' : 'pending',
        commitment: d.commitment,
        seed: t ? d.seed : null,
        publicEntropy: d.publicEntropy,
        winner: t
          ? {
              ticket: t.code,
              participantId: t.participantId,
              name: personById.get(t.participantId)?.name ?? '?',
            }
          : null,
        drawnAt: d.drawnAt,
      };
    });
  }
}

function sortBy<T>(list: T[], key: (x: T) => string): T[] {
  return [...list].sort((a, b) => key(a).localeCompare(key(b)));
}

function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}
