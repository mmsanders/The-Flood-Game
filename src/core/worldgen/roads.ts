/**
 * Roads: the cheapest clue system that actually works.
 *
 * Stone roads mean a city. Dirt paths mean a farm or a logging town. A
 * footpath means a shrine. Every road goes somewhere — settlements to each
 * other, to their shrine, to the ark, to dungeon mouths and slipways.
 *
 * As the valleys drown, the roads still above water become a visible network
 * pointing north. The catastrophe is the signpost.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { valueNoise2d } from '../noise.js';
import { stageRng } from '../rng.js';
import { Biome, Tile } from '../tiles.js';
import { SettlementKind, type Point, type Settlement } from '../world.js';
import { UNPLANNED, overwrite, stamp } from './plan.js';
import { isWorldRim, onPanelEdge } from './seams.js';

export interface RoadTargets {
  spawn: Point;
  dungeons: Point[];
  docks: Point[];
}

export function layRoads(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  settlements: readonly Settlement[],
  targets: RoadTargets,
): void {
  const w = tileWidth(params);
  const h = tileHeight(params);
  stageRng(seed, 'roads');

  const towns = settlements.filter((s) => s.kind !== SettlementKind.Hamlet);
  for (let i = 0; i < towns.length - 1; i++) {
    connect(plan, elev, biome, w, h, towns[i], towns[i + 1], 'road');
  }
  for (const s of settlements) {
    if (s.shrine) connect(plan, elev, biome, w, h, s, s.shrine, 'foot');
  }
  // No road to the ark. It sits one panel north of where you wake up, on a
  // panel that is authored rather than generated, and a highway running to it
  // made the most important place in the world look like one more stop.
  if (towns.length > 0) {
    connect(plan, elev, biome, w, h, towns[0], targets.spawn, 'road');
  }
  for (const d of targets.dungeons) {
    const from = nearest(settlements, d) ?? targets.spawn;
    connect(plan, elev, biome, w, h, from, d, 'foot');
  }
  for (const dock of targets.docks) {
    const from = nearest(settlements, dock) ?? targets.spawn;
    connect(plan, elev, biome, w, h, from, dock, 'road');
  }
}

function nearest(points: readonly Point[], p: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const s of points) {
    const d = Math.abs(s.x - p.x) + Math.abs(s.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function connect(
  plan: Uint8Array,
  elev: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
  a: Point,
  b: Point,
  kind: 'road' | 'foot',
): void {
  const path = findPath(plan, elev, w, h, a.x, a.y, b.x, b.y);
  if (!path) return;
  for (let n = 0; n < path.length; n++) {
    const i = path[n];
    const x = i % w;
    const y = (i / w) | 0;
    if (isWorldRim(x, y, w, h)) continue;
    const current = plan[i];
    if (isReserved(current)) continue;
    if (current === Tile.Water || current === Tile.Gorge || current === Tile.Cliff) {
      overwrite(plan, i, current === Tile.Cliff ? Tile.Steps : Tile.Bridge);
      continue;
    }
    const tile = kind === 'road' && biome[i] === Biome.Scrub ? Tile.Road : Tile.Path;
    if (current === UNPLANNED || current === Tile.Grass || current === Tile.Dirt || current === Tile.Gravel) {
      overwrite(plan, i, tile);
    } else {
      stamp(plan, i, tile);
    }
    if (kind === 'road' && n % 2 === 0 && !onPanelEdge(x, y)) {
      const side = y % 2 === 0 ? i + 1 : i + w;
      if (side >= 0 && side < plan.length && !isReserved(plan[side]) && plan[side] !== Tile.Water) {
        stamp(plan, side, tile);
      }
    }
  }
}

function isReserved(tile: number): boolean {
  return (
    tile === Tile.Tent ||
    tile === Tile.House ||
    tile === Tile.StoneWall ||
    tile === Tile.Fence ||
    tile === Tile.TownDoor ||
    tile === Tile.Shrine ||
    tile === Tile.ArkSite ||
    tile === Tile.DungeonEntrance ||
    tile === Tile.BoatYard ||
    tile === Tile.CampTent ||
    tile === Tile.HeartContainer ||
    tile === Tile.Steps ||
    tile === Tile.Bridge
  );
}

/**
 * Number of buckets in the queue below.
 *
 * Dial's algorithm is only correct while this is greater than the largest
 * single step cost — otherwise a long edge wraps around the ring and is
 * dequeued as though it were cheap. The gorge (24) plus the terrain field (3)
 * plus the terrain field (3) plus a climb (14) is the worst case, so this has
 * headroom over 41.
 */
const BUCKETS = 48;

/** The most a single step may cost before it is treated as impassable. */
const IMPASSABLE = 80;

/**
 * Uniform-cost search with integer buckets. Cheap enough at map scale, and
 * deterministic given the plan.
 */
function findPath(
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] | null {
  const start = y0 * w + x0;
  const goal = y1 * w + x1;
  if (start === goal) return [start];
  const n = w * h;
  const dist = new Int32Array(n).fill(0x7fffffff);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  dist[start] = 0;
  buckets[0].push(start);
  let base = 0;
  let empty = 0;

  while (empty <= BUCKETS) {
    const bucket = buckets[base % BUCKETS];
    if (bucket.length === 0) {
      base++;
      empty++;
      continue;
    }
    empty = 0;
    const i = bucket.pop() as number;
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % w;
    const y = (i / w) | 0;
    relax(i, x > 0 ? i - 1 : -1);
    relax(i, x < w - 1 ? i + 1 : -1);
    relax(i, y > 0 ? i - w : -1);
    relax(i, y < h - 1 ? i + w : -1);
  }

  if (prev[goal] < 0 && start !== goal) {
    // Fall back to a greedy walk so a blocked search still leaves a trail.
    return greedy(plan, w, x0, y0, x1, y1);
  }

  const path: number[] = [];
  let cur = goal;
  let guard = n;
  while (cur >= 0 && guard-- > 0) {
    path.push(cur);
    if (cur === start) break;
    cur = prev[cur];
  }
  path.reverse();
  return path;

  function relax(from: number, to: number): void {
    if (to < 0 || done[to]) return;
    const tx = to % w;
    const ty = (to / w) | 0;
    if (isWorldRim(tx, ty, w, h)) return;
    const step = stepCost(plan[to]) + terrainCost(tx, ty) + climbCost(elev, from, to);
    if (step >= IMPASSABLE) return;
    const nd = dist[from] + step;
    if (nd >= dist[to]) return;
    dist[to] = nd;
    prev[to] = from;
    buckets[nd % BUCKETS].push(to);
  }
}

/**
 * What it costs to gain or lose height in one step.
 *
 * This is the main reason a real road bends: people put roads where the
 * walking is easy, so a route would rather run a long way along a contour than
 * a short way up a slope. Without it the search returns the Manhattan-shortest
 * path, and on open ground that is a dead straight line — which is exactly
 * what the map was drawing.
 *
 * Downhill is cheaper than up, which is why roads out of the mountains fan
 * out and roads into them switchback.
 */
function climbCost(elev: Uint8Array, from: number, to: number): number {
  const rise = elev[to] - elev[from];
  if (rise <= 0) return Math.min(3, (-rise / 14) | 0);
  return Math.min(CLIMB_MAX, (rise / 5) | 0);
}

/** Cap, so a road can still cross a ridge rather than refusing to exist. */
const CLIMB_MAX = 14;

/**
 * A slow, fixed cost field laid over the whole map, 0..9.
 *
 * Without it every tile of open ground costs the same, so the search returns
 * the Manhattan-shortest route — which on flat country is a dead straight line
 * with a single bend, and looked exactly like one. This is the country the
 * road has to get around: soft ground, a rise, a stand of trees. The
 * wavelength is long on purpose, so a road leans around a feature for twenty
 * tiles rather than zig-zagging tile by tile, and the contrast is high on
 * purpose: at a spread of 0..3 over a base tile cost of 2 a detour never paid
 * for itself, and the search went on drawing straight lines. At 0..9 rough
 * country costs five times what easy going does, and the road goes round.
 *
 * Deterministic and seed-independent: the same field every run, so a road is
 * still a pure function of the terrain it crosses.
 */
function terrainCost(x: number, y: number): number {
  const n = valueNoise2d(TERRAIN_SEED, x / 13, y / 17);
  return n > 0.56 ? 9 : n > 0.40 ? 3 : 0;
}

const TERRAIN_SEED = 0x51ed;

function stepCost(tile: number): number {
  if (tile === UNPLANNED) return 2;
  if (tile === Tile.Path || tile === Tile.Road || tile === Tile.Steps || tile === Tile.Bridge) return 1;
  if (tile === Tile.Dirt || tile === Tile.Grass || tile === Tile.Gravel || tile === Tile.StoneGround) return 2;
  if (tile === Tile.Water) return 7;
  // A road would rather go a long way round than bridge a gorge, but it will
  // bridge one if the alternative is not arriving.
  if (tile === Tile.Gorge) return 24;
  if (tile === Tile.Cliff) return 12;
  if (tile === Tile.TownDoor || tile === Tile.Shrine || tile === Tile.BoatYard || tile === Tile.CampTent || tile === Tile.ArkSite) {
    return 3;
  }
  if (
    tile === Tile.Tent ||
    tile === Tile.House ||
    tile === Tile.StoneWall ||
    tile === Tile.Fence ||
    tile === Tile.DungeonEntrance
  ) {
    return 90;
  }
  return 4;
}

function greedy(
  plan: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[] {
  const path: number[] = [];
  let x = x0;
  let y = y0;
  let guard = Math.abs(x1 - x0) + Math.abs(y1 - y0) + 8;
  while (guard-- > 0 && (x !== x1 || y !== y1)) {
    path.push(y * w + x);
    if (x < x1) x++;
    else if (x > x1) x--;
    else if (y < y1) y++;
    else if (y > y1) y--;
  }
  path.push(y1 * w + x1);
  void plan;
  return path;
}
