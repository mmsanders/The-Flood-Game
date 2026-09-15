/**
 * Siting: the ark, spawn, shrines (already placed with towns), dungeons,
 * hearts, and the remaining docks.
 *
 * Runs after settlements so a shrine can sit south-east of town on a real
 * bearing, and a dungeon mouth can be cut into rock rather than dropped on
 * grass. Writes into the plan; paint fills whatever is still unplanned.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { shuffle, stageRng, type Rng } from '../rng.js';
import { BIOME_COUNT, Biome, Tile } from '../tiles.js';
import {
  PoiKind,
  SettlementKind,
  type Point,
  type Poi,
  type Settlement,
} from '../world.js';
import { UNPLANNED, overwrite, stamp } from './plan.js';
import { isWorldRim, onPanelEdge } from './seams.js';

export interface PoiPlacement {
  spawn: Point;
  ark: Point;
  boatYard: Point;
  pois: Poi[];
}

export function placePois(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  settlements: readonly Settlement[],
): PoiPlacement {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'pois');
  const pois: Poi[] = [];
  const taken = new Set<number>();

  const arkIndex = pickArkSite(elev, plan, w, h);
  stampArkPlatform(plan, elev, w, h, arkIndex);
  taken.add(arkIndex);
  pois.push({ ...toPoint(arkIndex, w), kind: PoiKind.Ark, biome: biome[arkIndex] as Biome });

  const spawn = pickSpawn(rng, plan, elev, w, h, arkIndex);
  taken.add(spawn);
  stampCamp(plan, w, h, spawn);

  for (const s of settlements) {
    if (s.kind !== SettlementKind.Hamlet) {
      pois.push({ x: s.x, y: s.y, kind: PoiKind.Town, biome: s.biome });
      taken.add(s.y * w + s.x);
    }
    if (s.shrine) {
      const i = s.shrine.y * w + s.shrine.x;
      taken.add(i);
      plan[i] = Tile.Shrine;
      pois.push({ x: s.shrine.x, y: s.shrine.y, kind: PoiKind.Shrine, biome: s.biome });
    }
  }

  for (let b = 0; b < BIOME_COUNT; b++) {
    const town = settlements.find((s) => s.biome === b);
    const spot = pickDungeon(rng, plan, biome, w, h, b as Biome, taken, town);
    if (spot === undefined) continue;
    taken.add(spot);
    stampDungeonMouth(plan, w, h, spot, b as Biome);
    pois.push({ ...toPoint(spot, w), kind: PoiKind.Dungeon, biome: b as Biome });
  }

  for (let n = 0; n < params.heartContainers; n++) {
    const b = n % BIOME_COUNT;
    const spot = pickOpen(rng, plan, biome, w, h, b as Biome, taken, 10);
    if (spot === undefined) continue;
    taken.add(spot);
    overwrite(plan, spot, Tile.HeartContainer);
    pois.push({ ...toPoint(spot, w), kind: PoiKind.Heart, biome: b as Biome });
  }

  // Shrines already sit with their towns. If a biome has none (placement
  // failed), drop a spare so the Rod ladder still exists.
  for (let b = 0; b < BIOME_COUNT; b++) {
    if (pois.some((p) => p.kind === PoiKind.Shrine && p.biome === b)) continue;
    const spot = pickOpen(rng, plan, biome, w, h, b as Biome, taken, 10);
    if (spot === undefined) continue;
    taken.add(spot);
    overwrite(plan, spot, Tile.Shrine);
    pois.push({ ...toPoint(spot, w), kind: PoiKind.Shrine, biome: b as Biome });
  }

  const boatYardIndex = pickBoatYard(plan, w, h, spawn, taken);
  taken.add(boatYardIndex);
  overwrite(plan, boatYardIndex, Tile.BoatYard);
  pois.push({
    ...toPoint(boatYardIndex, w),
    kind: PoiKind.BoatYard,
    biome: biome[boatYardIndex] as Biome,
  });

  return {
    spawn: toPoint(spawn, w),
    ark: toPoint(arkIndex, w),
    boatYard: toPoint(boatYardIndex, w),
    pois,
  };
}

function pickArkSite(elev: Uint8Array, plan: Uint8Array, w: number, h: number): number {
  const limit = Math.floor(h / 3);
  const cx = (w - 1) / 2;
  let best = -1;
  let bestScore = -Infinity;

  for (let y = 2; y < limit; y++) {
    for (let x = 3; x < w - 3; x++) {
      const i = y * w + x;
      if (onPanelEdge(x, y) || isWorldRim(x, y, w, h)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
      const centrality = 1 - Math.abs(x - cx) / cx;
      const score = elev[i] + centrality * 18;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best >= 0 ? best : (Math.floor(h / 6) * w + ((w / 2) | 0));
}

/**
 * A raised platform you climb stairs onto, dominating its panel. Appearance
 * of the hull itself is a runtime overlay of what's been delivered; worldgen
 * only lays the yard.
 */
function stampArkPlatform(
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  ark: number,
): void {
  const ax = ark % w;
  const ay = (ark / w) | 0;
  for (let dy = -3; dy <= 1; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = ax + dx;
      const y = ay + dy;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 3) continue;
      const i = y * w + x;
      const raised = elev[i] + 18;
      elev[i] = raised > 255 ? 255 : raised;
      if (dy === 1) stamp(plan, i, Tile.Steps);
      else stamp(plan, i, Tile.StoneGround);
    }
  }
  overwrite(plan, ark, Tile.ArkSite);
}

function pickSpawn(
  rng: Rng,
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  arkIndex: number,
): number {
  const until = Math.max(4, Math.floor(h * 0.2));
  const arkX = arkIndex % w;
  const arkY = (arkIndex / w) | 0;
  const candidates: number[] = [];

  for (let y = 2; y < until; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (onPanelEdge(x, y)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff || plan[i] === Tile.ArkSite) continue;
      const dx = x - arkX;
      const dy = y - arkY;
      if (dx * dx + dy * dy < 14 * 14) continue;
      candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    return clampIndex(arkIndex + 16, plan.length);
  }
  candidates.sort((a, b) => elev[a] - elev[b]);
  const lo = Math.floor(candidates.length * 0.25);
  const hi = Math.max(lo + 1, Math.floor(candidates.length * 0.55));
  const pool = candidates.slice(lo, hi);
  return pool[Math.floor(rng() * pool.length)];
}

function stampCamp(plan: Uint8Array, w: number, h: number, spawn: number): void {
  const x = spawn % w;
  const y = (spawn / w) | 0;
  overwrite(plan, spawn, Tile.Path);
  const neighbors = [
    [x, y - 1],
    [x - 1, y],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x - 1, y + 1],
    [x + 1, y + 1],
  ];
  for (const [nx, ny] of neighbors) {
    if (nx <= 1 || ny <= 1 || nx >= w - 2 || ny >= h - 3) continue;
    if (onPanelEdge(nx, ny)) continue;
    const i = ny * w + nx;
    if (plan[i] === Tile.Water || plan[i] === Tile.Cliff || plan[i] === Tile.ArkSite) continue;
    overwrite(plan, i, Tile.Tent);
    return;
  }
}

function pickDungeon(
  rng: Rng,
  plan: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
  want: Biome,
  taken: Set<number>,
  town: Settlement | undefined,
): number | undefined {
  const candidates: number[] = [];
  for (let y = 3; y < h - 4; y++) {
    for (let x = 3; x < w - 3; x++) {
      const i = y * w + x;
      if (biome[i] !== want) continue;
      if (onPanelEdge(x, y) || isWorldRim(x, y, w, h)) continue;
      if (taken.has(i)) continue;
      const t = plan[i];
      if (t === Tile.TownDoor || t === Tile.Shrine || t === Tile.ArkSite) continue;
      const nearCliff = want !== Biome.Valley && touches(plan, w, h, x, y, Tile.Cliff);
      const open = t === UNPLANNED || t === Tile.Cliff || t === Tile.StoneGround;
      if (!open && !nearCliff) continue;
      if (town) {
        const dx = x - town.x;
        const dy = y - town.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 10 * 10 || d2 > 36 * 36) continue;
      }
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return pickOpen(rng, plan, biome, w, h, want, taken, 12);
  const shuffled = shuffle(rng, candidates);
  return shuffled[0];
}

function stampDungeonMouth(plan: Uint8Array, w: number, h: number, i: number, biome: Biome): void {
  const x = i % w;
  const y = (i / w) | 0;
  const frame = biome === Biome.Forest ? Tile.Tree : Tile.Rock;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (onPanelEdge(nx, ny) || isWorldRim(nx, ny, w, h)) continue;
      const j = ny * w + nx;
      if (plan[j] === Tile.Water || plan[j] === Tile.Shrine || plan[j] === Tile.TownDoor) continue;
      stamp(plan, j, frame);
    }
  }
  overwrite(plan, i, Tile.DungeonEntrance);
  // Leave the south open so the mouth is a door, not a sealed well.
  const south = (y + 1) * w + x;
  if (y + 1 < h - 2 && !isWorldRim(x, y + 1, w, h) && !onPanelEdge(x, y + 1)) {
    overwrite(plan, south, Tile.Path);
  }
}

function pickOpen(
  rng: Rng,
  plan: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
  want: Biome,
  taken: Set<number>,
  minDist: number,
): number | undefined {
  const pool: number[] = [];
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (biome[i] !== want) continue;
      if (onPanelEdge(x, y)) continue;
      if (taken.has(i)) continue;
      if (plan[i] !== UNPLANNED) continue;
      pool.push(i);
    }
  }
  const shuffled = shuffle(rng, pool);
  for (const i of shuffled) {
    if (farFrom(i, taken, w, minDist)) return i;
  }
  return shuffled[0];
}

function pickBoatYard(
  plan: Uint8Array,
  w: number,
  h: number,
  spawn: number,
  taken: Set<number>,
): number {
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] !== Tile.BoatYard || taken.has(i)) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (onPanelEdge(x, y) || isWorldRim(x, y, w, h)) continue;
    return i;
  }
  const spawnX = spawn % w;
  const spawnY = (spawn / w) | 0;
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (taken.has(i) || onPanelEdge(x, y)) continue;
      if (plan[i] !== UNPLANNED && plan[i] !== Tile.Path && plan[i] !== Tile.Dirt) continue;
      if (!touches(plan, w, h, x, y, Tile.Water)) continue;
      return i;
    }
  }
  return spawnY * w + spawnX;
}

function touches(plan: Uint8Array, w: number, h: number, x: number, y: number, tile: number): boolean {
  const n4 = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of n4) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (plan[ny * w + nx] === tile) return true;
  }
  return false;
}

function farFrom(i: number, taken: Set<number>, w: number, minDist: number): boolean {
  const x = i % w;
  const y = (i / w) | 0;
  const min2 = minDist * minDist;
  for (const t of taken) {
    const dx = (t % w) - x;
    const dy = ((t / w) | 0) - y;
    if (dx * dx + dy * dy < min2) return false;
  }
  return true;
}

function toPoint(i: number, w: number): Point {
  return { x: i % w, y: (i / w) | 0 };
}

function clampIndex(i: number, n: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}
