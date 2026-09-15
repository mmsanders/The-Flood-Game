/**
 * Points of interest: where the run starts, where it ends, and what's worth
 * a detour in between.
 *
 * Runs after connectivity repair, so every candidate tile is already known to
 * be reachable. Placement then only has to care about elevation and biome.
 */

import { type WorldParams, tileHeight, tileWidth } from '../config.js';
import { shuffle, stageRng } from '../rng.js';
import { BIOME_COUNT, Biome, Tile, isWalkable } from '../tiles.js';
import { type Point, type Poi, PoiKind } from '../world.js';

export interface PoiPlacement {
  spawn: Point;
  ark: Point;
  boatYard: Point;
  pois: Poi[];
}

export function placePois(
  seed: number,
  params: WorldParams,
  tiles: Uint8Array,
  elev: Uint8Array,
  biome: Uint8Array,
): PoiPlacement {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'pois');

  const walkableByBiome: number[][] = Array.from({ length: BIOME_COUNT }, () => []);
  for (let i = 0; i < tiles.length; i++) {
    if (!isWalkable(tiles[i])) continue;
    const x = i % w;
    const y = (i / w) | 0;
    // Keep the beach and the rim free of POIs so the south shore stays sand.
    if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 2) continue;
    walkableByBiome[biome[i]].push(i);
  }

  const pois: Poi[] = [];
  const taken = new Set<number>();

  // -- The ark site: high, northern, central ---------------------------------
  // It should be among the last ground to drown, so the run's final act is a
  // scramble uphill rather than a walk to a place that's already gone.
  const ark = pickArkSite(elev, w, h, tiles);
  taken.add(ark);
  tiles[ark] = Tile.ArkSite;
  pois.push({ ...toPoint(ark, w), kind: PoiKind.Ark, biome: biome[ark] as Biome });

  // -- Spawn: the high north, away from the ark, so the run is a descent -----
  const spawn = pickSpawn(rng, tiles, elev, w, h, ark);
  taken.add(spawn);

  // -- Dungeons: one per biome ----------------------------------------------
  for (let b = 0; b < BIOME_COUNT; b++) {
    const candidates = shuffle(rng, walkableByBiome[b].slice());
    for (let d = 0; d < params.dungeonsPerBiome; d++) {
      const spot = candidates.find(
        (i) => !taken.has(i) && farFrom(i, taken, w, 12) && isWalkable(tiles[i]),
      );
      if (spot === undefined) continue;
      taken.add(spot);
      tiles[spot] = Tile.DungeonEntrance;
      pois.push({ ...toPoint(spot, w), kind: PoiKind.Dungeon, biome: b as Biome });
    }
  }

  // -- Heart containers: spread across biomes -------------------------------
  for (let n = 0; n < params.heartContainers; n++) {
    const b = n % BIOME_COUNT;
    const candidates = shuffle(rng, walkableByBiome[b].slice());
    const spot = candidates.find(
      (i) => !taken.has(i) && farFrom(i, taken, w, 10) && isWalkable(tiles[i]),
    );
    if (spot === undefined) continue;
    taken.add(spot);
    tiles[spot] = Tile.HeartContainer;
    pois.push({ ...toPoint(spot, w), kind: PoiKind.Heart, biome: b as Biome });
  }

  // -- Rod shrines: one per biome, in order of the harvest ladder ------------
  for (let b = 0; b < BIOME_COUNT; b++) {
    const candidates = shuffle(rng, walkableByBiome[b].slice());
    const spot = candidates.find(
      (i) => !taken.has(i) && farFrom(i, taken, w, 10) && isWalkable(tiles[i]),
    );
    if (spot === undefined) continue;
    taken.add(spot);
    tiles[spot] = Tile.Shrine;
    pois.push({ ...toPoint(spot, w), kind: PoiKind.Shrine, biome: b as Biome });
  }

  // -- The slipway: a valley dock where a skiff can be framed ----------------
  // Prefer a bank next to natural water so the first launch has somewhere to
  // go before the flood arrives. Any reachable valley tile will do otherwise.
  const boatYardIndex = pickBoatYard(rng, tiles, walkableByBiome[Biome.Valley], taken, w, spawn);
  taken.add(boatYardIndex);
  tiles[boatYardIndex] = Tile.BoatYard;
  pois.push({
    ...toPoint(boatYardIndex, w),
    kind: PoiKind.BoatYard,
    biome: biome[boatYardIndex] as Biome,
  });

  return {
    spawn: toPoint(spawn, w),
    ark: toPoint(ark, w),
    boatYard: toPoint(boatYardIndex, w),
    pois,
  };
}

/**
 * Highest walkable ground in the northern third, biased toward the middle
 * columns so the final approach isn't pinned against a map edge.
 */
function pickArkSite(elev: Uint8Array, w: number, h: number, tiles: Uint8Array): number {
  const limit = Math.floor(h / 3);
  const cx = (w - 1) / 2;
  let best = -1;
  let bestScore = -Infinity;

  for (let y = 0; y < limit; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isWalkable(tiles[i])) continue;
      // Elevation dominates; centrality is a mild tiebreak.
      const centrality = 1 - Math.abs(x - cx) / cx;
      const score = elev[i] + centrality * 18;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }

  return best >= 0 ? best : findAnyWalkable(tiles, 0);
}

/**
 * Spawn in the high north, not on the ark, so the run is: walk down, gather,
 * climb back. Lower-mid elevation among northern candidates keeps the ark
 * the last ground standing.
 */
function pickSpawn(
  rng: () => number,
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  arkIndex: number,
): number {
  const until = Math.max(3, Math.floor(h * 0.2));
  const arkX = arkIndex % w;
  const arkY = (arkIndex / w) | 0;
  const candidates: number[] = [];

  for (let y = 1; y < until; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!isWalkable(tiles[i])) continue;
      const dx = x - arkX;
      const dy = y - arkY;
      if (dx * dx + dy * dy < 14 * 14) continue;
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return findAnyWalkable(tiles, 0);

  candidates.sort((a, b) => elev[a] - elev[b]);
  const lo = Math.floor(candidates.length * 0.25);
  const hi = Math.max(lo + 1, Math.floor(candidates.length * 0.55));
  const pool = candidates.slice(lo, hi);
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * A valley bank next to a pond if one exists, otherwise any valley tile that
 * isn't already a shrine. The slipway has to be reachable — this runs after
 * connectivity repair — so the player can actually walk to it.
 */
function pickBoatYard(
  rng: () => number,
  tiles: Uint8Array,
  valleyWalkable: readonly number[],
  taken: Set<number>,
  w: number,
  spawnIndex: number,
): number {
  const shores: number[] = [];
  const closeShores: number[] = [];
  const inland: number[] = [];
  for (const i of valleyWalkable) {
    if (taken.has(i) || i === spawnIndex) continue;
    const shore = touchesWater(tiles, i, w);
    const far = farFrom(i, taken, w, 6);
    if (shore && far) shores.push(i);
    else if (shore) closeShores.push(i);
    else if (far) inland.push(i);
  }
  const pool = shores.length > 0 ? shores : closeShores.length > 0 ? closeShores : inland;
  if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  for (const i of valleyWalkable) {
    if (!taken.has(i)) return i;
  }
  return spawnIndex;
}

function touchesWater(tiles: Uint8Array, i: number, w: number): boolean {
  const h = (tiles.length / w) | 0;
  const x = i % w;
  const y = (i / w) | 0;
  const n = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of n) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (tiles[ny * w + nx] === Tile.Water) return true;
  }
  return false;
}

function findAnyWalkable(tiles: Uint8Array, near: number): number {
  for (let i = near; i < tiles.length; i++) if (isWalkable(tiles[i])) return i;
  for (let i = 0; i < tiles.length; i++) if (isWalkable(tiles[i])) return i;
  return 0;
}

/** Keep points of interest from clumping into the same corner. */
function farFrom(i: number, taken: Set<number>, w: number, minDist: number): boolean {
  const x = i % w;
  const y = (i / w) | 0;
  for (const t of taken) {
    const dx = (t % w) - x;
    const dy = ((t / w) | 0) - y;
    if (dx * dx + dy * dy < minDist * minDist) return false;
  }
  return true;
}

function toPoint(i: number, w: number): Point {
  return { x: i % w, y: (i / w) | 0 };
}
