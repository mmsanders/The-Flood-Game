/**
 * Contour ledges: impassable lines at fixed elevations, so the overworld reads
 * as a topographic map.
 *
 * Because the flood rises at a constant rate, it is also a flood calendar. At
 * the default of one contour inside each biome band, every terrace is about
 * five days of water above the one below it, and a player who learns to read
 * the ledges can read the deadline.
 *
 * The biome seams (`markBiomeSeams`) are already ledges at the band edges.
 * This pass adds `contoursPerBand` more inside each band. Unlike the seams,
 * which wall only north–south steps, a contour walls every crossing, so you
 * cannot walk round the end of a ledge. It climbs by planned stairs, spaced
 * along each line; connectivity repair stays the safety net, not the design.
 */

import type { WorldParams } from '../config.js';
import { randInt, type Rng } from '../rng.js';
import { Tile, isWalkable } from '../tiles.js';
import { UNPLANNED, stamp } from './plan.js';
import { onPanelEdge } from './seams.js';

/** Lines shorter than this are knolls and dimples, not terraces: left open. */
export const MIN_CONTOUR_RUN = 10;

/** Tiles of ledge between planned stairs, measured along the line. */
export const CONTOUR_STAIR_STRIDE = 24;

/** Ground sealed in by a ledge and this small or smaller becomes ledge too. */
export const MAX_SLIVER = 24;

export interface ContourStats {
  /** Elevations a contour follows, low to high. */
  thresholds: number[];
  /** Separate ledges kept, each at least MIN_CONTOUR_RUN tiles. */
  lines: number;
  /** Ledge tiles stamped as Cliff. */
  cliffs: number;
  /** Planned stairs stamped into ledges. */
  stairs: number;
}

/** Contour elevations: each biome band split evenly into terraces. */
export function contourThresholds(params: WorldParams): number[] {
  const per = Math.max(0, Math.floor(params.contoursPerBand));
  const edges = [0, ...params.biomeBands, 1];
  const out: number[] = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    const lo = edges[b] * 255;
    const hi = edges[b + 1] * 255;
    for (let k = 1; k <= per; k++) out.push(Math.round(lo + ((hi - lo) * k) / (per + 1)));
  }
  return out;
}

export interface ContourMarks {
  /** 1 where a tile sits on the high side of a contour crossing. */
  marks: Uint8Array;
  /** Which terrace each tile is on: how many thresholds lie at or below it. */
  terrace: Uint8Array;
  /** Marked tiles grouped into lines (8-connected), long enough to keep. */
  runs: number[][];
}

/**
 * Find the ledges without touching the plan. Terraces are read off a 3×3
 * blurred elevation so noise does not fray the lines; of every 4-neighbour
 * pair that straddles a threshold, the higher tile becomes ledge.
 */
export function markContours(
  elev: Uint8Array,
  w: number,
  h: number,
  thresholds: readonly number[],
): ContourMarks {
  const blur = boxBlur(elev, w, h);
  const terrace = new Uint8Array(w * h);
  for (let i = 0; i < blur.length; i++) {
    let t = 0;
    while (t < thresholds.length && blur[i] >= thresholds[t]) t++;
    terrace[i] = t;
  }

  const marks = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      for (const j of [i + 1, i + w]) {
        if (terrace[i] === terrace[j]) continue;
        marks[blur[i] > blur[j] ? i : j] = 1;
      }
    }
  }

  const runs: number[][] = [];
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < marks.length; start++) {
    if (!marks[start] || seen[start]) continue;
    const run: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      run.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!marks[j] || seen[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (run.length >= MIN_CONTOUR_RUN) runs.push(run);
  }

  return { marks, terrace, runs };
}

/**
 * Stamp the ledges into the plan: Cliff, with planned Steps every
 * CONTOUR_STAIR_STRIDE tiles where both sides of the stair are open ground.
 * Anything already planned — water, gorge, bridges, seams, plateau rims —
 * is left alone, so the ledge simply meets it.
 */
export function cutContours(
  rng: Rng,
  elev: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
  params: WorldParams,
): ContourStats {
  const thresholds = contourThresholds(params);
  const stats: ContourStats = { thresholds, lines: 0, cliffs: 0, stairs: 0 };
  if (thresholds.length === 0) return stats;

  const { marks, terrace, runs } = markContours(elev, w, h, thresholds);
  stats.lines = runs.length;
  // Stairs planned before this pass: seams' and plateaus', not our own.
  const earlierSteps = new Uint8Array(plan.length);
  for (let i = 0; i < plan.length; i++) earlierSteps[i] = plan[i] === Tile.Steps ? 1 : 0;

  for (const run of runs) {
    run.sort((a, b) => (a % w) - (b % w) || ((a / w) | 0) - ((b / w) | 0));

    // Decide the stairs first, so a line with no stride-spaced spot for one
    // still gets a single stair rather than being sealed shut.
    const stairs = new Set<number>();
    const offset = randInt(rng, 4, 10);
    let since = CONTOUR_STAIR_STRIDE - offset;
    let firstCandidate = -1;
    for (const i of run) {
      since++;
      if (!isStairSpot(plan, marks, terrace, w, h, i)) continue;
      if (firstCandidate < 0) firstCandidate = i;
      if (since < CONTOUR_STAIR_STRIDE) continue;
      stairs.add(i);
      since = 0;
    }
    if (stairs.size === 0 && firstCandidate >= 0) stairs.add(firstCandidate);

    for (const i of run) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      // Beside an existing stair (a seam's, or a plateau's), widen the stair
      // rather than wall its approach.
      const tile = stairs.has(i) || touches(earlierSteps, w, i) ? Tile.Steps : Tile.Cliff;
      if (!stamp(plan, i, tile)) continue;
      if (tile === Tile.Steps) stats.stairs++;
      else stats.cliffs++;
    }
  }

  stats.cliffs += fillSlivers(plan, marks, w, h);
  return stats;
}

/**
 * Where a ledge runs close beside a gorge, a river or another wall, it leaves
 * a strip of ground too small to put a stair in and sealed on every side.
 * Connectivity repair would cut a stair into each one. Instead the strip
 * becomes part of the ledge, so the two walls read as one bank.
 *
 * Only strips that touch a contour are filled, and never one holding planned
 * walkable ground (a stair, a bridge, a path), so this cannot seal a route
 * that some other pass laid.
 */
function fillSlivers(plan: Uint8Array, marks: Uint8Array, w: number, h: number): number {
  const open = (i: number): boolean => plan[i] === UNPLANNED || isWalkable(plan[i]);
  const seen = new Uint8Array(w * h);
  const region: number[] = [];
  let filled = 0;
  for (let start = 0; start < plan.length; start++) {
    if (seen[start] || !open(start)) continue;
    region.length = 0;
    region.push(start);
    seen[start] = 1;
    let fillable = true;
    let touchesContour = false;
    for (let k = 0; k < region.length; k++) {
      const i = region[k];
      const x = i % w;
      const y = (i / w) | 0;
      if (plan[i] !== UNPLANNED) fillable = false;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) {
        fillable = false;
        continue;
      }
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (marks[j] && plan[j] === Tile.Cliff) touchesContour = true;
        if (seen[j] || !open(j)) continue;
        seen[j] = 1;
        region.push(j);
      }
    }
    if (!fillable || !touchesContour || region.length > MAX_SLIVER) continue;
    for (const i of region) plan[i] = Tile.Cliff;
    filled += region.length;
  }
  return filled;
}

/**
 * A stair works only if you can step onto it from the low terrace and off it
 * onto the high one: straight across the ledge, both sides open ground.
 */
function isStairSpot(
  plan: Uint8Array,
  marks: Uint8Array,
  terrace: Uint8Array,
  w: number,
  h: number,
  i: number,
): boolean {
  if (plan[i] !== UNPLANNED) return false;
  const x = i % w;
  const y = (i / w) | 0;
  if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) return false;
  // Off the panel seams: a stair there is paired with whatever sits over the
  // boundary, usually more ledge, and repair would cut that open to match.
  if (onPanelEdge(x, y)) return false;
  for (const d of [1, -1, w, -w]) {
    const low = i + d;
    const high = i - d;
    if (onPanelEdge(low % w, (low / w) | 0) || onPanelEdge(high % w, (high / w) | 0)) continue;
    if (terrace[low] >= terrace[i]) continue;
    if (marks[low] || marks[high]) continue;
    if (terrace[high] !== terrace[i]) continue;
    if (plan[low] !== UNPLANNED || plan[high] !== UNPLANNED) continue;
    return true;
  }
  return false;
}

function touches(mask: Uint8Array, w: number, i: number): boolean {
  return mask[i - 1] === 1 || mask[i + 1] === 1 || mask[i - w] === 1 || mask[i + w] === 1;
}

function boxBlur(elev: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += elev[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}
