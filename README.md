# undian

**A ready-to-use template for fair draws: doorprizes, giveaways, lucky draws and raffles.
Anyone can check the result afterwards.**

Every *undian* has the same weak spot: the draw itself. Rolled-up papers in a jar, a spinning wheel
on someone's laptop, "the system picked it". `undian` is a small REST API you can fork for any
event. It keeps the prizes, participants and tickets, and it makes every draw **provably fair**
with a commit–reveal scheme.

![Swagger UI](docs/swagger.png)

## How the fair draw works

```
lock        registration closes. One prize unit = one draw slot.
            For every slot the server picks a random 256-bit seed and publishes only
            commitment = sha256(seed). From now on nobody can change the seeds.
draw        the audience supplies public entropy, e.g. numbers shouted in the room
            digest = HMAC-SHA256(key = seed, "undian-v1|slot|entropy|sorted ticket codes|attempt")
            index  = first 64 bits of digest mod #eligible tickets   (rejection sampling, so no modulo bias)
            winner = tickets[index]; this slot's seed is revealed
verify      anyone checks sha256(seed) == commitment and recomputes the winner
```

The organiser can't pick the winner, because the seed was fixed before the entropy was known.
The audience can't pick it either, because they don't know the seed. Every slot has its own seed,
so revealing one draw tells nobody anything about the next one.
`GET /undian/:id/draws/:slot/verify` returns every input and intermediate value. The e2e test
recomputes a draw using nothing but `node:crypto`.

## Features

- **Prizes in draw order.** Each prize can have a quantity (e.g. 3× voucher). Small prizes usually go first and the grand prize last.
- **Tickets.** A participant can hold several tickets (`tickets: 3` gives 3× the chance).
  Codes are sequential with a prefix you choose: `T0001`, `DP0042`, …
- **One prize per person** by default. Set `allowMultipleWins: true` for giveaways where every ticket counts.
- **Lock** checks that the draw can finish: you need at least as many participants (or tickets) as prize units.
- **Results** come as JSON per prize, or as **CSV** with the seed and entropy of every draw,
  so the results sheet can be re-verified offline.
- **Cek nomor undian:** `GET /undian/:id/tickets/:code` shows who owns a ticket and what it won.
- Input is validated with **Zod**, and the same schemas generate the **OpenAPI** docs at `/docs`.
- The database is **PGlite**, Postgres compiled to WebAssembly, so you get real Postgres
  constraints, enums, transactions and `SELECT … FOR UPDATE` without installing a database
  server. It runs in memory for tests and on disk in dev.

## Use it as a template

| Event | Settings |
|---|---|
| Doorprize at a 17 Agustus / office party | default: one prize per person, 1 ticket each |
| Giveaway on social media | `allowMultipleWins: true`, tickets = number of valid entries |
| Lucky draw for customers | `ticketPrefix: "LD"`, tickets = number of purchases |
| Arisan (who gets the pot this round) | one prize of quantity 1 per meeting, members as participants |

To make it your own, start with the names and texts in `src/bootstrap.ts` and the defaults in
`src/undian/dto.ts`. The draw (`src/draw/draw.ts`) is pure and has no I/O, so you can reuse it
anywhere.

## Stack

NestJS 11 · Drizzle ORM · PGlite · Zod 4 · Swagger · Jest + Supertest · Biome

```
src/
├── draw/draw.ts              commit–reveal draw, unbiased index, verification (pure, no I/O)
├── common/zod.pipe.ts        Zod validation pipe + Zod → OpenAPI
├── db/schema.ts              Drizzle schema (undian, participants, tickets, prizes, draws)
├── db/database.module.ts     PGlite + migrations as a Nest provider
└── undian/                   controller, service, DTO schemas, CSV export
drizzle/                      generated SQL migrations
test/undian.e2e-spec.ts       full doorprize lifecycle over HTTP against in-memory Postgres
```

## Run

```bash
npm install
npm run dev        # http://localhost:3000, Swagger at /docs, data in ./data/pglite
npm run demo       # in another terminal: creates a doorprize, locks it, draws and verifies every prize
npm test           # 21 tests (unit + e2e)
```

Example:

```bash
curl -X POST localhost:3000/undian -H 'content-type: application/json' -d '{
  "name": "Doorprize 17 Agustus RT 05",
  "prizes": [{"name": "Payung", "quantity": 2}, {"name": "Sepeda"}],
  "participants": [{"name": "Bu Sri"}, {"name": "Pak Budi", "tickets": 2}, {"name": "Mbak Rina"}]
}'
```

| Method | Path | |
|---|---|---|
| `POST` | `/undian` | create (+ prizes, participants) |
| `POST` | `/undian/:id/participants` | register participant + tickets (draft only) |
| `POST` | `/undian/:id/prizes` | add prize (draft only) |
| `POST` | `/undian/:id/lock` | close registration, publish commitments |
| `POST` | `/undian/:id/draw` | draw the next slot, reveal its seed |
| `GET` | `/undian/:id/draws/:slot` | one slot: prize, commitment, result |
| `GET` | `/undian/:id/draws/:slot/verify` | recompute & verify |
| `GET` | `/undian/:id/results` · `results.csv` | winners per prize |
| `GET` | `/undian/:id/tickets/:code` | cek nomor undian |

## History

This project started as `arisan`, an API for rotating savings groups. The draw turned out to be the
interesting part, so it was generalised into a template for any undian (v0.2.0).

See [ROADMAP.md](ROADMAP.md).

## License

MIT
