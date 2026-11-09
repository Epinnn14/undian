export type Frequency = 'weekly' | 'monthly';

/** Due date (YYYY-MM-DD) of round `n` (1-based) for a group starting on `start`. */
export function dueDate(start: string, frequency: Frequency, n: number): string {
  const [y, m, d] = start.split('-').map(Number);
  if (frequency === 'weekly') {
    const date = new Date(Date.UTC(y, m - 1, d + 7 * (n - 1)));
    return date.toISOString().slice(0, 10);
  }
  // monthly: clamp to the last day of short months (31 Jan → 28/29 Feb)
  const monthIndex = m - 1 + (n - 1);
  const lastDay = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, monthIndex, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** Pot paid to a round's winner after the organiser's fee (rounded down to whole rupiah). */
export function payout(
  contribution: number,
  members: number,
  adminFeePct: number,
): {
  pot: number;
  fee: number;
  net: number;
} {
  const pot = contribution * members;
  const fee = Math.floor((pot * adminFeePct) / 100);
  return { pot, fee, net: pot - fee };
}

export function rupiah(n: number): string {
  return `${n < 0 ? '-' : ''}Rp${Math.abs(n).toLocaleString('id-ID')}`;
}
