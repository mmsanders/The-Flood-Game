/**
 * Resources, the ark recipe, and the solvability check.
 *
 * "Is this world winnable?" is a test, not a hope. A generated world that
 * strands the only pitch behind a cliff, or drowns the flax before the player
 * could plausibly walk to it, is rejected and regenerated.
 */

import { FLOOD_DAYS, type WorldParams } from './config.js';
import { drownDayForElev } from './flood.js';
import {
  BIOME_NAMES,
  Biome,
  RESOURCE_COUNT,
  Resource,
  isWalkable,
  resourceOf,
} from './tiles.js';
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

/**
 * The Rod starts knowing only fiber. Each biome shrine spends that biome's
 * resource to unlock the next: flax → wood → stone → pitch. The mountain
 * shrine spends pitch to crown it (tier 4), which also buds the harvest.
 *
 * Indexed by the shrine's biome / the current `rodTier`.
 *
 * Roughly a third of what the ark itself wants of that resource, against an
 * ark recipe of 40 / 60 / 30 / 10. The previous costs (6 / 8 / 5 / 3) were
 * close to free, which made the whole Rod ladder a formality rather than the
 * run's first real decision. The survey says supply carries it: even pitch,
 * the scarcest, comes in around six times the recipe within reach.
 */
export const SHRINE_COST: readonly number[] = [18, 24, 15, 9];

/** True if this Rod tier can take this resource. Fiber is always free. */
export function canRodHarvest(rodTier: number, res: Resource): boolean {
  return res <= Math.min(rodTier, Resource.Pitch);
}

/** Tiles per second on foot. Zelda-ish. */
export const PLAYER_TILES_PER_SEC = 4;

/**
 * How much more than the recipe must be reachable for a world to pass.
 * The check below measures availability, not an optimal route, so the margin
 * stands in for the backtracking a real run involves.
 */
const SUPPLY_MARGIN = 2.0;

/**
 * What a run actually has to gather of each resource, not just what the hull
 * costs.
 *
 * The Rod ladder is not optional: you cannot harvest wood until the valley
 * shrine has taken its fiber, or stone until the forest shrine has taken its
 * wood. Those costs were small enough to ignore when they were 6/8/5; at
 * 18/24/15 they are a real slice of the map's supply, and validating against
 * the hull alone let through worlds that could build the ark *or* climb the
 * ladder but not both.
 *
 * The mountain shrine is left out on purpose — it only buds the harvest, so a
 * run that cannot afford it is poorer, not stuck.
 */
export function requiredFor(r: Resource): number {
  const ladder = r < Resource.Pitch ? (SHRINE_COST[r] ?? 0) : 0;
  return ARK_RECIPE[r] + ladder;
}

export interface SolvabilityReport {
  solvable: boolean;
  /**
   * Shrines the Rod ladder depends on, with the day each drowns and the
   * earliest day the player could stand on it.
   */
  ladder: { biome: Biome; drownsOn: number; reachableOn: number }[];
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
  shrines: readonly { x: number; y: number; biome: Biome }[] = [],
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
    const need = requiredFor(r as Resource) * SUPPLY_MARGIN;
    if (reachable[r] < need) {
      problems.push(
        `${RESOURCE_LABEL[r]}: ${reachable[r]} reachable, needs ${Math.ceil(need)}`,
      );
    }
  }

  const ladder = checkLadder(elev, w, arrival, shrines, problems);

  return { solvable: problems.length === 0, reachable, total, ladder, problems };
}

/**
 * How long each required shrine must survive to be affordable.
 *
 * Not a guess about walking time — the whole map is about half an in-game day
 * across — but about gathering. The valley shrine wants fiber you have to find
 * and swing for while also learning the world, and it is the gate on every
 * other resource in the game, so it gets the most generous margin relative to
 * when it would otherwise drown.
 */
const SHRINE_GRACE_DAYS: readonly number[] = [7, 12, 16, 0];

/**
 * Can the Rod ladder actually be climbed before it goes under?
 *
 * The Rod harvests fiber and nothing else until a shrine teaches it otherwise,
 * so the three lower shrines are not optional scenery — they are the gate on
 * every resource above fiber. A valley shrine that drowns on day six ends the
 * run on day six, and nothing on screen says so.
 *
 * This is a *necessary* condition, not a sufficient one: it asks whether each
 * shrine could be stood on at all before it submerges, given a straight walk
 * from spawn. It does not model the detours to afford each one. A world that
 * fails this is definitely unwinnable; one that passes is merely not
 * unwinnable for this reason.
 */
function checkLadder(
  elev: Uint8Array,
  w: number,
  arrival: Float64Array,
  shrines: readonly { x: number; y: number; biome: Biome }[],
  problems: string[],
): SolvabilityReport['ladder'] {
  const ladder: SolvabilityReport['ladder'] = [];

  for (const shrine of shrines) {
    // The mountain shrine only buds the harvest. Losing it is a poorer run,
    // not a stuck one, so it is reported but never fails a world.
    const required = shrine.biome < Biome.Mountain;
    const i = shrine.y * w + shrine.x;
    const drownsOn = drownDayForElev(elev[i]);
    const reachableOn = arrival[i];
    ladder.push({ biome: shrine.biome, drownsOn, reachableOn });

    if (!required) continue;

    if (reachableOn >= drownsOn) {
      problems.push(
        `Rod ladder: the ${BIOME_NAMES[shrine.biome]} shrine drowns on day ` +
          `${drownsOn.toFixed(1)} but cannot be reached before day ` +
          `${Number.isFinite(reachableOn) ? reachableOn.toFixed(1) : 'ever'}`,
      );
      continue;
    }

    // Reaching it is not the constraint — the map is only about half a day
    // wide at walking pace. Affording it is. Each shrine has to survive long
    // enough to find its resource, harvest its price and carry it there.
    const grace = SHRINE_GRACE_DAYS[shrine.biome] ?? 0;
    if (drownsOn < grace) {
      problems.push(
        `Rod ladder: the ${BIOME_NAMES[shrine.biome]} shrine drowns on day ` +
          `${drownsOn.toFixed(1)}, too early to have afforded its price`,
      );
    }
  }

  return ladder;
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
