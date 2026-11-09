import { dueDate, payout, rupiah } from './schedule';

describe('schedule', () => {
  it('weekly rounds add 7 days', () => {
    expect(dueDate('2026-12-28', 'weekly', 1)).toBe('2026-12-28');
    expect(dueDate('2026-12-28', 'weekly', 2)).toBe('2027-01-04');
  });

  it('monthly rounds clamp to month end', () => {
    expect(dueDate('2026-01-31', 'monthly', 2)).toBe('2026-02-28');
    expect(dueDate('2026-01-31', 'monthly', 3)).toBe('2026-03-31');
    expect(dueDate('2027-11-15', 'monthly', 3)).toBe('2028-01-15');
    expect(dueDate('2028-01-31', 'monthly', 2)).toBe('2028-02-29');
  });

  it('payout subtracts the fee, rounding down', () => {
    expect(payout(100_000, 10, 0)).toEqual({ pot: 1_000_000, fee: 0, net: 1_000_000 });
    expect(payout(33_333, 3, 2.5)).toEqual({ pot: 99_999, fee: 2_499, net: 97_500 });
  });

  it('formats rupiah', () => {
    expect(rupiah(1_250_000)).toBe('Rp1.250.000');
    expect(rupiah(-500)).toBe('-Rp500');
  });
});
