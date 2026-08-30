/**
 * The elevation field — the spine of the whole design.
 *
 * One byte per tile, driving biome selection, tile painting, and the flood.
 * Because all three read the same field, the world reads as a single coherent
 * landscape rather than three systems that happen to overlap.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { fbm2d } from '../noise.js';
import { deriveSeed } from '../rng.js';
import { Biome } from '../tiles.js';

export interface ElevationField {
  elev: Uint8Array;
  biome: Uint8Array;
}

export function generateElevation(seed: number, params: WorldParams): ElevationField {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const noiseSeed = deriveSeed(seed, 'elevation');
  const cfg = params.elevation;

  const raw = new Float32Array(w * h);
  let min = Infinity;
  let max = -Infinity;

  for (let y = 0; y < h; y++) {
    // North (y=0) is high ground, south (y=h-1) is the first to drown.
    const lat = 1 - y / (h - 1);
    const ramp = Math.pow(lat, cfg.gradientExponent);

    for (let x = 0; x < w; x++) {
      const n = fbm2d(noiseSeed, x, y, {
        octaves: cfg.octaves,
        lacunarity: cfg.lacunarity,
        gain: cfg.gain,
        scale: cfg.scale,
      });
      const v = cfg.gradientWeight * ramp + (1 - cfg.gradientWeight) * n;
      raw[y * w + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  // Normalise to the full byte range. This matters: the flood maps day 0..40
  // onto elevation 0..256, so unused headroom would waste days of the run.
  const elev = new Uint8Array(w * h);
  const span = max - min || 1;
  for (let i = 0; i < raw.length; i++) {
    elev[i] = Math.min(255, Math.max(0, Math.round(((raw[i] - min) / span) * 255)));
  }

  const biome = classifyBiomes(elev, params);
  return { elev, biome };
}

/**
 * Four elevation bands. Since elevation already trends north-south, biomes
 * band by latitude with a natural wiggle — the blended transitions come free.
 */
export function classifyBiomes(elev: Uint8Array, params: WorldParams): Uint8Array {
  const [b0, b1, b2] = params.biomeBands;
  const c0 = b0 * 255;
  const c1 = b1 * 255;
  const c2 = b2 * 255;

  const biome = new Uint8Array(elev.length);
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i];
    biome[i] =
      e < c0 ? Biome.Valley : e < c1 ? Biome.Forest : e < c2 ? Biome.Scrub : Biome.Mountain;
  }
  return biome;
}
