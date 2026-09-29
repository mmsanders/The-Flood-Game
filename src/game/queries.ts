/**
 * Read-only questions about the current state: which map is active, how deep
 * the water is here, what tile the player faces. Leaf-level helpers shared by
 * every system; the only mutation here is `say`, which posts a HUD message.
 */

import { BASE_BOAT_DEPTH } from '../core/boat.js';
import { TILE_PX } from '../core/config.js';
import type { Dungeon } from '../core/dungeon.js';
import { gorgeDepthAt, waterDepth, waterLevelAtSeconds } from '../core/flood.js';
import type { Interior } from '../core/interior.js';
import type { TileMap } from '../core/tilemap.js';
import { isWalkable } from '../core/tiles.js';
import { Dir, type GameState, PLAYER_H, PLAYER_W } from './types.js';

const MESSAGE_TIME = 3.2;

/** Depth 2 floats over drowned blocking scenery. */
const FLOAT_OVER_DEPTH = 2;

export const RESOURCE_LABEL = ['fiber', 'gopher wood', 'stone', 'pitch'];

/** The map the player is standing on. */
export function activeMap(state: GameState): TileMap {
  if (state.location.kind === 'dungeon') {
    return state.world.dungeons[state.location.dungeonId];
  }
  if (state.location.kind === 'interior') {
    return state.world.interiors[state.location.interiorId];
  }
  return state.world;
}

export function currentDungeon(state: GameState): Dungeon | null {
  return state.location.kind === 'dungeon'
    ? state.world.dungeons[state.location.dungeonId]
    : null;
}

export function currentInterior(state: GameState): Interior | null {
  return state.location.kind === 'interior'
    ? state.world.interiors[state.location.interiorId]
    : null;
}

export function waterLevel(state: GameState): number {
  return waterLevelAtSeconds(state.elapsed, state.world.params.secondsPerDay);
}

export function currentDay(state: GameState): number {
  return state.elapsed / state.world.params.secondsPerDay;
}

/** Standing water on a tile of the active map. */
export function depthAt(state: GameState, tx: number, ty: number): number {
  const map = activeMap(state);
  if (!map.floods) return 0;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
  const i = ty * map.w + tx;
  return waterDepth(map.tiles[i], map.elev[i], waterLevel(state), gorgeRunoff(state, ty));
}

/** How deep the gorge runs at a given row right now. */
export function gorgeRunoff(state: GameState, ty: number): number {
  return gorgeDepthAt(currentDay(state), ty, activeMap(state).h);
}

/**
 * Can the skiff float here? Ordinary hulls stop at depth 2, pitched hulls at
 * depth 3, and depth 4+ belongs to the ark alone.
 */
export function isBoatableTile(state: GameState, tx: number, ty: number): boolean {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const depth = depthAt(state, tx, ty);
  const maxDepth = state.boatDepth ?? BASE_BOAT_DEPTH;
  if (depth <= 0 || depth >= 4 || depth > maxDepth) return false;
  return isWalkable(map.tiles[tx + ty * map.w]) || depth >= FLOAT_OVER_DEPTH;
}

export function dirX(dir: Dir): number {
  return dir === Dir.Left ? -1 : dir === Dir.Right ? 1 : 0;
}

export function dirY(dir: Dir): number {
  return dir === Dir.Up ? -1 : dir === Dir.Down ? 1 : 0;
}

/** Tile the player is standing on. */
export function tileUnder(state: GameState): { map: TileMap; tx: number; ty: number; i: number } {
  const map = activeMap(state);
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  return { map, tx, ty, i: ty * map.w + tx };
}

/** Tile the player is facing, within the Rod's near reach. */
export function facingTile(state: GameState): { map: TileMap; tx: number; ty: number } {
  const map = activeMap(state);
  const p = state.player;
  const tx = Math.floor((p.x + PLAYER_W / 2 + dirX(p.dir) * TILE_PX) / TILE_PX);
  const ty = Math.floor((p.y + PLAYER_H / 2 + dirY(p.dir) * TILE_PX) / TILE_PX);
  return { map, tx, ty };
}

/** Keys held for the cave the player is in; none anywhere else. */
export function keysHere(state: GameState): number {
  const cave = currentDungeon(state);
  return cave ? (state.keysByDungeon[cave.id] ?? 0) : 0;
}

export function say(state: GameState, text: string): void {
  state.message = text;
  state.messageTimer = MESSAGE_TIME;
}
