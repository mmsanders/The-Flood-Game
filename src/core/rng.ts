/**
 * Deterministic pseudo-random number generation.
 *
 * Every world is a pure function of its seed, so the dev tool, the game, and
 * the test suite all reproduce byte-identical worlds from the same 32-bit
 * number. Nothing here may touch Math.random().
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough distribution for terrain. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive an independent sub-seed from a parent seed and a stage label.
 *
 * This is what lets us re-roll one generation stage without disturbing the
 * others: changing how dungeons are placed must not reshuffle the terrain.
 */
export function deriveSeed(seed: number, label: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final avalanche so adjacent labels don't produce correlated streams.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** An Rng for one named generation stage of one world. */
export function stageRng(seed: number, label: string): Rng {
  return mulberry32(deriveSeed(seed, label));
}

/** Hash arbitrary text to a seed, so "noah" is a valid seed in the dev tool. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Accept either a decimal number or free text as a seed.
 * Empty input yields a random seed.
 */
export function parseSeed(input: string | null | undefined): number {
  const text = (input ?? '').trim();
  if (text === '') return randomSeed();
  if (/^\d+$/.test(text)) return Number(text) >>> 0;
  return hashSeed(text);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** Integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Fisher-Yates, in place. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}
