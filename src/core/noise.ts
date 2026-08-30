/**
 * Seeded value noise + fBm.
 *
 * Hash-based rather than permutation-table based, so a noise field is a pure
 * function of (seed, x, y) with no setup cost and no shared mutable state.
 */

/** Deterministic 2D hash -> [0, 1). */
function hash2d(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-style ease, so lattice cells blend without visible creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Value noise at continuous (x, y). Returns [0, 1). */
export function valueNoise2d(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);

  const n00 = hash2d(seed, x0, y0);
  const n10 = hash2d(seed, x0 + 1, y0);
  const n01 = hash2d(seed, x0, y0 + 1);
  const n11 = hash2d(seed, x0 + 1, y0 + 1);

  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

export interface FbmOptions {
  /** Number of noise layers summed. More octaves = more fine detail. */
  octaves: number;
  /** Frequency multiplier per octave. */
  lacunarity: number;
  /** Amplitude multiplier per octave. */
  gain: number;
  /** Lattice size of the first octave, in tiles. */
  scale: number;
}

/** Fractional Brownian motion over value noise. Returns [0, 1]. */
export function fbm2d(
  seed: number,
  x: number,
  y: number,
  opts: FbmOptions,
): number {
  let frequency = 1 / opts.scale;
  let amplitude = 1;
  let sum = 0;
  let norm = 0;

  for (let o = 0; o < opts.octaves; o++) {
    // Each octave gets its own seed so layers are independent, not scaled
    // copies of one another.
    sum += amplitude * valueNoise2d(seed + o * 0x9e37, x * frequency, y * frequency);
    norm += amplitude;
    frequency *= opts.lacunarity;
    amplitude *= opts.gain;
  }

  return norm > 0 ? sum / norm : 0;
}
