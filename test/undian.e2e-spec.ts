import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configure } from '../src/bootstrap';

describe('Undian API (e2e, in-memory Postgres via PGlite)', () => {
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

  const people = ['Bu Sri', 'Bu Ani', 'Pak Budi', 'Mbak Rina', 'Mas Dimas', 'Pak RT'];

  async function newUndian(overrides: Record<string, unknown> = {}) {
    const res = await http
      .post('/undian')
      .send({
        name: 'Doorprize 17 Agustus RT 05',
        prizes: [
          { name: 'Payung', quantity: 2 },
          { name: 'Kipas angin', quantity: 1 },
          { name: 'Sepeda', quantity: 1 },
        ],
        participants: people.map((name) => ({ name })),
        ...overrides,
      })
      .expect(201);
    return res.body;
  }

  it('health', () => http.get('/health').expect(200, { status: 'ok' }));

  it('serves OpenAPI docs generated from the Zod schemas', async () => {
    const res = await http.get('/docs-json').expect(200);
    expect(res.body.info.title).toBe('Undian API');
    expect(res.body.paths['/undian/{id}/draw']).toBeDefined();
    expect(res.body.paths['/undian/{id}/draws/{slot}/verify']).toBeDefined();
    const body = res.body.paths['/undian'].post.requestBody.content['application/json'].schema;
    expect(body.properties.allowMultipleWins.type).toBe('boolean');
  });

  it('validates input with field-level errors', async () => {
    const res = await http
      .post('/undian')
      .send({
        name: '',
        ticketPrefix: 'doorprize',
        prizes: [{ name: 'X', quantity: 0 }],
        participants: [{ name: 'A' }, { name: 'a' }],
      })
      .expect(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['name', 'ticketPrefix', 'prizes.0.quantity', 'participants']),
    );
    await http.get('/undian/not-a-uuid').expect(404);
  });

  it('runs a whole doorprize: one prize per person, every seed matches its commitment', async () => {
    const u = await newUndian();
    expect(u).toMatchObject({
      status: 'draft',
      totals: { participants: 6, tickets: 6, prizeUnits: 4, drawn: 0 },
    });
    expect(u.participants[0].tickets).toEqual(['T0001']);

    const late = (
      await http
        .post(`/undian/${u.id}/participants`)
        .send({ name: 'Bu Lurah', tickets: 2 })
        .expect(201)
    ).body;
    expect(late.tickets).toEqual(['T0007', 'T0008']);
    await http.post(`/undian/${u.id}/participants`).send({ name: 'Bu Lurah' }).expect(409);
    await http
      .post(`/undian/${u.id}/prizes`)
      .send({ name: 'Voucher pulsa', quantity: 2 })
      .expect(201);
    await http.post(`/undian/${u.id}/draw`).send({ publicEntropy: 'terlalu cepat' }).expect(409);

    const locked = (await http.post(`/undian/${u.id}/lock`).expect(200)).body;
    expect(locked.status).toBe('locked');
    expect(locked.draws.map((d: { prize: { name: string } }) => d.prize.name)).toEqual([
      'Payung',
      'Payung',
      'Kipas angin',
      'Sepeda',
      'Voucher pulsa',
      'Voucher pulsa',
    ]);
    expect(locked.draws[0].seed).toBeUndefined(); // never in the detail view
    await http.post(`/undian/${u.id}/lock`).expect(409);
    await http.post(`/undian/${u.id}/participants`).send({ name: 'Telat' }).expect(409);
    await http.post(`/undian/${u.id}/prizes`).send({ name: 'Telat' }).expect(409);

    const winners: string[] = [];
    for (let slot = 1; slot <= 6; slot++) {
      const before = (await http.get(`/undian/${u.id}/draws/${slot}`).expect(200)).body;
      expect(before).toMatchObject({ status: 'pending', seed: null, winner: null });
      const drawn = (
        await http
          .post(`/undian/${u.id}/draw`)
          .send({ publicEntropy: `angka ${slot * 7} ${slot * 13}` })
          .expect(200)
      ).body;
      expect(drawn.slot).toBe(slot);
      expect(createHash('sha256').update(drawn.seed).digest('hex')).toBe(before.commitment);
      winners.push(drawn.winner.name);
    }
    expect(new Set(winners).size).toBe(6); // nobody wins twice
    await http.post(`/undian/${u.id}/draw`).send({ publicEntropy: 'lagi dong' }).expect(409);

    const detail = (await http.get(`/undian/${u.id}`).expect(200)).body;
    expect(detail.status).toBe('finished');
    expect(detail.totals.drawn).toBe(6);

    const results = (await http.get(`/undian/${u.id}/results`).expect(200)).body;
    expect(results.prizes.map((p: { winners: unknown[] }) => p.winners.length)).toEqual([
      2, 1, 1, 2,
    ]);
    expect(results.prizes.every((p: { pending: number }) => p.pending === 0)).toBe(true);

    const list = (await http.get('/undian').expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === u.id)).toMatchObject({
      participants: 7,
      tickets: 8,
      drawn: 6,
    });
  });

  it('a draw can be verified by hand from the published data', async () => {
    const u = await newUndian({ prizes: [{ name: 'Kulkas' }] });
    await http.post(`/undian/${u.id}/lock`).expect(200);
    await http.get(`/undian/${u.id}/draws/1/verify`).expect(409); // not drawn yet
    const drawn = (await http.post(`/undian/${u.id}/draw`).send({ publicEntropy: ' 17 08 45 ' }))
      .body;
    expect(drawn.publicEntropy).toBe('17 08 45');

    const v = (await http.get(`/undian/${u.id}/draws/1/verify`).expect(200)).body;
    expect(v).toMatchObject({ valid: true, commitmentMatches: true, winnerMatches: true });

    // recompute exactly as documented, using nothing but node:crypto
    const { seed, eligibleInOrder } = v.inputs;
    const message = `undian-v1|1|17 08 45|${eligibleInOrder.join(',')}`;
    const digest = createHmac('sha256', seed).update(`${message}|0`).digest('hex');
    const index = Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(eligibleInOrder.length));
    expect(eligibleInOrder[index]).toBe(drawn.winner.ticket);

    const csv = await http.get(`/undian/${u.id}/results.csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const [header, row] = csv.text.trim().split('\r\n');
    expect(header).toBe('slot,prize,ticket,winner,drawn_at,public_entropy,commitment,seed');
    expect(row).toContain(`1,Kulkas,${drawn.winner.ticket},${drawn.winner.name},`);
    expect(row.endsWith(seed)).toBe(true);
  });

  it('weights by tickets, allows repeat winners only when enabled, and checks tickets', async () => {
    const u = await newUndian({
      name: 'Giveaway',
      ticketPrefix: 'GA',
      allowMultipleWins: true,
      prizes: [{ name: 'Stiker', quantity: 3 }],
      participants: [
        { name: 'Andi', tickets: 2 },
        { name: 'Budi', tickets: 1 },
      ],
    });
    expect(u.participants.map((p: { tickets: string[] }) => p.tickets)).toEqual([
      ['GA0001', 'GA0002'],
      ['GA0003'],
    ]);
    await http.post(`/undian/${u.id}/lock`).expect(200);
    for (let i = 0; i < 3; i++) {
      await http
        .post(`/undian/${u.id}/draw`)
        .send({ publicEntropy: `putaran ${i}` })
        .expect(200);
    }
    // every ticket wins once, so Andi wins twice
    const results = (await http.get(`/undian/${u.id}/results`).expect(200)).body;
    const names = results.prizes[0].winners.map((w: { name: string }) => w.name).sort();
    expect(names).toEqual(['Andi', 'Andi', 'Budi']);

    const t = (await http.get(`/undian/${u.id}/tickets/ga0003`).expect(200)).body;
    expect(t).toMatchObject({ ticket: 'GA0003', participant: 'Budi', won: { prize: 'Stiker' } });
    await http.get(`/undian/${u.id}/tickets/GA9999`).expect(404);
    await http.get(`/undian/${u.id}/draws/9`).expect(404);
  });

  it('refuses to lock without prizes or with more prizes than possible winners', async () => {
    const none = await newUndian({ prizes: [] });
    await http.post(`/undian/${none.id}/lock`).expect(422);

    const tooMany = await newUndian({ prizes: [{ name: 'Payung', quantity: 7 }] });
    const res = await http.post(`/undian/${tooMany.id}/lock`).expect(422);
    expect(res.body.message).toMatch(/7 prizes but only 6 participants/);

    await http.post(`/undian/${tooMany.id}/draw`).send({ publicEntropy: 'x' }).expect(400);
  });
});
