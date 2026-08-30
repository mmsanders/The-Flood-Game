/**
 * The shape every renderer, collision check and camera actually depends on.
 *
 * Both the overworld and a dungeon interior are grids of tiles with elevation,
 * so both satisfy this. Pulling the interface out is what lets the game swap
 * between them by changing one pointer instead of branching on "am I
 * underground" in every movement and drawing function.
 */

import { PANEL_H, PANEL_W } from './config.js';
import { Biome } from './tiles.js';

export interface TileMap {
  /** Dimensions in tiles. Always a whole number of panels. */
  w: number;
  h: number;
  tiles: Uint8Array;
  elev: Uint8Array;
  biome: Uint8Array;
  /**
   * Does the flood reach here?
   *
   * False underground. Dungeon interiors also carry maximum elevation, so even
   * if this were ignored the water would never arrive — but the flag states the
   * intent rather than leaving it to a magic number.
   */
  floods: boolean;
}

export function panelsWide(map: TileMap): number {
  return Math.ceil(map.w / PANEL_W);
}

export function panelsHigh(map: TileMap): number {
  return Math.ceil(map.h / PANEL_H);
}

export function inMap(map: TileMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function tileAtXY(map: TileMap, x: number, y: number): number {
  return inMap(map, x, y) ? map.tiles[y * map.w + x] : 0;
}

/** Allocate the byte planes for a map of the given size. */
export function blankPlanes(
  w: number,
  h: number,
  fill: { tile: number; elev: number; biome: Biome },
): Pick<TileMap, 'tiles' | 'elev' | 'biome'> {
  const n = w * h;
  return {
    tiles: new Uint8Array(n).fill(fill.tile),
    elev: new Uint8Array(n).fill(fill.elev),
    biome: new Uint8Array(n).fill(fill.biome),
  };
}
