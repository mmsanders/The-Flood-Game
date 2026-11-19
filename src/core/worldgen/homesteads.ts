/**
 * Homesteads: farms between the towns. Wave 7.
 *
 * The domestic animals have to live somewhere, and a farm is where people
 * keep an ox. Each homestead is a house, a well, a yard and a fenced paddock,
 * sited like the towns — on flat, buildable ground near water — but on its
 * own, out among the fields. Two per biome, each keeping one of that biome's
 * domestic pair.
 *
 * Every one has a story told by its tiles: lived in (a farmer in the yard),
 * abandoned (the roof fallen in, the fence still standing), or a fallen fence
 * (gaps in the rails, the animal staying close anyway).
 *
 * Layout, anchored at the house H (W well, d yard, F fence, g gate, . paddock):
 *
 *        . . F F F F F F
 *      W H d g . . . . F
 *      d d d F . . . . F
 *      . d . F . . . . F
 *        . . F F F F F F
 *
 * Laid on the plan before roads, so a farm track can find the gate.
 */

import { PANEL_H, PANEL_W, type WorldParams, tileHeight, tileWidth } from '../config.js';
import { type Rng, stageRng } from '../rng.js';
import { Biome, Tile } from '../tiles.js';
import { type Homestead, HomesteadState, type Point, type Settlement } from '../world.js';
import { contourThresholds } from './contours.js';
import { UNPLANNED, overwrite } from './plan.js';
import { waterDistance } from './settlements.js';

/** Farms per biome. Each keeps one of the biome's domestic pair. */
const PER_BIOME = 2;

/** Footprint relative to the house, inclusive. */
const FOOT = { x0: -1, y0: -1, x1: 6, y1: 3 } as const;
/** Paddock interior relative to the house. */
const PADDOCK = { x0: 3, y0: 0, x1: 5, y1: 2 } as const;

const MIN_FROM_TOWN = 16;
const MIN_FROM_FARM = 18;

const NAME_ROOTS = [
  'Hollow',
  'Reed',
  'Cedar',
  'Thorn',
  'Ash',
  'Fig',
  'Willow',
  'Clay',
  'Barley',
  'Olive',
  'Brook',
  'Ridge',
  'Millet',
  'Lentil',
  'Juniper',
  'Tamarisk',
  'Flint',
  'Cistern',
];

const NAME_SUFFIX: Record<Biome, string> = {
  [Biome.Valley]: 'Farm',
  [Biome.Forest]: 'Steading',
  [Biome.Scrub]: 'Yard',
  [Biome.Mountain]: 'Fold',
};

export function placeHomesteads(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  settlements: readonly Settlement[],
  avoid: readonly Point[],
): Homestead[] {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'homesteads');
  const water = waterDistance(plan, w, h);
  const thresholds = contourThresholds(params);
  const names = shuffled(rng, NAME_ROOTS);

  const homesteads: Homestead[] = [];
  const keepAway: Point[] = [...settlements, ...avoid];

  for (const want of [Biome.Valley, Biome.Forest, Biome.Scrub, Biome.Mountain]) {
    for (let n = 0; n < PER_BIOME; n++) {
      const site = pickFarmSite(rng, elev, biome, plan, water, w, h, want, keepAway, homesteads, thresholds);
      if (site < 0) break;
      const hx = site % w;
      const hy = (site / w) | 0;
      // The first farm in a biome is lived in; the second has a story.
      const state =
        n === 0 ? HomesteadState.LivedIn : rng() < 0.5 ? HomesteadState.Abandoned : HomesteadState.FallenFence;
      const home: Homestead = {
        id: homesteads.length,
        name: `${names[homesteads.length % names.length]} ${NAME_SUFFIX[want]}`,
        biome: want,
        state,
        x: hx,
        y: hy,
        paddock: { x0: hx + PADDOCK.x0, y0: hy + PADDOCK.y0, x1: hx + PADDOCK.x1, y1: hy + PADDOCK.y1 },
        yard: { x: hx, y: hy + 1 },
      };
      stampHomestead(rng, plan, w, home);
      homesteads.push(home);
    }
  }
  return homesteads;
}

function pickFarmSite(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  water: Uint16Array,
  w: number,
  h: number,
  want: Biome,
  keepAway: readonly Point[],
  farms: readonly Homestead[],
  thresholds: readonly number[],
): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let y = 2; y < h - 4; y++) {
    for (let x = 2; x < w - 8; x++) {
      const i = y * w + x;
      if (biome[i] !== want) continue;
      if (!fitsOnePanel(x, y)) continue;
      if (!near(keepAway, x, y, MIN_FROM_TOWN) || !nearFarms(farms, x, y)) continue;
      if (!footprintClear(elev, biome, plan, w, x, y, want, thresholds)) continue;
      // Near water, like every place people choose to live; a little noise so
      // the same valley doesn't always win.
      const wet = water[i] < 0xffff ? Math.max(0, 30 - water[i]) : 0;
      const score = wet * 2 + rng() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

/** The whole footprint plus a one-tile margin inside a single panel's interior. */
function fitsOnePanel(hx: number, hy: number): boolean {
  const x0 = hx + FOOT.x0 - 1;
  const x1 = hx + FOOT.x1 + 1;
  const y0 = hy + FOOT.y0 - 1;
  const y1 = hy + FOOT.y1 + 1;
  if (Math.floor(x0 / PANEL_W) !== Math.floor(x1 / PANEL_W)) return false;
  if (Math.floor(y0 / PANEL_H) !== Math.floor(y1 / PANEL_H)) return false;
  return x0 % PANEL_W >= 1 && y0 % PANEL_H >= 1 && x1 % PANEL_W <= PANEL_W - 2 && y1 % PANEL_H <= PANEL_H - 2;
}

function near(points: readonly Point[], x: number, y: number, min: number): boolean {
  for (const p of points) {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < min * min) return false;
  }
  return true;
}

function nearFarms(farms: readonly Homestead[], x: number, y: number): boolean {
  return near(farms, x, y, MIN_FROM_FARM);
}

/** Unclaimed, one biome, and flat: no contour ledge runs through the farm. */
function footprintClear(
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  hx: number,
  hy: number,
  want: Biome,
  thresholds: readonly number[],
): boolean {
  let lo = 255;
  let hi = 0;
  for (let y = hy + FOOT.y0 - 1; y <= hy + FOOT.y1 + 1; y++) {
    for (let x = hx + FOOT.x0 - 1; x <= hx + FOOT.x1 + 1; x++) {
      const i = y * w + x;
      if (plan[i] !== UNPLANNED || biome[i] !== want) return false;
      if (elev[i] < lo) lo = elev[i];
      if (elev[i] > hi) hi = elev[i];
    }
  }
  for (const t of thresholds) if (lo < t && hi >= t) return false;
  return hi - lo < 24;
}

function stampHomestead(rng: Rng, plan: Uint8Array, w: number, home: Homestead): void {
  const at = (dx: number, dy: number) => (home.y + dy) * w + home.x + dx;
  const ruined = home.state === HomesteadState.Abandoned;
  const ground = ruined ? Tile.TallGrass : Tile.Dirt;

  // The whole footprint first, so nothing random grows in the farmyard.
  for (let dy = FOOT.y0; dy <= FOOT.y1; dy++) {
    for (let dx = FOOT.x0; dx <= FOOT.x1; dx++) overwrite(plan, at(dx, dy), Tile.Grass);
  }

  overwrite(plan, at(0, 0), ruined ? Tile.Ruin : Tile.House);
  overwrite(plan, at(-1, 0), Tile.Well);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ] as const) {
    overwrite(plan, at(dx, dy), ground);
  }

  // The paddock: fence on the ring, gate facing the yard.
  for (let dy = PADDOCK.y0 - 1; dy <= PADDOCK.y1 + 1; dy++) {
    for (let dx = PADDOCK.x0 - 1; dx <= PADDOCK.x1 + 1; dx++) {
      const ring = dy === PADDOCK.y0 - 1 || dy === PADDOCK.y1 + 1 || dx === PADDOCK.x0 - 1 || dx === PADDOCK.x1 + 1;
      if (!ring) continue;
      overwrite(plan, at(dx, dy), Tile.Fence);
    }
  }
  overwrite(plan, at(PADDOCK.x0 - 1, 0), Tile.Path);

  if (home.state !== HomesteadState.FallenFence) return;
  // Rails down in places: at least three gaps, never the corners (which is
  // what reads as a fence that fell rather than one never finished).
  let gaps = 0;
  for (let tries = 0; tries < 40 && gaps < 4; tries++) {
    const side = Math.floor(rng() * 3);
    const dx = side === 0 ? PADDOCK.x1 + 1 : PADDOCK.x0 + Math.floor(rng() * (PADDOCK.x1 - PADDOCK.x0 + 1));
    const dy =
      side === 0
        ? PADDOCK.y0 + Math.floor(rng() * (PADDOCK.y1 - PADDOCK.y0 + 1))
        : side === 1
          ? PADDOCK.y0 - 1
          : PADDOCK.y1 + 1;
    const i = at(dx, dy);
    if (plan[i] !== Tile.Fence) continue;
    overwrite(plan, i, Tile.FenceDown);
    gaps++;
  }
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
