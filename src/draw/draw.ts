import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Verifiable draw (commit–reveal), usable for any kind of undian: doorprize, giveaway,
 * lucky draw, raffle, or picking the next arisan winner.
 *
 * 1. When registration closes, the server picks one secret `seed` per draw slot and publishes
 *    only `commitment = sha256(seed)`. The seeds can no longer be changed.
 * 2. At each draw, the audience supplies `publicEntropy` (numbers shouted in the room, the last
 *    digits of a lottery result, a block hash…) that the server could not know in advance.
 * 3. The winning ticket is derived from HMAC-SHA256(seed, version | slot | entropy | tickets).
 *    The seed of that slot is revealed, so anyone can recompute every step.
 *
 * Neither side alone can steer the result: the server committed before seeing the entropy,
 * and the audience doesn't know the seed. Each slot has its own seed, so revealing one draw
 * tells nobody anything about the next.
 */

export const DRAW_VERSION = 'undian-v1';
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
  /** 1-based position of this draw within the event */
  slot: number;
  /** codes of the tickets that can still win — a participant with 3 tickets has 3 entries */
  eligible: readonly string[];
}

export interface DrawResult {
  winner: string;
  index: number;
  /** eligible codes in canonical (sorted) order — the list `index` points into */
  ordered: string[];
  message: string;
  digest: string;
  attempts: number;
}

const TWO_64 = 1n << 64n;

/** Canonical message that is fed to the HMAC; documented so it can be rebuilt by hand. */
export function drawMessage(slot: number, publicEntropy: string, ordered: readonly string[]) {
  return `${DRAW_VERSION}|${slot}|${publicEntropy.trim()}|${ordered.join(',')}`;
}

/** Deterministic, unbiased pick (rejection sampling on 64-bit chunks). */
export function draw({ seed, publicEntropy, slot, eligible }: DrawInput): DrawResult {
  if (eligible.length === 0) throw new Error('no eligible tickets');
  if (new Set(eligible).size !== eligible.length) throw new Error('duplicate ticket codes');
  const ordered = [...eligible].sort();
  const n = BigInt(ordered.length);
  const limit = TWO_64 - (TWO_64 % n); // values >= limit would bias the modulo
  const message = drawMessage(slot, publicEntropy, ordered);

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
  return {
    commitmentMatches,
    winnerMatches,
    valid: commitmentMatches && winnerMatches,
    recomputed,
  };
}
