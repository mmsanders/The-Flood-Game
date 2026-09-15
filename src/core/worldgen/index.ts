/**
 * World generation pipeline.
 *
 *   elevation → landforms → settlements → siting → roads → paint →
 *   connectivity repair → validation
 *
 * Later passes overwrite earlier ones via the plan buffer, so a road stays a
 * road and a pasture stays a pasture instead of growing a random tree. Each
 * stage draws from its own derived sub-seed, so re-tuning one stage does not
 * reshuffle the others.
 */

import {
  DEFAULT_PARAMS,
  type WorldParams,
  tileHeight,
  tileWidth,
} from '../config.js';
import { generateDungeonRoom } from '../dungeon.js';
import { checkSolvable } from '../resources.js';
import { deriveSeed } from '../rng.js';
import { BIOME_COUNT, RESOURCE_COUNT, isWalkable, resourceOf } from '../tiles.js';
import { PoiKind, type World, type WorldStats } from '../world.js';
import { spawnAnimals } from '../animals.js';
import { ensureConnected } from './connectivity.js';
import { generateElevation } from './elevation.js';
import { carveLandforms } from './landforms.js';
import { paintTiles } from './paint.js';
import { freshPlan } from './plan.js';
import { placePois } from './pois.js';
import { layRoads } from './roads.js';
import { paintSouthBeach, wallWorldRim } from './seams.js';
import { placeSettlements } from './settlements.js';

export { ensureConnected, labelRegions } from './connectivity.js';
export { generateElevation } from './elevation.js';

export function generateWorld(seed: number, params: WorldParams = DEFAULT_PARAMS): World {
  const w = tileWidth(params);
  const h = tileHeight(params);

  const { elev, biome } = generateElevation(seed, params);
  const plan = freshPlan(w * h);

  carveLandforms(seed, params, elev, biome, plan);
  const { settlements, pastures } = placeSettlements(seed, params, biome, plan);
  const { spawn, ark, pois, boatYard } = placePois(seed, params, elev, biome, plan, settlements);

  layRoads(seed, params, biome, plan, settlements, {
    ark,
    spawn,
    dungeons: pois.filter((p) => p.kind === PoiKind.Dungeon),
    docks: pois.filter((p) => p.kind === PoiKind.BoatYard),
  });

  const tiles = paintTiles({ seed, params, elev, biome, plan });

  const connectivity = ensureConnected(tiles, biome, params);
  // Re-stamp the frame in case a seam carve nicked a rim tile.
  wallWorldRim(tiles, biome, elev, w, h);
  paintSouthBeach(tiles, w, h);

  const reserved = new Set<number>();
  reserved.add(spawn.y * w + spawn.x);
  reserved.add(ark.y * w + ark.x);
  reserved.add(boatYard.y * w + boatYard.x);
  for (const poi of pois) reserved.add(poi.y * w + poi.x);
  const livePastures = pastures.filter((i) => isWalkable(tiles[i]) && !reserved.has(i));
  const animals = spawnAnimals(seed, tiles, biome, w, reserved, spawn, livePastures);

  // One dungeon per entrance placed above. They are separate maps, so nothing
  // here touches the overworld's own connectivity or solvability.
  const dungeons = pois
    .filter((poi) => poi.kind === PoiKind.Dungeon)
    .map((poi, i) => generateDungeonRoom(seed, i, poi.biome, { x: poi.x, y: poi.y }));

  const solvability = checkSolvable(tiles, elev, w, h, spawn, params);

  const stats = collectStats(tiles, biome, w, h);
  stats.connected = connectivity.connected;
  stats.solvable = solvability.solvable;
  stats.reachableResources = solvability.reachable;
  stats.problems = [
    ...(connectivity.connected ? [] : ['World is not fully connected']),
    ...solvability.problems,
  ];

  return {
    seed,
    params,
    w,
    h,
    tiles,
    elev,
    biome,
    floods: true,
    spawn,
    ark,
    boatYard,
    pois,
    settlements,
    pastures: livePastures,
    animals,
    dungeons,
    stats,
  };
}

/**
 * Generate a world that passes validation, re-rolling the seed if it doesn't.
 *
 * Returns the last attempt even if all of them fail, so the dev tool can show
 * you a broken world and say why rather than hanging or throwing.
 */
export function generateValidWorld(
  seed: number,
  params: WorldParams = DEFAULT_PARAMS,
  maxAttempts = 8,
): { world: World; attempts: number } {
  let world = generateWorld(seed, params);
  let attempts = 1;

  while (!world.stats.connected || !world.stats.solvable) {
    if (attempts >= maxAttempts) break;
    world = generateWorld(deriveSeed(seed, `retry:${attempts}`), params);
    attempts++;
  }

  return { world, attempts };
}

function collectStats(
  tiles: Uint8Array,
  biome: Uint8Array,
  w: number,
  h: number,
): WorldStats {
  const biomeTiles = new Array<number>(BIOME_COUNT).fill(0);
  const resourceNodes = new Array<number>(RESOURCE_COUNT).fill(0);
  let walkableTiles = 0;

  for (let i = 0; i < tiles.length; i++) {
    biomeTiles[biome[i]]++;
    if (isWalkable(tiles[i])) walkableTiles++;
    const res = resourceOf(tiles[i]);
    if (res !== null) resourceNodes[res]++;
  }

  return {
    biomeTiles,
    resourceNodes,
    reachableResources: new Array<number>(RESOURCE_COUNT).fill(0),
    walkableTiles,
    totalTiles: w * h,
    connected: false,
    solvable: false,
    problems: [],
  };
}
