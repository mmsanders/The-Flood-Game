/**
 * Landforms: the river, escarpments, plateaus, and one lake per biome.
 *
 * Runs after elevation, before anything is painted. It writes into the plan
 * (so later passes can see the water and the cliffs) and carves the river
 * into the elevation field so the channel floods early and becomes the
 * skiff's highway.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { randInt, stageRng, type Rng } from '../rng.js';
import { BIOME_COUNT, Biome, Tile } from '../tiles.js';
import { valueNoise2d } from '../noise.js';
import { UNPLANNED, overwrite, stamp } from './plan.js';
import { isWorldRim, onPanelEdge } from './seams.js';
import { cutEscarpments, markBiomeSeams } from './escarpments.js';

export function carveLandforms(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
): void {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'landforms');

  carveRiver(rng, elev, biome, plan, w, h);
  placeLakes(rng, elev, biome, plan, w, h);
  cutEscarpments(rng, elev, biome, plan, w, h);
  markBiomeSeams(rng, biome, plan, w, h);
  raisePlateaus(rng, elev, biome, plan, w, h);
}

/**
 * A single watercourse from the high north to the south sea, two tiles wide,
 * with a few tributaries. Elevation is dropped along the channel so the
 * flood finds it first — which is what makes it a highway once you have the
 * skiff, rather than an obstacle.
 */
function carveRiver(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): void {
  const startX = pickSpring(rng, elev, w, h);
  const stem = densifyPath(followDescent(rng, elev, w, h, startX, 2, h - 3), w);
  stampChannel(elev, biome, plan, stem, w, h, rng, true);

  const tributaries = 2 + (rng() < 0.5 ? 1 : 0);
  for (let t = 0; t < tributaries; t++) {
    if (stem.length < 16) break;
    const join = stem[randInt(rng, (stem.length * 0.2) | 0, stem.length - 8)];
    const jx = join % w;
    const jy = (join / w) | 0;
    const side = rng() < 0.5 ? -1 : 1;
    const length = randInt(rng, 18, 40);
    const sx = clamp(jx + side * randInt(rng, 10, 22), 3, w - 4);
    const sy = clamp(jy - randInt(rng, 4, 14), 3, h - 6);
    const branch = densifyPath(followToward(rng, elev, w, h, sx, sy, jx, jy, length), w);
    stampChannel(elev, biome, plan, branch, w, h, rng, false);
  }
}

function pickSpring(rng: Rng, elev: Uint8Array, w: number, h: number): number {
  const y1 = Math.max(2, Math.min(6, (h / 40) | 0) + 2);
  let bestX = (w / 2) | 0;
  let best = Infinity;
  for (let n = 0; n < 12; n++) {
    const x = randInt(rng, (w * 0.25) | 0, (w * 0.75) | 0);
    const y = randInt(rng, 2, y1);
    const e = elev[y * w + x] + Math.abs(x - w / 2) * 0.15;
    if (e < best) {
      best = e;
      bestX = x;
    }
  }
  return bestX;
}

function followDescent(
  rng: Rng,
  elev: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  yEnd: number,
): number[] {
  const path: number[] = [];
  const seen = new Uint8Array(w * h);
  let x = x0;
  let y = y0;
  let guard = w * h;
  while (y < yEnd && guard-- > 0) {
    const i = y * w + x;
    if (!seen[i]) {
      seen[i] = 1;
      path.push(i);
    }
    let bestX = x;
    let bestY = Math.min(h - 2, y + 1);
    let best = Infinity;
    for (let dy = 0; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 2 || nx >= w - 2 || ny < 1 || ny >= h - 1) continue;
        if (seen[ny * w + nx]) continue;
        const drift = wander(nx, ny) * 14;
        const score =
          elev[ny * w + nx] - dy * 9 + Math.abs(dx) * 1.5 - dx * drift + rng() * 5;
        if (score < best) {
          best = score;
          bestX = nx;
          bestY = ny;
        }
      }
    }
    if (bestX === x && bestY === y) {
      y++;
      continue;
    }
    x = bestX;
    y = bestY;
  }
  return path;
}

function followToward(
  rng: Rng,
  elev: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  tx: number,
  ty: number,
  maxLen: number,
): number[] {
  const path: number[] = [];
  const seen = new Uint8Array(w * h);
  let x = x0;
  let y = y0;
  for (let n = 0; n < maxLen; n++) {
    const i = y * w + x;
    if (Math.abs(x - tx) + Math.abs(y - ty) <= 1) break;
    if (!seen[i]) {
      seen[i] = 1;
      path.push(i);
    }
    let bestX = x;
    let bestY = y;
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 2 || nx >= w - 2 || ny < 2 || ny >= h - 3) continue;
        if (seen[ny * w + nx]) continue;
        const dist = Math.abs(nx - tx) + Math.abs(ny - ty);
        const score = dist * 8 + elev[ny * w + nx] * 0.15 + rng() * 3;
        if (score < best) {
          best = score;
          bestX = nx;
          bestY = ny;
        }
      }
    }
    if (bestX === x && bestY === y) break;
    x = bestX;
    y = bestY;
  }
  return path;
}

/**
 * Cut the channel as a dry gorge with its crossings already in place.
 *
 * A gorge is a landform, not a river: it is here before the rain, too steep to
 * climb into, and it fills from the north once the water starts coming off the
 * mountain. Fords are stamped as part of the cut rather than left to the
 * connectivity pass, so the channel never divides the world in the first place
 * — and a crossing you can see from a panel away is a landmark.
 */
function stampChannel(
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  path: readonly number[],
  w: number,
  h: number,
  rng: Rng,
  fords: boolean,
): void {
  const crossings = fords ? pickBiomeBridges(path, biome, w) : new Set<number>();
  for (let n = 0; n < path.length; n++) {
    const i = path[n];
    const x = i % w;
    const y = (i / w) | 0;
    if (isWorldRim(x, y, w, h)) continue;
    dropChannel(elev, i);
    const ford = crossings.has(i);
    overwrite(plan, i, ford ? Tile.Bridge : Tile.Gorge);
    const side = rng() < 0.5 ? -1 : 1;
    const nx = x + side;
    if (nx > 0 && nx < w - 1 && !isWorldRim(nx, y, w, h)) {
      const j = y * w + nx;
      dropChannel(elev, j);
      if (ford) overwrite(plan, j, Tile.Bridge);
      else stamp(plan, j, Tile.Gorge);
    }
  }
  dropOrphanGorge(plan, w, h);
}

function dropOrphanGorge(plan: Uint8Array, w: number, h: number): void {
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] !== Tile.Gorge) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const n4 = [
      x > 0 ? i - 1 : -1,
      x + 1 < w ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y + 1 < h ? i + w : -1,
    ];
    const linked = n4.some((j) => j >= 0 && (plan[j] === Tile.Gorge || plan[j] === Tile.Bridge));
    if (!linked) plan[i] = UNPLANNED;
  }
}

/**
 * One crossing per biome band, spaced so the four bridges are not a cluster.
 * Row gap of ~36 is a little over two panels.
 */
const MIN_BRIDGE_SEP = 36;

function pickBiomeBridges(path: readonly number[], biome: Uint8Array, w: number): Set<number> {
  const byBand: number[][] = [[], [], [], []];
  for (const i of path) {
    const band = biome[i] & 3;
    byBand[band].push(i);
  }
  const chosen: number[] = [];
  for (let b = 0; b < 4; b++) {
    const cells = byBand[b];
    if (cells.length === 0) continue;
    const mid = (cells.length / 2) | 0;
    let pick = cells[mid];
    for (let k = 0; k < cells.length; k++) {
      const offset = (k & 1) === 0 ? k >> 1 : -((k + 1) >> 1);
      const cand = cells[(mid + offset + cells.length) % cells.length];
      const cy = (cand / w) | 0;
      if (chosen.every((p) => Math.abs(((p / w) | 0) - cy) >= MIN_BRIDGE_SEP)) {
        pick = cand;
        break;
      }
    }
    chosen.push(pick);
  }
  return new Set(chosen);
}

/**
 * followDescent can step two rows at a time, which left a dashed gorge
 * (water, grass, water). Fill every skipped cardinal step so the channel
 * is a continuous landform.
 */
function densifyPath(path: readonly number[], w: number): number[] {
  if (path.length === 0) return [];
  const out: number[] = [path[0]];
  for (let n = 1; n < path.length; n++) {
    let x = path[n - 1] % w;
    let y = (path[n - 1] / w) | 0;
    const tx = path[n] % w;
    const ty = (path[n] / w) | 0;
    while (x !== tx || y !== ty) {
      if (y !== ty) y += y < ty ? 1 : -1;
      else x += x < tx ? 1 : -1;
      const i = y * w + x;
      if (out[out.length - 1] !== i) out.push(i);
    }
  }
  return out;
}

function dropChannel(elev: Uint8Array, i: number): void {
  const next = elev[i] < 36 ? 0 : elev[i] - 36;
  if (next < elev[i]) elev[i] = next;
}

/**
 * One lake per biome, so a dock in each band is a placement rather than a
 * lucky pond. Carved into elevation the same way as the river.
 */
function placeLakes(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): void {
  for (let b = 0; b < BIOME_COUNT; b++) {
    const site = pickLakeSite(rng, elev, biome, plan, w, h, b as Biome);
    if (site < 0) continue;
    const rx = randInt(rng, 3, 5);
    const ry = randInt(rng, 2, 4);
    const cx = site % w;
    const cy = (site / w) | 0;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1.05) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
        const i = y * w + x;
        dropChannel(elev, i);
        stamp(plan, i, Tile.Water);
      }
    }
  }
}

function pickLakeSite(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
  want: Biome,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (let n = 0; n < 80; n++) {
    const x = randInt(rng, 8, w - 9);
    const y = randInt(rng, 8, h - 10);
    const i = y * w + x;
    if (biome[i] !== want) continue;
    if (plan[i] === Tile.Water || plan[i] === Tile.Gorge) continue;
    if (onPanelEdge(x, y)) continue;
    const score = elev[i] + rng() * 8;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Flatten a couple of high mountain regions so the peaks read as tableland,
 * with a bridge if two of them sit across a short gap.
 */
function raisePlateaus(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): void {
  const plateaus: { x: number; y: number; r: number }[] = [];
  for (let n = 0; n < 3; n++) {
    const site = pickPlateau(rng, elev, biome, plan, w, h);
    if (site < 0) continue;
    const r = randInt(rng, 4, 7);
    const cx = site % w;
    const cy = (site / w) | 0;
    let peak = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
        const i = y * w + x;
        if (elev[i] > peak) peak = elev[i];
      }
    }
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
        const i = y * w + x;
        if (plan[i] === Tile.Water) continue;
        elev[i] = peak > 8 ? peak - 4 : peak;
        const edge = dx * dx + dy * dy > (r - 1) * (r - 1);
        if (edge && plan[i] !== Tile.Steps) stamp(plan, i, Tile.Cliff);
        else stamp(plan, i, Tile.StoneGround);
      }
    }
    plateaus.push({ x: cx, y: cy, r });
  }

  if (plateaus.length >= 2) {
    const a = plateaus[0];
    const b = plateaus[1];
    const gap = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - a.r - b.r;
    if (gap > 0 && gap <= 5) bridgeBetween(plan, w, h, a.x, a.y, b.x, b.y);
  }
}

function pickPlateau(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let n = 0; n < 50; n++) {
    const x = randInt(rng, 10, w - 11);
    const y = randInt(rng, 6, Math.max(8, (h / 3) | 0));
    const i = y * w + x;
    if (biome[i] !== Biome.Mountain) continue;
    if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
    const score = elev[i] + rng() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function bridgeBetween(
  plan: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let x = x0;
  let y = y0;
  let guard = 64;
  while (guard-- > 0 && (x !== x1 || y !== y1)) {
    if (x < x1) x++;
    else if (x > x1) x--;
    else if (y < y1) y++;
    else if (y > y1) y--;
    if (isWorldRim(x, y, w, h)) continue;
    const i = y * w + x;
    if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) overwrite(plan, i, Tile.Bridge);
    else stamp(plan, i, Tile.Bridge);
  }
}

/**
 * A slow left/right bias in [-1, 1], sampled from a fixed low-frequency field.
 *
 * Long wavelength on purpose: it should lean the channel one way for twenty
 * tiles at a time, which reads as a meander, rather than jittering per step,
 * which reads as noise.
 */
function wander(x: number, y: number): number {
  return valueNoise2d(WANDER_SEED, x / 26, y / 34) * 2 - 1;
}

const WANDER_SEED = 0x9e37;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
