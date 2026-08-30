/**
 * Resources, the ark recipe, and the solvability check.
 *
 * "Is this world winnable?" is a test, not a hope. A generated world that
 * strands the only pitch behind a cliff, or drowns the flax before the player
 * could plausibly walk to it, is rejected and regenerated.
 */

import { FLOOD_DAYS, type WorldParams } from './config.js';
import { drownDayForElev } from './flood.js';
import { RESOURCE_COUNT, Resource, isWalkable, resourceOf } from './tiles.js';
import type { Point } from './world.js';

/** Units required to launch. Genesis 6:14-16, loosely costed. */
export const ARK_RECIPE: Record<Resource, number> = {
  [Resource.Fiber]: 40,
  [Resource.Wood]: 60,
  [Resource.Stone]: 30,
  [Resource.Pitch]: 10,
};

/** Units yielded per harvested node. */
export const NODE_YIELD = 1;

/** Tiles per second on foot. Zelda-ish. */
export const PLAYER_TILES_PER_SEC = 4;

/**
 * How much more than the recipe must be reachable for a world to pass.
 * The check below measures availability, not an optimal route, so the margin
 * stands in for the backtracking a real run involves.
 */
const SUPPLY_MARGIN = 2.0;

export interface SolvabilityReport {
  solvable: boolean;
  /** Nodes of each resource reachable before they submerge. */
  reachable: number[];
  /** Total nodes of each resource on the map, reachable or not. */
  total: number[];
  problems: string[];
}

/**
 * Time-expanded reachability from spawn.
 *
 * Every step costs the same, so a plain BFS already yields earliest arrival
 * time; the only twist is that a tile is enterable only if it is still above
 * water at the moment the player would arrive. Returns arrival time in days,
 * or Infinity for tiles the player can never stand on.
 */
export function arrivalTimes(
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  spawn: Point,
  params: WorldParams,
): Float64Array {
  const n = w * h;
  const arrival = new Float64Array(n).fill(Infinity);

  const daysPerTile = 1 / (PLAYER_TILES_PER_SEC * params.secondsPerDay);

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const start = spawn.y * w + spawn.x;
  arrival[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const i = queue[head++];
    const t = arrival[i] + daysPerTile;
    if (t > FLOOD_DAYS) continue;

    const x = i % w;
    const y = (i / w) | 0;

    if (x > 0) visit(i - 1, t);
    if (x < w - 1) visit(i + 1, t);
    if (y > 0) visit(i - w, t);
    if (y < h - 1) visit(i + w, t);
  }

  return arrival;

  function visit(j: number, t: number): void {
    if (arrival[j] !== Infinity) return;
    if (!isWalkable(tiles[j])) return;
    // The tile must still be dry when the player gets there.
    if (drownDayForElev(elev[j]) <= t) return;
    arrival[j] = t;
    queue[tail++] = j;
  }
}

/**
 * A node counts as harvestable if the player can stand on an adjacent tile
 * before the node itself goes under.
 */
export function checkSolvable(
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  spawn: Point,
  params: WorldParams,
): SolvabilityReport {
  const arrival = arrivalTimes(tiles, elev, w, h, spawn, params);

  const reachable = new Array<number>(RESOURCE_COUNT).fill(0);
  const total = new Array<number>(RESOURCE_COUNT).fill(0);

  for (let i = 0; i < tiles.length; i++) {
    const res = resourceOf(tiles[i]);
    if (res === null) continue;
    total[res]++;

    const nodeDrown = drownDayForElev(elev[i]);
    const x = i % w;
    const y = (i / w) | 0;

    let best = Infinity;
    if (x > 0) best = Math.min(best, arrival[i - 1]);
    if (x < w - 1) best = Math.min(best, arrival[i + 1]);
    if (y > 0) best = Math.min(best, arrival[i - w]);
    if (y < h - 1) best = Math.min(best, arrival[i + w]);

    if (best < nodeDrown) reachable[res] += NODE_YIELD;
  }

  const problems: string[] = [];
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const need = ARK_RECIPE[r as Resource] * SUPPLY_MARGIN;
    if (reachable[r] < need) {
      problems.push(
        `${RESOURCE_LABEL[r]}: ${reachable[r]} reachable, needs ${Math.ceil(need)}`,
      );
    }
  }

  return { solvable: problems.length === 0, reachable, total, problems };
}

const RESOURCE_LABEL = ['Fiber', 'Wood', 'Stone', 'Pitch'];

/** Has the player gathered enough to launch? */
export function recipeMet(held: readonly number[]): boolean {
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    if (held[r] < ARK_RECIPE[r as Resource]) return false;
  }
  return true;
}

/** Fraction of the ark complete, 0..1, weighted by total units required. */
export function buildProgress(held: readonly number[]): number {
  let have = 0;
  let need = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const req = ARK_RECIPE[r as Resource];
    have += Math.min(held[r], req);
    need += req;
  }
  return need > 0 ? have / need : 0;
}
