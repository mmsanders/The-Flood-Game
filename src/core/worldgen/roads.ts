/**
 * Roads: the cheapest clue system that actually works.
 *
 * Stone roads mean a city. Dirt paths mean a farm or a logging town. A
 * footpath means a shrine. Roads generally point toward the next settlement
 * or Noah's camp, but each town only radiates civilization so far — the pave
 * peters out into wilderness, and the player has to leave the road to cross
 * between auras. Complete paved networks erased that navigation challenge.
 *
 * As the valleys drown, the roads still above water remain a visible hint
 * pointing north. The catastrophe is still a signpost; it just stops short
 * of drawing the whole journey.
 *
 * Scattered wayfinding signs are deferred: if aura gaps prove too hard in
 * play, light signposts can come later without a full sign system.
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

/** How far a settlement's paved aura reaches, in tiles. */
function auraRadius(kind: SettlementKind): number {
  switch (kind) {
    case SettlementKind.City:
      return 26;
    case SettlementKind.LoggingTown:
      return 22;
    case SettlementKind.TentCity:
      return 20;
    case SettlementKind.Hamlet:
      return 14;
  }
}

/** Noah's camp / spawn aura — same treatment as a modest town. */
const SPAWN_AURA = 18;

/** Dungeon mouths and slipways only pull a short spur of path. */
const POI_AURA = 12;

/** Shrine footpaths stay short; towns already sit near their shrine. */
const SHRINE_AURA = 16;

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
    connect(
      plan,
      elev,
      biome,
      w,
      h,
      towns[i],
      towns[i + 1],
      'road',
      auraRadius(towns[i].kind),
      auraRadius(towns[i + 1].kind),
    );
  }
  for (const s of settlements) {
    if (s.shrine) {
      connect(
        plan,
        elev,
        biome,
        w,
        h,
        s,
        s.shrine,
        'foot',
        auraRadius(s.kind),
        SHRINE_AURA,
      );
    }
  }
  // No road to the ark. It sits one panel north of where you wake up, on a
  // panel that is authored rather than generated, and a highway running to it
  // made the most important place in the world look like one more stop.
  if (towns.length > 0) {
    connect(
      plan,
      elev,
      biome,
      w,
      h,
      towns[0],
      targets.spawn,
      'road',
      auraRadius(towns[0].kind),
      SPAWN_AURA,
    );
  }
  for (const d of targets.dungeons) {
    const from = nearest(settlements, d) ?? targets.spawn;
    const fromAura =
      'kind' in from ? auraRadius((from as Settlement).kind) : SPAWN_AURA;
    connect(plan, elev, biome, w, h, from, d, 'foot', fromAura, POI_AURA);
  }
  for (const dock of targets.docks) {
    const from = nearest(settlements, dock) ?? targets.spawn;
    const fromAura =
      'kind' in from ? auraRadius((from as Settlement).kind) : SPAWN_AURA;
    connect(plan, elev, biome, w, h, from, dock, 'road', fromAura, POI_AURA);
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

function manhattan(x: number, y: number, p: Point): number {
  return Math.abs(x - p.x) + Math.abs(y - p.y);
}

/**
 * True when this path cell should receive pavement.
 *
 * Full density near either endpoint; then a soft fade so the road frays into
 * dirt and finally wilderness instead of cutting off on a hard circle.
 */
function inAura(
  x: number,
  y: number,
  a: Point,
  b: Point,
  auraA: number,
  auraB: number,
): boolean {
  const da = manhattan(x, y, a);
  const db = manhattan(x, y, b);
  if (da <= auraA * 0.72 || db <= auraB * 0.72) return true;
  if (da <= auraA) {
    const t = (da - auraA * 0.72) / (auraA * 0.28);
    return valueNoise2d(AURA_FADE_SEED, x / 5, y / 5) > t * 0.85;
  }
  if (db <= auraB) {
    const t = (db - auraB * 0.72) / (auraB * 0.28);
    return valueNoise2d(AURA_FADE_SEED, x / 5, y / 5) > t * 0.85;
  }
  return false;
}

const AURA_FADE_SEED = 0xa11a;

function connect(
  plan: Uint8Array,
  elev: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
  a: Point,
  b: Point,
  kind: 'road' | 'foot',
  auraA: number,
  auraB: number,
): void {
  const path = findPath(plan, elev, w, h, a.x, a.y, b.x, b.y);
  if (!path) return;
  for (let n = 0; n < path.length; n++) {
    const i = path[n];
    const x = i % w;
    const y = (i / w) | 0;
    if (isWorldRim(x, y, w, h)) continue;
    if (!inAura(x, y, a, b, auraA, auraB)) continue;
    const current = plan[i];
    if (isReserved(current)) continue;
    // Cliff faces stay impassable. Stairs come from landforms / connectivity;
    // a road that used to pave Steps through every escarpment erased them.
    if (current === Tile.Cliff) continue;
    if (current === Tile.Water || current === Tile.Gorge) {
      overwrite(plan, i, Tile.Bridge);
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
        if (plan[side] === Tile.Cliff) continue;
        const sx = side % w;
        const sy = (side / w) | 0;
        if (!inAura(sx, sy, a, b, auraA, auraB)) continue;
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

/** Dial bucket count; must exceed worst single-step cost (~41). */
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

/** Climb cost: prefer contour routes over short steep climbs. */
function climbCost(elev: Uint8Array, from: number, to: number): number {
  const rise = elev[to] - elev[from];
  if (rise <= 0) return Math.min(3, (-rise / 14) | 0);
  return Math.min(CLIMB_MAX, (rise / 5) | 0);
}

const CLIMB_MAX = 14;

/** Slow fixed cost field 0..9 so roads bend around soft country. */
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
  // Cliffs are expensive to route through and are no longer paved into Steps
  // by this pass — prefer going around a face when laying an aura spur.
  if (tile === Tile.Cliff) return 28;
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
