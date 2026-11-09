/**
 * Walks through an arisan against a running server: `npm run dev` then `npm run demo`.
 */
const base = process.env.API ?? 'http://localhost:3000';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

type Round = {
  number: number;
  commitment: string;
  unpaid: { memberId: string; name: string }[];
  winner: { name: string } | null;
  payout: number;
  seed: string;
};

async function main() {
  const group = await call<{ id: string; payoutPerRound: number }>('POST', '/groups', {
    name: 'Arisan Ibu-ibu PKK Gang Mawar',
    contribution: 200_000,
    frequency: 'monthly',
    adminFeePct: 2,
    members: ['Bu Sri', 'Bu Ani', 'Bu Tini', 'Bu Wati', 'Mbak Rina', 'Bu Yanti'].map((name) => ({
      name,
    })),
  });
  console.log(
    `Created group ${group.id} — payout per round Rp${group.payoutPerRound.toLocaleString('id-ID')}`,
  );
  await call('POST', `/groups/${group.id}/start`, { startDate: '2026-12-01' });

  for (const n of [1, 2]) {
    const round = await call<Round>('GET', `/groups/${group.id}/rounds/${n}`);
    console.log(`\nRound ${n} commitment (published before payment): ${round.commitment}`);
    for (const m of round.unpaid) {
      await call('POST', `/groups/${group.id}/rounds/${n}/contributions`, { memberId: m.memberId });
    }
    const entropy = `${Math.floor(Math.random() * 100)} ${Math.floor(Math.random() * 100)}`;
    const drawn = await call<Round>('POST', `/groups/${group.id}/rounds/${n}/draw`, {
      publicEntropy: entropy,
    });
    console.log(`Numbers shouted by members: "${entropy}" → winner ${drawn.winner?.name}`);
    const v = await call<{ valid: boolean }>('GET', `/groups/${group.id}/rounds/${n}/verify`);
    console.log(
      `Revealed seed ${drawn.seed.slice(0, 16)}…  verify: ${v.valid ? 'VALID ✓' : 'INVALID ✗'}`,
    );
  }
  console.log(`\nLedger: ${base}/groups/${group.id}/ledger   Docs: ${base}/docs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
