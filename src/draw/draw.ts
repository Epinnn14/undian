import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Verifiable arisan draw (commit–reveal).
 *
 * 1. When a round opens, the server picks a secret `seed` and publishes only
 *    `commitment = sha256(seed)`. The seed can no longer be changed.
 * 2. At the draw, members supply `publicEntropy` (e.g. the numbers everybody shouted,
 *    or a lottery result) that the server could not know in advance.
 * 3. The winner is derived from HMAC-SHA256(seed, round | entropy | eligible ids).
 *    The seed is revealed, so anyone can recompute every step.
 *
 * Neither side alone can steer the result: the server committed before seeing the
 * entropy, and the members don't know the seed.
 */

export const SEED_BYTES = 32;

export function newSeed(): string {
  return randomBytes(SEED_BYTES).toString('hex');
}

export function commitmentOf(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

export interface DrawInput {
  seed: string;
  publicEntropy: string;
  roundNumber: number;
  /** ids of members who have not received the pot yet */
  eligible: readonly string[];
}

export interface DrawResult {
  winner: string;
  index: number;
  /** eligible ids in canonical (sorted) order — the list `index` points into */
  ordered: string[];
  message: string;
  digest: string;
  attempts: number;
}

const TWO_64 = 1n << 64n;

/** Deterministic, unbiased pick (rejection sampling on 64-bit chunks). */
export function draw({ seed, publicEntropy, roundNumber, eligible }: DrawInput): DrawResult {
  if (eligible.length === 0) throw new Error('no eligible members');
  if (new Set(eligible).size !== eligible.length) throw new Error('duplicate member ids');
  const ordered = [...eligible].sort();
  const n = BigInt(ordered.length);
  const limit = TWO_64 - (TWO_64 % n); // values >= limit would bias the modulo
  const message = `arisan-v1|${roundNumber}|${publicEntropy.trim()}|${ordered.join(',')}`;

  for (let attempt = 0; attempt < 1000; attempt++) {
    const digest = createHmac('sha256', seed).update(`${message}|${attempt}`).digest('hex');
    const value = BigInt(`0x${digest.slice(0, 16)}`);
    if (value < limit) {
      const index = Number(value % n);
      return { winner: ordered[index], index, ordered, message, digest, attempts: attempt + 1 };
    }
  }
  /* c8 ignore next */
  throw new Error('draw failed'); // probability < 2^-1000
}

export interface Verification {
  commitmentMatches: boolean;
  winnerMatches: boolean;
  valid: boolean;
  recomputed: DrawResult;
}

export function verify(
  input: DrawInput & { commitment: string; claimedWinner: string },
): Verification {
  const recomputed = draw(input);
  const commitmentMatches = commitmentOf(input.seed) === input.commitment;
  const winnerMatches = recomputed.winner === input.claimedWinner;
  return { commitmentMatches, winnerMatches, valid: commitmentMatches && winnerMatches, recomputed };
}
