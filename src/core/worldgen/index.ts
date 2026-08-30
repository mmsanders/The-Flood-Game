/**
 * World generation pipeline.
 *
 *   elevation -> biomes -> paint -> connectivity repair -> POIs -> validation
 *
 * Each stage draws from its own derived sub-seed, so re-tuning one stage does
 * not reshuffle the others.
 */

import {
  DEFAULT_PARAMS,
  type WorldParams,
  tileHeight,
  tileWidth,
} from '../config.js';
import { generateDungeon } from '../dungeon.js';
import { checkSolvable } from '../resources.js';
import { deriveSeed } from '../rng.js';
import { BIOME_COUNT, RESOURCE_COUNT, isWalkable, resourceOf } from '../tiles.js';
import { PoiKind, type World, type WorldStats } from '../world.js';
import { ensureConnected } from './connectivity.js';
import { generateElevation } from './elevation.js';
import { paintTiles } from './paint.js';
import { placePois } from './pois.js';

export { ensureConnected, labelRegions } from './connectivity.js';
export { generateElevation } from './elevation.js';

export function generateWorld(seed: number, params: WorldParams = DEFAULT_PARAMS): World {
  const w = tileWidth(params);
  const h = tileHeight(params);

  const { elev, biome } = generateElevation(seed, params);
  const tiles = paintTiles({ seed, params, elev, biome });

  const connectivity = ensureConnected(tiles, biome, params);
  const { spawn, ark, pois } = placePois(seed, params, tiles, elev, biome);

  // One dungeon per entrance placed above. They are separate maps, so nothing
  // here touches the overworld's own connectivity or solvability.
  const dungeons = pois
    .filter((poi) => poi.kind === PoiKind.Dungeon)
    .map((poi, i) => generateDungeon(seed, i, poi.biome, { x: poi.x, y: poi.y }));

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
    pois,
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
