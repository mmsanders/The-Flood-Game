/**
 * The skiff's whole lifecycle: building and pitching it at a boatyard,
 * hauling it overland, launching, shoving off, beaching, and setting it down.
 */

import {
  BASE_BOAT_DEPTH,
  BOAT_COST_FIBER,
  BOAT_COST_WOOD,
  BOAT_PITCH_COST,
  BOAT_RECAULK_FIBER,
  boatDestroyedAtDepth,
  canAffordBoat,
  canAffordPitching,
  payForBoat,
  payForPitching,
  PITCHED_BOAT_DEPTH,
} from '../core/boat.js';
import { TILE_PX } from '../core/config.js';
import { gorgeDepthAt, waterDepth } from '../core/flood.js';
import { Biome, carveTo, isWalkable, Resource, Tile } from '../core/tiles.js';
import type { Point } from '../core/world.js';
import { syncInterpolation } from './camera.js';
import {
  activeMap,
  currentDay,
  depthAt,
  isBoatableTile,
  say,
  tileUnder,
  waterLevel,
} from './queries.js';
import { type Action, type GameState, type ObstaclePrompt, PLAYER_H, PLAYER_W } from './types.js';

/** Reused so the every-frame launch prompt does not allocate a point. */
const boatSpot: Point = { x: 0, y: 0 };

const NEIGHBOUR_DX = [0, 0, -1, 1];
const NEIGHBOUR_DY = [-1, 1, 0, 0];

/** Step from shore into reachable water and become the skiff. */
export function tryShoveOff(state: GameState, x: number, y: number): boolean {
  if (!state.hasBoat || state.inBoat || state.location.kind !== 'overworld') return false;
  // A set-down skiff elsewhere is not magically in Noah's pocket. Old hot
  // states have boatX=-1, so they retain the old launch behaviour safely.
  if (!state.haulingBoat && state.boatX >= 0) return false;

  for (let c = 0; c < 4; c++) {
    const cx = c & 1 ? x + PLAYER_W - 1 : x;
    const cy = c & 2 ? y + PLAYER_H - 1 : y;
    const tx = Math.floor(cx / TILE_PX);
    const ty = Math.floor(cy / TILE_PX);
    if (!isBoatableTile(state, tx, ty)) continue;
    state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
    state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
    syncInterpolation(state);
    state.inBoat = true;
    state.haulingBoat = false;
    state.boatX = -1;
    state.boatY = -1;
    say(state, 'You shove off.');
    return true;
  }
  return false;
}

export function maybeBeach(state: GameState): void {
  if (!state.inBoat) return;
  const map = activeMap(state);
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  const i = ty * map.w + tx;
  if (depthAt(state, tx, ty) > 0) return;
  if (!isWalkable(map.tiles[i])) return;
  state.inBoat = false;
  state.haulingBoat = true;
  say(state, 'You beach the skiff and take the painter.');
}

export function checkStrandedBoat(state: GameState): void {
  if (
    !state.hasBoat ||
    state.inBoat ||
    state.haulingBoat ||
    state.boatX < 0 ||
    state.boatY < 0
  ) {
    return;
  }

  const world = state.world;
  const tx = state.boatX;
  const ty = state.boatY;
  if (tx >= world.w || ty >= world.h) return;

  const i = ty * world.w + tx;
  const runoff = gorgeDepthAt(currentDay(state), ty, world.h);
  const depth = waterDepth(world.tiles[i], world.elev[i], waterLevel(state), runoff);
  if (!boatDestroyedAtDepth(state.boatDepth, depth)) return;

  if (world.tiles[i] === Tile.Skiff) world.tiles[i] = state.boatUnderTile;
  state.hasBoat = false;
  state.inBoat = false;
  state.haulingBoat = false;
  state.boatDepth = BASE_BOAT_DEPTH;
  state.boatX = -1;
  state.boatY = -1;
  state.mapRevision++;
  say(state, 'The deep took the skiff you left behind.');
}

export function boatYardPrompt(state: GameState, biome: Biome): ObstaclePrompt | null {
  if (state.haulingBoat && state.boatDepth < PITCHED_BOAT_DEPTH && biome >= Biome.Scrub) {
    return {
      tile: Tile.BoatYard,
      label: `Recaulk for depth 3 — ${BOAT_PITCH_COST} pitch + ${BOAT_RECAULK_FIBER} fiber`,
      affordable: canAffordPitching(state.carried),
    };
  }
  if (!state.inBoat && !state.haulingBoat) {
    const wood = state.carried[Resource.Wood];
    const fiber = state.carried[Resource.Fiber];
    return {
      tile: Tile.BoatYard,
      label: `Frame a skiff — ${BOAT_COST_WOOD} wood, ${BOAT_COST_FIBER} fiber (you have ${wood}, ${fiber})`,
      affordable: canAffordBoat(state.carried),
    };
  }
  return null;
}

export function handleBoatYard(state: GameState, biome: Biome): boolean {
  if (state.haulingBoat && state.boatDepth < PITCHED_BOAT_DEPTH && biome >= Biome.Scrub) {
    tryPitchBoat(state);
    return true;
  }
  if (!state.inBoat && !state.haulingBoat) {
    tryCraftBoat(state);
    return true;
  }
  return false;
}

/**
 * A boatyard: frame a skiff, or recaulk the one you haul. (A yard with a
 * carpenter's shop behind it is a doorway, and `entranceAction` comes first.)
 */
export function boatYardAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld') return null;
  const { map, i } = tileUnder(state);
  if (map.tiles[i] !== Tile.BoatYard) return null;
  const prompt = boatYardPrompt(state, map.biome[i] as Biome);
  return prompt && { prompt, run: useBoatYard };
}

function useBoatYard(state: GameState): boolean {
  const { map, i } = tileUnder(state);
  return handleBoatYard(state, map.biome[i] as Biome);
}

function tryCraftBoat(state: GameState): void {
  if (!canAffordBoat(state.carried)) {
    say(state, `The slipway wants ${BOAT_COST_WOOD} gopher wood and ${BOAT_COST_FIBER} fiber.`);
    return;
  }
  payForBoat(state.carried);
  state.hasBoat = true;
  state.inBoat = false;
  state.haulingBoat = true;
  state.boatDepth = BASE_BOAT_DEPTH;
  state.boatX = -1;
  state.boatY = -1;
  say(state, 'A skiff of gopher wood. It is yours to sail — and to carry.');
}

function tryPitchBoat(state: GameState): void {
  if (!canAffordPitching(state.carried)) {
    say(state, `The higher yard wants ${BOAT_PITCH_COST} pitch and ${BOAT_RECAULK_FIBER} fiber.`);
    return;
  }
  payForPitching(state.carried);
  state.boatDepth = PITCHED_BOAT_DEPTH;
  say(state, 'Fresh pitch in every seam. The skiff will take depth three.');
}

function tryLaunchBoat(state: GameState): boolean {
  if (!state.hasBoat || state.inBoat || state.location.kind !== 'overworld') return false;
  if (!state.haulingBoat && state.boatX >= 0) return false;
  const dest = firstAdjacentBoatable(state);
  if (!dest) return false;
  state.player.x = dest.x * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = dest.y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  syncInterpolation(state);
  state.inBoat = true;
  state.haulingBoat = false;
  state.boatX = -1;
  state.boatY = -1;
  say(state, 'The skiff takes the water.');
  return true;
}

function canSetBoatHere(state: GameState): boolean {
  if (!state.haulingBoat || state.inBoat || state.location.kind !== 'overworld') return false;
  const { map, tx, ty, i } = tileUnder(state);
  if (depthAt(state, tx, ty) > 0) return false;
  return isBoatGround(map.tiles[i]);
}

function trySetDownBoat(state: GameState): boolean {
  if (!state.haulingBoat || state.inBoat || state.location.kind !== 'overworld') return false;
  const { map, tx, ty, i } = tileUnder(state);
  if (!canSetBoatHere(state)) {
    say(state, 'Set the skiff down on clear dry ground.');
    return true;
  }
  state.boatUnderTile = map.tiles[i];
  map.tiles[i] = Tile.Skiff;
  state.boatX = tx;
  state.boatY = ty;
  state.haulingBoat = false;
  state.mapRevision++;
  say(state, 'You set the skiff down. The flood can strand it here.');
  return true;
}

function pickUpBoat(state: GameState, tx: number, ty: number, i: number): void {
  const map = activeMap(state);
  const tracked = state.boatX === tx && state.boatY === ty;
  map.tiles[i] = tracked ? state.boatUnderTile : carveTo(map.biome[i]);
  if (!tracked) state.boatDepth = BASE_BOAT_DEPTH;
  state.hasBoat = true;
  state.inBoat = false;
  state.haulingBoat = true;
  state.boatX = -1;
  state.boatY = -1;
  state.mapRevision++;
  say(state, 'You take hold of the skiff.');
}

/** A beached skiff underfoot: take hold of it. */
export function skiffPickupAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld' || state.haulingBoat || state.inBoat) return null;
  const { map, i } = tileUnder(state);
  if (map.tiles[i] !== Tile.Skiff) return null;
  return {
    prompt: { tile: Tile.Skiff, label: 'Take hold of the skiff', affordable: true },
    run: takeHold,
  };
}

function takeHold(state: GameState): boolean {
  const { tx, ty, i } = tileUnder(state);
  pickUpBoat(state, tx, ty, i);
  return true;
}

/** Hauling the skiff (or owning one never set down) beside water: launch. */
export function launchAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld' || !state.hasBoat || state.inBoat) return null;
  if (!state.haulingBoat && state.boatX >= 0) return null;
  if (!hasAdjacentBoatable(state)) return null;
  return {
    prompt: {
      tile: Tile.Water,
      label: `Launch the skiff — depth limit ${state.boatDepth}`,
      affordable: true,
    },
    run: tryLaunchBoat,
  };
}

/** Hauling the skiff: set it down, if the ground here will take it. */
export function setDownAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld' || !state.haulingBoat) return null;
  const clear = canSetBoatHere(state);
  return {
    prompt: {
      tile: Tile.Skiff,
      label: clear ? 'Set down the skiff' : 'Carry the skiff onto clear dry ground',
      affordable: clear,
    },
    run: trySetDownBoat,
  };
}

function isBoatGround(tile: number): boolean {
  return (
    tile === Tile.Grass ||
    tile === Tile.Dirt ||
    tile === Tile.Sand ||
    tile === Tile.TallGrass ||
    tile === Tile.Crop ||
    tile === Tile.Path ||
    tile === Tile.Gravel ||
    tile === Tile.StoneGround ||
    tile === Tile.Snow ||
    tile === Tile.Reed ||
    tile === Tile.Road ||
    tile === Tile.Steps
  );
}

function hasAdjacentBoatable(state: GameState): boolean {
  return firstAdjacentBoatable(state) !== null;
}

function firstAdjacentBoatable(state: GameState): Point | null {
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  for (let n = 0; n < 4; n++) {
    const x = tx + NEIGHBOUR_DX[n];
    const y = ty + NEIGHBOUR_DY[n];
    if (!isBoatableTile(state, x, y)) continue;
    boatSpot.x = x;
    boatSpot.y = y;
    return boatSpot;
  }
  return null;
}
