import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configure } from '../src/bootstrap';

describe('Arisan API (e2e, in-memory Postgres via PGlite)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    delete process.env.PGLITE_DIR;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configure(moduleRef.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  const names = ['Bu Sri', 'Bu Ani', 'Pak Budi', 'Mbak Rina'];

  async function newGroup(overrides: Record<string, unknown> = {}) {
    const res = await http
      .post('/groups')
      .send({
        name: 'Arisan PKK RT 05',
        contribution: 100_000,
        frequency: 'monthly',
        adminFeePct: 2.5,
        members: names.map((name) => ({ name })),
        ...overrides,
      })
      .expect(201);
    return res.body;
  }

  async function payAll(id: string, n: number) {
    const round = (await http.get(`/groups/${id}/rounds/${n}`).expect(200)).body;
    for (const m of round.unpaid) {
      await http
        .post(`/groups/${id}/rounds/${n}/contributions`)
        .send({ memberId: m.memberId })
        .expect(201);
    }
  }

  it('health', () => http.get('/health').expect(200, { status: 'ok' }));

  it('serves OpenAPI docs generated from the Zod schemas', async () => {
    const res = await http.get('/docs-json').expect(200);
    expect(res.body.paths['/groups/{id}/rounds/{n}/draw']).toBeDefined();
    const body = res.body.paths['/groups'].post.requestBody.content['application/json'].schema;
    expect(body.properties.frequency.enum).toEqual(['weekly', 'monthly']);
  });

  it('validates input with field-level errors', async () => {
    const res = await http
      .post('/groups')
      .send({
        name: '',
        contribution: 10,
        frequency: 'daily',
        members: [{ name: 'A' }, { name: 'a' }],
      })
      .expect(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'contribution', 'frequency']));
    await http.get('/groups/not-a-uuid').expect(404);
  });

  it('runs a whole arisan: every member wins exactly once, the books balance', async () => {
    const g = await newGroup();
    expect(g).toMatchObject({
      status: 'open',
      potPerRound: 400_000,
      feePerRound: 10_000,
      payoutPerRound: 390_000,
    });

    await http
      .post(`/groups/${g.id}/members`)
      .send({ name: 'Mas Dimas', phone: '0812-3456-7890' })
      .expect(201);
    await http.post(`/groups/${g.id}/members`).send({ name: 'Mas Dimas' }).expect(409);

    const started = (
      await http.post(`/groups/${g.id}/start`).send({ startDate: '2026-01-31' }).expect(200)
    ).body;
    expect(started.status).toBe('running');
    expect(started.rounds).toHaveLength(1);
    await http.post(`/groups/${g.id}/members`).send({ name: 'Telat' }).expect(409);
    await http.post(`/groups/${g.id}/start`).send({ startDate: '2026-02-01' }).expect(409);

    const winners: string[] = [];
    for (let n = 1; n <= 5; n++) {
      const before = (await http.get(`/groups/${g.id}/rounds/${n}`).expect(200)).body;
      expect(before.seed).toBeNull(); // secret until the draw
      expect(before.commitment).toMatch(/^[0-9a-f]{64}$/);
      if (n === 2) expect(before.dueDate).toBe('2026-02-28');

      await payAll(g.id, n);
      const drawn = (
        await http
          .post(`/groups/${g.id}/rounds/${n}/draw`)
          .send({ publicEntropy: `angka ${n * 7} ${n * 13}` })
          .expect(200)
      ).body;
      expect(drawn.status).toBe('drawn');
      expect(createHash('sha256').update(drawn.seed).digest('hex')).toBe(before.commitment);
      expect(drawn).toMatchObject({ payout: 487_500, fee: 12_500 });
      winners.push(drawn.winner.id);
    }
    expect(new Set(winners).size).toBe(5);

    const detail = (await http.get(`/groups/${g.id}`).expect(200)).body;
    expect(detail.status).toBe('finished');
    expect(detail.rounds).toHaveLength(5);

    const ledger = (await http.get(`/groups/${g.id}/ledger`).expect(200)).body;
    expect(ledger.totals).toEqual({ contributed: 2_500_000, paidOut: 2_437_500, fees: 62_500 });
    for (const m of ledger.members) {
      expect(m).toMatchObject({
        roundsPaid: 5,
        contributed: 500_000,
        received: 487_500,
        net: -12_500,
        stillOwes: 0,
      });
    }
    const list = (await http.get('/groups').expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === g.id)).toMatchObject({
      members: 5,
      roundsDrawn: 5,
    });
  });

  it('refuses to draw until everyone has paid, and rejects double payments', async () => {
    const g = await newGroup({ frequency: 'weekly', adminFeePct: 0 });
    await http.post(`/groups/${g.id}/start`).send({ startDate: '2026-11-09' }).expect(200);
    const round = (await http.get(`/groups/${g.id}/rounds/1`)).body;
    const first = round.unpaid[0].memberId;
    await http.post(`/groups/${g.id}/rounds/1/contributions`).send({ memberId: first }).expect(201);
    await http.post(`/groups/${g.id}/rounds/1/contributions`).send({ memberId: first }).expect(409);

    const blocked = await http
      .post(`/groups/${g.id}/rounds/1/draw`)
      .send({ publicEntropy: 'satu dua tiga' })
      .expect(409);
    expect(blocked.body.unpaid).toHaveLength(3);

    await http
      .post(`/groups/${g.id}/rounds/1/contributions`)
      .send({ memberId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    await http.post(`/groups/${g.id}/rounds/1/draw`).send({ publicEntropy: 'x' }).expect(400);
    await http.get(`/groups/${g.id}/rounds/1/verify`).expect(409);
    await http.get(`/groups/${g.id}/rounds/9`).expect(404);

    await payAll(g.id, 1);
    await http
      .post(`/groups/${g.id}/rounds/1/draw`)
      .send({ publicEntropy: 'satu dua tiga' })
      .expect(200);
    await http.post(`/groups/${g.id}/rounds/1/draw`).send({ publicEntropy: 'again' }).expect(409);
    const r2 = (await http.get(`/groups/${g.id}/rounds/2`).expect(200)).body;
    expect(r2.dueDate).toBe('2026-11-16');
  });

  it('a draw can be verified independently from the published data', async () => {
    const g = await newGroup();
    await http.post(`/groups/${g.id}/start`).send({ startDate: '2026-12-01' }).expect(200);
    await payAll(g.id, 1);
    const drawn = (
      await http.post(`/groups/${g.id}/rounds/1/draw`).send({ publicEntropy: '17 08 45' })
    ).body;
    const v = (await http.get(`/groups/${g.id}/rounds/1/verify`).expect(200)).body;
    expect(v).toMatchObject({ valid: true, commitmentMatches: true, winnerMatches: true });

    // recompute by hand, exactly as documented, without using the app's code
    const { seed, eligibleInOrder } = v.inputs;
    const message = `undian-v1|1|17 08 45|${eligibleInOrder.join(',')}`;
    const digest = createHmac('sha256', seed).update(`${message}|0`).digest('hex');
    const index = Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(eligibleInOrder.length));
    expect(eligibleInOrder[index]).toBe(drawn.winner.id);
  });

  it('needs at least two members to start', async () => {
    const g = await newGroup({ members: [{ name: 'Sendirian' }] });
    await http.post(`/groups/${g.id}/start`).send({ startDate: '2026-12-01' }).expect(422);
    await http.post(`/groups/${g.id}/start`).send({ startDate: '01-12-2026' }).expect(400);
  });
});
