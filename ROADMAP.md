# Roadmap

## Next
- [ ] **Public verification page** (static HTML) that recomputes a draw in the browser with WebCrypto,
      fed by `results.csv`.
- [ ] **Import participants from CSV** (name, contact, tickets) — events usually start from a spreadsheet.
- [ ] **Organiser auth**: an API key per undian for the write endpoints; reading stays public.
- [ ] **Redraw when a winner is absent** (*hangus*): mark a slot forfeited and draw a replacement slot
      with its own commitment, keeping the original on record.
- [ ] **Live screen** for the venue: big-number display that polls `/draws/:slot` (SSE).

## Later
- [ ] Use a public randomness beacon (e.g. drand round) as additional entropy.
- [ ] Prize stock with images and sponsor names.
- [ ] Switch storage to a real Postgres via `DATABASE_URL` (Drizzle node-postgres driver) for multi-instance deploys.
- [ ] Event log (append-only) for an auditable history of every action.
- [ ] Arisan preset: recurring meetings with contributions, built on top of the same draw.

## Done
- [x] Prizes with quantity and draw order; participants with multiple tickets and prefixed codes
- [x] Lock publishes one commitment per draw slot; per-slot seeds revealed one by one
- [x] One prize per person by default, `allowMultipleWins` for giveaways
- [x] Results as JSON and CSV (with seeds and entropy), ticket lookup
- [x] Commit–reveal draw with unbiased sampling and a verification endpoint
- [x] OpenAPI docs from Zod schemas, e2e tests on in-memory Postgres
