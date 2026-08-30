/**
 * The World: three parallel byte planes over one tile grid, plus the points
 * of interest that reference into it.
 *
 * Storing tiles/elevation/biome as flat Uint8Arrays keeps the whole world in
 * a handful of contiguous buffers — cheap to generate, cheap to slice into
 * panels, and directly dumpable as the 8-bit panel format.
 */

import { PANEL_H, PANEL_W, type WorldParams } from './config.js';
import type { Dungeon } from './dungeon.js';
import type { TileMap } from './tilemap.js';
import { Biome, Tile } from './tiles.js';

export interface Point {
  x: number;
  y: number;
}

export const enum PoiKind {
  Ark = 0,
  Dungeon = 1,
  Heart = 2,
  Town = 3,
}

export interface Poi extends Point {
  kind: PoiKind;
  biome: Biome;
}

export interface WorldStats {
  /** Tiles per biome, indexed by Biome. */
  biomeTiles: number[];
  /** Resource nodes per resource kind, indexed by Resource. */
  resourceNodes: number[];
  /** Resource nodes reachable on foot from spawn before they submerge. */
  reachableResources: number[];
  walkableTiles: number;
  totalTiles: number;
  /** Did every walkable region join up into one? */
  connected: boolean;
  /** Is the ark recipe satisfiable before the world drowns? */
  solvable: boolean;
  /** Human-readable reasons the world failed validation, if any. */
  problems: string[];
}

export interface World extends TileMap {
  seed: number;
  params: WorldParams;
  spawn: Point;
  ark: Point;
  pois: Poi[];
  /** One per biome. Entrances are linked by index from the matching Poi. */
  dungeons: Dungeon[];
  stats: WorldStats;
}

export function idx(world: { w: number }, x: number, y: number): number {
  return y * world.w + x;
}

export function inBounds(map: TileMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function tileAt(map: TileMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return Tile.Cliff;
  return map.tiles[y * map.w + x];
}

export function elevAt(map: TileMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return 255;
  return map.elev[y * map.w + x];
}

export function biomeAt(map: TileMap, x: number, y: number): Biome {
  if (!inBounds(map, x, y)) return Biome.Mountain;
  return map.biome[y * map.w + x] as Biome;
}

/**
 * One panel's worth of bytes — the unit the dev tool inspects and the format
 * the design is built around. 176 tile bytes + 176 elevation bytes.
 */
export interface Panel {
  px: number;
  py: number;
  tiles: Uint8Array;
  elev: Uint8Array;
  /** The biome covering the most tiles in this panel. */
  biome: Biome;
}

export function panelCountX(world: World): number {
  return world.params.panelsX;
}

export function panelCountY(world: World): number {
  return world.params.panelsY;
}

/**
 * Extract panel (px, py) as its own byte planes.
 *
 * Takes any TileMap, so the inspector renders dungeon rooms through exactly
 * the same path as overworld panels.
 */
export function getPanel(map: TileMap, px: number, py: number): Panel {
  const tiles = new Uint8Array(PANEL_W * PANEL_H);
  const elev = new Uint8Array(PANEL_W * PANEL_H);
  const counts = [0, 0, 0, 0];

  for (let ty = 0; ty < PANEL_H; ty++) {
    const wy = py * PANEL_H + ty;
    for (let tx = 0; tx < PANEL_W; tx++) {
      const wx = px * PANEL_W + tx;
      const src = wy * map.w + wx;
      const dst = ty * PANEL_W + tx;
      tiles[dst] = map.tiles[src];
      elev[dst] = map.elev[src];
      counts[map.biome[src]]++;
    }
  }

  let biome = 0;
  for (let b = 1; b < counts.length; b++) {
    if (counts[b] > counts[biome]) biome = b;
  }

  return { px, py, tiles, elev, biome: biome as Biome };
}

/** Which panel contains a tile coordinate. */
export function panelOf(x: number, y: number): Point {
  return { x: Math.floor(x / PANEL_W), y: Math.floor(y / PANEL_H) };
}
