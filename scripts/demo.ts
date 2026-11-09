/**
 * Walks through a doorprize draw against a running server: `npm run dev` then `npm run demo`.
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

type Slot = { slot: number; prize: { name: string }; commitment: string };
type Drawn = Slot & { seed: string; winner: { ticket: string; name: string } };

async function main() {
  const u = await call<{ id: string; draws: Slot[] }>('POST', '/undian', {
    name: 'Doorprize Jalan Sehat 17 Agustus',
    description: 'Kupon dibagikan di garis finish',
    ticketPrefix: 'JS',
    prizes: [
      { name: 'Voucher pulsa 50rb', quantity: 3 },
      { name: 'Rice cooker', quantity: 1 },
      { name: 'Sepeda gunung', quantity: 1 },
    ],
    participants: [
      { name: 'Bu Sri', tickets: 2 },
      { name: 'Pak Budi' },
      { name: 'Mbak Rina', tickets: 3 },
      { name: 'Mas Dimas' },
      { name: 'Bu Ani' },
      { name: 'Pak RT', tickets: 2 },
    ],
  });
  console.log(`Created undian ${u.id}`);

  const locked = await call<{ draws: Slot[] }>('POST', `/undian/${u.id}/lock`);
  console.log('\nCommitments published before the draw:');
  for (const d of locked.draws) {
    console.log(`  #${d.slot} ${d.prize.name.padEnd(20)} ${d.commitment.slice(0, 24)}…`);
  }

  console.log('\nDrawing:');
  for (const _ of locked.draws) {
    const entropy = `${Math.floor(Math.random() * 100)} ${Math.floor(Math.random() * 100)}`;
    const d = await call<Drawn>('POST', `/undian/${u.id}/draw`, { publicEntropy: entropy });
    const v = await call<{ valid: boolean }>('GET', `/undian/${u.id}/draws/${d.slot}/verify`);
    console.log(
      `  #${d.slot} ${d.prize.name.padEnd(20)} "${entropy}" → ${d.winner.ticket} ${d.winner.name.padEnd(10)} verify: ${v.valid ? 'VALID ✓' : 'INVALID ✗'}`,
    );
  }
  console.log(
    `\nResults: ${base}/undian/${u.id}/results   CSV: ${base}/undian/${u.id}/results.csv`,
  );
  console.log(`Docs:    ${base}/docs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
