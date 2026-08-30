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
    if (isWalkable(tiles[i])) walkableByBiome[biome[i]].push(i);
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

  // -- Spawn: the valley, well south, on the mainland ------------------------
  const spawn = pickSpawn(rng, tiles, elev, w, h);
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

  return { spawn: toPoint(spawn, w), ark: toPoint(ark, w), pois };
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
 * Spawn in the lowlands: bottom fifth of the map, lowest walkable ground we
 * can find there. The player should start where the water starts.
 */
function pickSpawn(
  rng: () => number,
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): number {
  const from = Math.floor(h * 0.8);
  const candidates: number[] = [];

  for (let y = from; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isWalkable(tiles[i])) candidates.push(i);
    }
  }
  if (candidates.length === 0) return findAnyWalkable(tiles, tiles.length - 1);

  // Prefer the lower half of what's available, then pick randomly among those
  // so the same seed's spawn isn't pinned to one deterministic corner.
  candidates.sort((a, b) => elev[a] - elev[b]);
  const pool = candidates.slice(0, Math.max(1, Math.floor(candidates.length / 2)));
  return pool[Math.floor(rng() * pool.length)];
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
