/**
 * The World: three parallel byte planes over one tile grid, plus the points
 * of interest that reference into it.
 *
 * Storing tiles/elevation/biome as flat Uint8Arrays keeps the whole world in
 * a handful of contiguous buffers — cheap to generate, cheap to slice into
 * panels, and directly dumpable as the 8-bit panel format.
 */

import { PANEL_H, PANEL_W, type WorldParams } from './config.js';
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

export interface World {
  seed: number;
  params: WorldParams;
  /** Tile-grid dimensions. */
  w: number;
  h: number;
  tiles: Uint8Array;
  elev: Uint8Array;
  biome: Uint8Array;
  spawn: Point;
  ark: Point;
  pois: Poi[];
  stats: WorldStats;
}

export function idx(world: { w: number }, x: number, y: number): number {
  return y * world.w + x;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h;
}

export function tileAt(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return Tile.Cliff;
  return world.tiles[y * world.w + x];
}

export function elevAt(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return 255;
  return world.elev[y * world.w + x];
}

export function biomeAt(world: World, x: number, y: number): Biome {
  if (!inBounds(world, x, y)) return Biome.Mountain;
  return world.biome[y * world.w + x] as Biome;
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

/** Extract panel (px, py) as its own byte planes. */
export function getPanel(world: World, px: number, py: number): Panel {
  const tiles = new Uint8Array(PANEL_W * PANEL_H);
  const elev = new Uint8Array(PANEL_W * PANEL_H);
  const counts = [0, 0, 0, 0];

  for (let ty = 0; ty < PANEL_H; ty++) {
    const wy = py * PANEL_H + ty;
    for (let tx = 0; tx < PANEL_W; tx++) {
      const wx = px * PANEL_W + tx;
      const src = wy * world.w + wx;
      const dst = ty * PANEL_W + tx;
      tiles[dst] = world.tiles[src];
      elev[dst] = world.elev[src];
      counts[world.biome[src]]++;
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
