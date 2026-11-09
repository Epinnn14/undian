# Roadmap

## Next
- [ ] **Auth & roles** — organiser vs. member tokens; members can only see their own groups.
- [ ] **Late payments** — grace period, late fee (denda) and "talangan" (organiser covers, member repays).
- [ ] **Swap / sell a slot** (*jual kocokan*) — a winner-to-be trades their turn, with both parties' consent.
- [ ] **Fixed order arisan** (urutan tetap) as an alternative to random draws.
- [ ] Public, read-only verification page (static HTML) that runs the check in the browser with WebCrypto.

## Later
- [ ] Payment proof upload and organiser confirmation.
- [ ] WhatsApp-ready reminder text before each due date.
- [ ] Use a public randomness beacon (e.g. drand) as additional entropy.
- [ ] Switch storage to a real Postgres via `DATABASE_URL` (Drizzle node-postgres driver) for multi-instance deploys.
- [ ] Event log (append-only) for an auditable history of every action.

## Done
- [x] Groups, members, weekly/monthly schedule with month-end handling
- [x] Contributions, draw gated on full payment, automatic next round / finish
- [x] Commit–reveal draw with unbiased sampling and a verification endpoint
- [x] Ledger, OpenAPI docs from Zod schemas, e2e tests on in-memory Postgres
