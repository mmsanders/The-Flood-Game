/**
 * World generation pipeline.
 *
 *   elevation → landforms → settlements → siting → roads → paint →
 *   seal elevation faces → connectivity repair → validation
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
import { generateInterior, InteriorKind } from '../interior.js';
import { checkSolvable } from '../resources.js';
import { deriveSeed } from '../rng.js';
import { BIOME_COUNT, Biome, RESOURCE_COUNT, Tile, isWalkable, resourceOf } from '../tiles.js';
import { PoiKind, type World, type WorldStats } from '../world.js';
import { spawnAnimals } from '../animals.js';
import { ensureConnected } from './connectivity.js';
import { generateElevation } from './elevation.js';
import { sealElevationFaces } from './escarpments.js';
import { carveLandforms } from './landforms.js';
import { paintTiles } from './paint.js';
import { freshPlan } from './plan.js';
import { placePois } from './pois.js';
import { layRoads } from './roads.js';
import { clearStairApproaches, paintSouthBeach, wallWorldRim } from './seams.js';
import { placeSettlements } from './settlements.js';

export { ensureConnected, labelRegions } from './connectivity.js';
export { generateElevation } from './elevation.js';

export function generateWorld(seed: number, params: WorldParams = DEFAULT_PARAMS): World {
  const w = tileWidth(params);
  const h = tileHeight(params);

  const { elev, biome } = generateElevation(seed, params);
  const plan = freshPlan(w * h);

  carveLandforms(seed, params, elev, biome, plan);
  const { settlements, pastures } = placeSettlements(seed, params, elev, biome, plan);
  const { spawn, ark, pois, boatYard } = placePois(seed, params, elev, biome, plan, settlements);

  layRoads(seed, params, elev, biome, plan, settlements, {
    spawn,
    dungeons: pois.filter((p) => p.kind === PoiKind.Dungeon),
    docks: pois.filter((p) => p.kind === PoiKind.BoatYard),
  });

  const tiles = paintTiles({ seed, params, elev, biome, plan });

  // Catch-up: painted grass on a hard drop becomes Cliff before connectivity
  // punches stairs through, so a visual face is never walkable ground.
  sealElevationFaces(tiles, elev, w, h);

  const connectivity = ensureConnected(tiles, biome, params);
  // After the repair, not before: that pass cuts its own stairs when it carves
  // a route through a cliff, and those need clearing too. Removing scatter can
  // only make the map more connected, never less.
  clearStairApproaches(tiles, biome, w, h);
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

  const interiors = placeInteriors(tiles, biome, w, h, spawn, boatYard);

  const solvability = checkSolvable(
    tiles,
    elev,
    w,
    h,
    spawn,
    params,
    pois.filter((p) => p.kind === PoiKind.Shrine),
  );

  const stats = collectStats(tiles, biome, w, h);
  stats.connected = connectivity.connected;
  stats.solvable = solvability.solvable;
  stats.reachableResources = solvability.reachable;
  stats.ladder = solvability.ladder;
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
    interiors,
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


/** Wave-three doors: every market, the hermitage, the slipway, Noah's tent. */
function placeInteriors(
  tiles: Uint8Array,
  biomePlane: Uint8Array,
  w: number,
  h: number,
  spawn: { x: number; y: number },
  boatYard: { x: number; y: number },
) {
  const interiors: ReturnType<typeof generateInterior>[] = [];
  let id = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] !== Tile.TownDoor) continue;
      const b = biomePlane[i] as Biome;
      const kind = b === Biome.Mountain ? InteriorKind.Hermit : InteriorKind.Shop;
      interiors.push(generateInterior(kind, id++, b, { x, y }));
    }
  }

  interiors.push(
    generateInterior(
      InteriorKind.Carpenter,
      id++,
      biomePlane[boatYard.y * w + boatYard.x] as Biome,
      { x: boatYard.x, y: boatYard.y },
    ),
  );

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = spawn.x + dx;
      const y = spawn.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (tiles[y * w + x] !== Tile.CampTent) continue;
      interiors.push(
        generateInterior(InteriorKind.NoahTent, id++, biomePlane[y * w + x] as Biome, { x, y }),
      );
      return interiors;
    }
  }

  return interiors;
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
    ladder: [],
    problems: [],
  };
}
