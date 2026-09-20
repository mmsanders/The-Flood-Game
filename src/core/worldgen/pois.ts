/**
 * Siting: the ark, spawn, shrines (already placed with towns), dungeons,
 * hearts, and the remaining docks.
 *
 * Runs after settlements so a shrine can sit south-east of town on a real
 * bearing, and a dungeon mouth can be cut into rock rather than dropped on
 * grass. Writes into the plan; paint fills whatever is still unplanned.
 */

import { PANEL_H, PANEL_W, type WorldParams, tileHeight, tileWidth } from '../config.js';
import { shuffle, stageRng, type Rng } from '../rng.js';
import { BIOME_COUNT, Biome, Tile, carveTo } from '../tiles.js';
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

  // Spawn is chosen first now, and the ark is built on the panel directly
  // north of it. The ark used to be sited independently and joined to the
  // world by a road, which made the single most important place on the map
  // something you had to go looking for.
  const spawn = pickSpawn(rng, plan, elev, w, h);
  taken.add(spawn);
  stampCamp(plan, w, h, spawn);

  const arkIndex = buildArkPanel(plan, elev, biome, w, h, spawn);
  taken.add(arkIndex);
  pois.push({ ...toPoint(arkIndex, w), kind: PoiKind.Ark, biome: biome[arkIndex] as Biome });

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

/**
 * Build the ark on its own hand-authored panel, one screen north of spawn.
 *
 * This is the only panel in the world that is not generated. Everything else
 * is noise the pipeline shapes; this is a place, and it is laid out the same
 * way every run so that "the ark is one screen north of your tent" is a thing
 * you learn once and then always know.
 *
 * The whole panel is overwritten, so a road, a gorge or a stray tree cannot
 * wander through it. A walled platform fills the centre-bottom with a single
 * stair up from the south — the hull then grows out of it as you deliver, and
 * by the end it covers most of the screen.
 */
function buildArkPanel(
  plan: Uint8Array,
  elev: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
  spawn: number,
): number {
  const panelX = ((spawn % w) / PANEL_W) | 0;
  const panelY = (((spawn / w) | 0) / PANEL_H) | 0;
  const arkPanelY = Math.max(1, panelY - 1);
  const x0 = panelX * PANEL_W;
  const y0 = arkPanelY * PANEL_H;

  // The platform: twelve by seven out of sixteen by eleven, sitting low and
  // central, which leaves a walkable margin on three sides so the panel is a
  // place you pass through rather than a cul-de-sac.
  const px0 = 2;
  const px1 = 13;
  const py0 = 3;
  const py1 = 9;
  const stairA = 7;
  const stairB = 8;

  let peak = 0;
  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px++) {
      const x = x0 + px;
      const y = y0 + py;
      if (x >= w || y >= h) continue;
      const e = elev[y * w + x];
      if (e > peak) peak = e;
    }
  }

  let arkIndex = -1;
  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px++) {
      const x = x0 + px;
      const y = y0 + py;
      if (x >= w || y >= h) continue;
      if (isWorldRim(x, y, w, h)) continue;
      const i = y * w + x;

      const onPlatform = px >= px0 && px <= px1 && py >= py0 && py <= py1;
      if (!onPlatform) {
        // Level approach ground, so the panel reads as a terrace rather than
        // as whatever hillside the generator happened to leave here. It keeps
        // the biome's own ground: paving the whole screen made the last place
        // in the world look like a dungeon floor.
        elev[i] = peak;
        const stair = py === py1 + 1 && (px === stairA || px === stairB);
        overwrite(plan, i, stair ? Tile.Steps : carveTo(biome[i] as Biome));
        continue;
      }

      // Raised, so it is the last ground in the world to go under.
      elev[i] = Math.min(255, peak + ARK_PLATFORM_RISE);
      const edge = px === px0 || px === px1 || py === py0 || py === py1;
      const doorway = py === py1 && (px === stairA || px === stairB);
      if (doorway) overwrite(plan, i, Tile.Steps);
      else if (edge) overwrite(plan, i, Tile.Cliff);
      else overwrite(plan, i, Tile.StoneGround);
    }
  }

  const ax = x0 + ((px0 + px1) >> 1);
  const ay = y0 + ((py0 + py1) >> 1);
  if (ax < w && ay < h) {
    arkIndex = ay * w + ax;
    overwrite(plan, arkIndex, Tile.ArkSite);
  }

  return arkIndex >= 0 ? arkIndex : y0 * w + x0;
}

/**
 * How far the ark platform stands above its own panel.
 *
 * Over the renderer's step threshold on purpose, so the platform draws a real
 * cliff face down its south side instead of sitting flush with the ground it
 * is supposed to tower over.
 */
const ARK_PLATFORM_RISE = 48;

/**
 * Where the run starts: the high north, with a clear panel to the north of it
 * for the ark.
 *
 * Panel row 2 or lower is the floor, so the ark's panel is never the world
 * rim. The panel above must also be free of gorge and lake, because the ark
 * panel overwrites everything in it and severing the river there would be
 * both ugly and a real loss — the channel is the skiff's road.
 */
function pickSpawn(
  rng: Rng,
  plan: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): number {
  const until = Math.max(4, Math.floor(h * 0.2));
  const candidates: number[] = [];

  for (let y = PANEL_H * 2; y < until; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (onPanelEdge(x, y)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
      if (!panelAboveIsClear(plan, w, h, x, y)) continue;
      candidates.push(i);
    }
  }
  const pool = candidates.length > 0 ? candidates : fallbackSpawns(plan, w, until);
  if (pool.length === 0) return PANEL_H * 2 * w + ((w / 2) | 0);

  pool.sort((a, b) => elev[a] - elev[b]);
  const lo = Math.floor(pool.length * 0.25);
  const hi = Math.max(lo + 1, Math.floor(pool.length * 0.55));
  const band = pool.slice(lo, hi);
  return band[Math.floor(rng() * band.length)];
}

/** True if the panel one north of (x, y) has no water or gorge to destroy. */
function panelAboveIsClear(
  plan: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): boolean {
  const panelX = (x / PANEL_W) | 0;
  const panelY = (y / PANEL_H) | 0;
  if (panelY < 2) return false;
  const x0 = panelX * PANEL_W;
  const y0 = (panelY - 1) * PANEL_H;
  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px++) {
      const cx = x0 + px;
      const cy = y0 + py;
      if (cx >= w || cy >= h) continue;
      const t = plan[cy * w + cx];
      if (t === Tile.Water || t === Tile.Gorge || t === Tile.Bridge) return false;
    }
  }
  return true;
}

/** Any northern ground with a panel above it, when the strict pass finds none. */
function fallbackSpawns(plan: Uint8Array, w: number, until: number): number[] {
  const pool: number[] = [];
  for (let y = PANEL_H * 2; y < until; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (onPanelEdge(x, y)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Cliff) continue;
      pool.push(i);
    }
  }
  return pool;
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
    overwrite(plan, i, Tile.CampTent);
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
