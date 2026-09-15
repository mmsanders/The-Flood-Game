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
import { stageRng } from '../rng.js';
import { Biome, Tile } from '../tiles.js';
import { SettlementKind, type Point, type Settlement } from '../world.js';
import { UNPLANNED, overwrite, stamp } from './plan.js';
import { isWorldRim, onPanelEdge } from './seams.js';

export interface RoadTargets {
  ark: Point;
  spawn: Point;
  dungeons: Point[];
  docks: Point[];
}

export function layRoads(
  seed: number,
  params: WorldParams,
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
    connect(plan, biome, w, h, towns[i], towns[i + 1], 'road');
  }
  for (const s of settlements) {
    if (s.shrine) connect(plan, biome, w, h, s, s.shrine, 'foot');
  }
  if (towns.length > 0) {
    connect(plan, biome, w, h, towns[towns.length - 1], targets.ark, 'road');
    connect(plan, biome, w, h, towns[0], targets.spawn, 'road');
  }
  for (const d of targets.dungeons) {
    const from = nearest(settlements, d) ?? targets.spawn;
    connect(plan, biome, w, h, from, d, 'foot');
  }
  for (const dock of targets.docks) {
    const from = nearest(settlements, dock) ?? targets.spawn;
    connect(plan, biome, w, h, from, dock, 'road');
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
  biome: Uint8Array,
  w: number,
  h: number,
  a: Point,
  b: Point,
  kind: 'road' | 'foot',
): void {
  const path = findPath(plan, w, h, a.x, a.y, b.x, b.y);
  if (!path) return;
  for (let n = 0; n < path.length; n++) {
    const i = path[n];
    const x = i % w;
    const y = (i / w) | 0;
    if (isWorldRim(x, y, w, h)) continue;
    const current = plan[i];
    if (isReserved(current)) continue;
    if (current === Tile.Water || current === Tile.Cliff) {
      overwrite(plan, i, current === Tile.Water ? Tile.Bridge : Tile.Steps);
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
    tile === Tile.HeartContainer ||
    tile === Tile.Steps ||
    tile === Tile.Bridge
  );
}

/**
 * Uniform-cost search with integer buckets. Cheap enough at map scale, and
 * deterministic given the plan.
 */
function findPath(
  plan: Uint8Array,
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
  const BUCKETS = 16;
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
    const step = stepCost(plan[to]);
    if (step >= 80) return;
    const nd = dist[from] + step;
    if (nd >= dist[to]) return;
    dist[to] = nd;
    prev[to] = from;
    buckets[nd % BUCKETS].push(to);
  }
}

function stepCost(tile: number): number {
  if (tile === UNPLANNED) return 2;
  if (tile === Tile.Path || tile === Tile.Road || tile === Tile.Steps || tile === Tile.Bridge) return 1;
  if (tile === Tile.Dirt || tile === Tile.Grass || tile === Tile.Gravel || tile === Tile.StoneGround) return 2;
  if (tile === Tile.Water) return 7;
  if (tile === Tile.Cliff) return 12;
  if (tile === Tile.TownDoor || tile === Tile.Shrine || tile === Tile.BoatYard || tile === Tile.ArkSite) {
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
