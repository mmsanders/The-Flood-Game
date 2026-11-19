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
import type { Desert } from './desert.js';
import type { Interior } from './interior.js';
import type { TileMap } from './tilemap.js';
import { Biome, Tile } from './tiles.js';
import type { Animal } from './animals.js';

export interface Point {
  x: number;
  y: number;
}

export const enum PoiKind {
  Ark = 0,
  Dungeon = 1,
  Heart = 2,
  Town = 3,
  BoatYard = 4,
  Shrine = 5,
}

export interface Poi extends Point {
  kind: PoiKind;
  biome: Biome;
}

export const enum SettlementKind {
  TentCity = 0,
  LoggingTown = 1,
  City = 2,
  Hamlet = 3,
}

export interface Settlement extends Point {
  kind: SettlementKind;
  biome: Biome;
  shrine: Point | null;
}

/** What became of a farmstead before the rain. Wave 7. */
export const enum HomesteadState {
  /** The farmer is in the yard, and the animal in the paddock is his. */
  LivedIn = 0,
  /** A ruin. The fence still stands and the animal still waits inside. */
  Abandoned = 1,
  /** Gaps in the fence. The animal stays within a tile of home anyway. */
  FallenFence = 2,
}

/** Inclusive tile rectangle. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A farmstead: house, well, yard, and a fenced paddock. Point is the house. */
export interface Homestead extends Point {
  id: number;
  name: string;
  biome: Biome;
  state: HomesteadState;
  /** Inside the fence. */
  paddock: TileRect;
  /** The doorstep, where the farmer stands. */
  yard: Point;
}

/** Somewhere people live: a town, a hamlet, a farm. What townsfolk call home. */
export interface Place extends Point {
  name: string;
  /** -1 for a town or hamlet, else the homestead's id. */
  homestead: number;
  /** Walkable tiles people stand on here. */
  spots: number[];
  /** The day the water reaches the middle of it. */
  drownsOn: number;
}

export const enum PersonRole {
  Townsfolk = 0,
  Farmer = 1,
}

export const enum PersonStatus {
  /** Where they belong, or where they fled to. */
  Here = 0,
  /** Walking off this screen to get away from the water. */
  Leaving = 1,
  /** Nowhere left to go. */
  Gone = 2,
}

/**
 * Someone who lives here. Not rescuable — Genesis 7:23 — and not an obstacle:
 * Noah walks through a crowd rather than getting stuck on it.
 */
export interface Person {
  id: number;
  role: PersonRole;
  /** Index into the clothing palettes. */
  look: number;
  /** Index into `world.places`: where they are now. */
  place: number;
  /** Where they started, so a refugee can say where they came from. */
  origin: number;
  /** The tile they wander around. */
  anchor: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  dir: number;
  status: PersonStatus;
  cooldown: number;
  steps: number;
  anim: number;
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
  /** Contour ledges, and how many stairs the connectivity repair had to cut. */
  contours: { lines: number; stairs: number; stairsCut: number };
  /** Is the ark recipe satisfiable before the world drowns? */
  solvable: boolean;
  /** Per-shrine: the day it drowns, and the day it could first be reached. */
  ladder: { biome: Biome; drownsOn: number; reachableOn: number }[];
  /** Human-readable reasons the world failed validation, if any. */
  problems: string[];
}

export interface World extends TileMap {
  seed: number;
  params: WorldParams;
  spawn: Point;
  ark: Point;
  boatYard: Point;
  pois: Poi[];
  /** Towns, the logging camp, the city, mountain hamlets. */
  settlements: Settlement[];
  /** Walkable pasture tiles. Valley livestock prefer these. */
  pastures: number[];
  /** Two of each biblical kind, wandering their home biomes. */
  animals: Animal[];
  /** One per biome. Entrances are linked by index from the matching Poi. */
  dungeons: Dungeon[];
  /** Shops, hermitage, carpenter, Noah's tent — one-room maps. */
  interiors: Interior[];
  /** The endless sand off the far south edge, or null if no edge would take it. */
  desert: Desert | null;
  /** Farmsteads, in every biome. Wave 7. */
  homesteads: Homestead[];
  /** Towns, hamlets and farms, as places people live and flee between. */
  places: Place[];
  /** The people. They watch the water too. */
  people: Person[];
  /** Town, farm and camp centres: what wild animals keep away from. */
  settled: Point[];
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
