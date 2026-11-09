import { commitmentOf, DRAW_VERSION, draw, drawMessage, newSeed, verify } from './draw';

const ids = ['T0003', 'T0001', 'T0005', 'T0002', 'T0004'];

describe('draw', () => {
  it('is deterministic and independent of input order', () => {
    const a = draw({ seed: 's', publicEntropy: '17 42 8', slot: 3, eligible: ids });
    const b = draw({
      seed: 's',
      publicEntropy: ' 17 42 8 ',
      slot: 3,
      eligible: [...ids].reverse(),
    });
    expect(b.winner).toBe(a.winner);
    expect(a.ordered).toEqual(['T0001', 'T0002', 'T0003', 'T0004', 'T0005']);
    expect(a.ordered[a.index]).toBe(a.winner);
  });

  it('changes with seed, entropy and slot', () => {
    const base = { seed: 'seed', publicEntropy: 'x', slot: 1, eligible: ids };
    const winners = new Set<string>();
    for (let i = 0; i < 40; i++) {
      winners.add(draw({ ...base, publicEntropy: `entropy-${i}` }).winner);
    }
    expect(winners.size).toBe(ids.length);
    expect(draw(base).digest).not.toBe(draw({ ...base, slot: 2 }).digest);
    expect(draw(base).digest).not.toBe(draw({ ...base, seed: 'other' }).digest);
  });

  it('is roughly uniform', () => {
    const counts = new Map<string, number>();
    const runs = 5000;
    for (let i = 0; i < runs; i++) {
      const { winner } = draw({ seed: `s${i}`, publicEntropy: 'e', slot: 1, eligible: ids });
      counts.set(winner, (counts.get(winner) ?? 0) + 1);
    }
    for (const id of ids) {
      const share = (counts.get(id) ?? 0) / runs;
      expect(share).toBeGreaterThan(0.17);
      expect(share).toBeLessThan(0.23);
    }
  });

  it('rejects empty or duplicate eligibility lists', () => {
    expect(() => draw({ seed: 's', publicEntropy: '', slot: 1, eligible: [] })).toThrow();
    expect(() => draw({ seed: 's', publicEntropy: '', slot: 1, eligible: ['a', 'a'] })).toThrow(
      /duplicate/,
    );
  });

  it('a single eligible ticket always wins', () => {
    expect(draw({ seed: 'q', publicEntropy: 'z', slot: 9, eligible: ['last'] }).winner).toBe(
      'last',
    );
  });
});

describe('drawMessage', () => {
  it('is versioned, trims entropy and lists tickets in order', () => {
    expect(drawMessage(2, '  17 42 ', ['T0001', 'T0002'])).toBe(
      `${DRAW_VERSION}|2|17 42|T0001,T0002`,
    );
  });
});

describe('weighted entries', () => {
  it('more tickets means proportionally more chances', () => {
    // participant A holds 3 of the 4 tickets
    const tickets = ['A-1', 'A-2', 'A-3', 'B-1'];
    let a = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (
        draw({ seed: `w${i}`, publicEntropy: 'e', slot: 1, eligible: tickets }).winner.startsWith(
          'A',
        )
      )
        a++;
    }
    expect(a / runs).toBeGreaterThan(0.71);
    expect(a / runs).toBeLessThan(0.79);
  });
});

describe('commit–reveal', () => {
  it('produces 64-hex seeds and stable sha256 commitments', () => {
    const seed = newSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(commitmentOf('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verify detects a swapped seed or a forged winner', () => {
    const seed = newSeed();
    const input = { seed, publicEntropy: 'rt05', slot: 1, eligible: ids };
    const { winner } = draw(input);
    const commitment = commitmentOf(seed);
    expect(verify({ ...input, commitment, claimedWinner: winner }).valid).toBe(true);

    const forged = ids.find((i) => i !== winner) as string;
    const bad = verify({ ...input, commitment, claimedWinner: forged });
    expect(bad).toMatchObject({ valid: false, commitmentMatches: true, winnerMatches: false });

    const swapped = verify({ ...input, seed: newSeed(), commitment, claimedWinner: winner });
    expect(swapped.commitmentMatches).toBe(false);
    expect(swapped.valid).toBe(false);
  });
});
