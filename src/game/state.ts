/**
 * Game state and the rules that move it forward.
 *
 * Deliberately DOM-free and deterministic given (world, inputs, dt), so the
 * whole simulation can be stepped headlessly in tests without a canvas.
 */

import { PANEL_H, PANEL_PX_H, PANEL_PX_W, PANEL_W, TILE_PX } from '../core/config.js';
import {
  type Dungeon,
  OBSTACLE_CLEARS_TO,
  OBSTACLE_COST,
  REWARD_NAMES,
  RewardKind,
} from '../core/dungeon.js';
import {
  INTERIOR_NAMES,
  InteriorKind,
  isInteriorEntrance,
  type Interior,
} from '../core/interior.js';
import { gorgeDepthAt, waterDepth, waterLevelAtSeconds } from '../core/flood.js';
import {
  AXE_DURABILITY,
  ITEM_COST,
  ITEM_NAMES,
  ItemKind,
  PICKAXE_DURABILITY,
  SHOP_STOCK,
  marketAmount,
} from '../core/items.js';
import { ARK_RECIPE, NODE_YIELD, PLAYER_TILES_PER_SEC, SHRINE_COST, canRodHarvest } from '../core/resources.js';
import { panelsHigh, panelsWide, type TileMap } from '../core/tilemap.js';
import {
  Biome,
  RESOURCE_COUNT,
  RESOURCE_NAMES,
  Resource,
  Tile,
  carveTo,
  isWalkable,
  resourceOf,
} from '../core/tiles.js';
import { PoiKind, type Point, type World } from '../core/world.js';
import {
  ANIMAL_DEFS,
  AnimalKind,
  AnimalStatus,
  animalDef,
  animalOverlaps,
  flockScoreOf,
  stepAnimals,
  type FlockScore,
} from '../core/animals.js';
import {
  BASE_BOAT_DEPTH,
  BOAT_COST_FIBER,
  BOAT_COST_WOOD,
  BOAT_PITCH_COST,
  BOAT_PORTAGE_SPEED_SCALE,
  BOAT_RECAULK_FIBER,
  BOAT_SPEED_SCALE,
  PITCHED_BOAT_DEPTH,
  boatDestroyedAtDepth,
  canAffordBoat,
  canAffordPitching,
  payForBoat,
  payForPitching,
} from '../core/boat.js';

/** Rod tier that parts a seal of pitch. */
const SEAL_TIER = Resource.Pitch;

export const enum Dir {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

export type Phase = 'playing' | 'won' | 'drowned';

/** Player hitbox, in pixels. Narrower than a tile so doorways feel generous. */
export const PLAYER_W = 10;
export const PLAYER_H = 11;

const SPEED_PX = PLAYER_TILES_PER_SEC * TILE_PX;
const SWING_TIME = 0.22;
const SWING_COOLDOWN = 0.3;
const INVULN_TIME = 1.2;
const DROWN_INTERVAL = 2.0;
const WADE_SPEED_SCALE = 0.55;
const SCROLL_TIME = 0.4;
const MESSAGE_TIME = 3.2;
/** Tiles converted in one clear. Generous enough for any doorway band. */
const CLEAR_LIMIT = 32;

export interface Player {
  /** Top-left of the hitbox, in world pixels. */
  x: number;
  y: number;
  /** Position at the start of the current simulation step. */
  prevX: number;
  prevY: number;
  dir: Dir;
  hearts: number;
  maxHearts: number;
  /** Seconds remaining on the current swing, 0 when idle. */
  swing: number;
  cooldown: number;
  invuln: number;
  /** Seconds submerged since the last point of drowning damage. */
  drownTimer: number;
  moving: boolean;
  animTime: number;
}

export interface Camera {
  panelX: number;
  panelY: number;
  /** Scroll progress 0..1 while transitioning between panels. */
  scroll: number;
  /** Scroll at the start of the current step, for render interpolation. */
  prevScroll: number;
  fromX: number;
  fromY: number;
}

/** Where the player currently is. Dungeons and interiors are separate maps. */
export interface Location {
  kind: 'overworld' | 'dungeon' | 'interior';
  /** Index into `world.dungeons`, or -1 above ground / in an interior. */
  dungeonId: number;
  /** Index into `world.interiors`, or -1 above ground / in a dungeon. */
  interiorId: number;
  /** Overworld tile to put the player back on when they leave a room. */
  returnTo: Point | null;
}

export interface GameState {
  world: World;
  location: Location;
  player: Player;
  /** Carried resources, indexed by Resource. */
  carried: number[];
  /** Resources delivered to the ark site. */
  delivered: number[];
  elapsed: number;
  phase: Phase;
  camera: Camera;
  message: string | null;
  messageTimer: number;
  harvested: number;
  heartsFound: number;
  /** Keys are per-dungeon: they do not travel between them. */
  keysHeld: number;
  /** Last non-hazard tile stood on, for spitting the player out of a pit. */
  safeSpot: Point | null;
  /** Units gathered per swing. The Budding Rod doubles it. */
  harvestYield: number;
  /** Swing reach in tiles, and how many floods deep the Rod can dredge. */
  rodReach: number;
  /** 0 = fiber only; 1 = wood; 2 = stone; 3 = pitch; 4 = crowned. */
  rodTier: number;
  dungeonsCleared: boolean[];

  /** Wave-two traversal gear. */
  hasGaloshes: boolean;
  hasAxe: boolean;
  axeDurability: number;
  hasPickaxe: boolean;
  pickaxeDurability: number;
  hasSoundingLine: boolean;
  hasChart: boolean;
  hasLodestone: boolean;
  hasDove: boolean;
  /** One market heart may be bought per settlement biome. */
  shopHeartMask: number;
  hermitHeartClaimed: boolean;

  /** At least one skiff has been built this run. */
  hasBoat: boolean;
  /** Currently sailing. Blocks drowning and lets you occupy floodwater. */
  inBoat: boolean;
  /** A beached skiff is being lugged overland. */
  haulingBoat: boolean;
  /** Deepest water the currently tracked hull may enter: 2 ordinary, 3 pitched. */
  boatDepth: number;
  /** Tile coordinate of the set-down skiff, or -1 while carried/sailed. */
  boatX: number;
  boatY: number;
  /** Tile restored when the tracked skiff is picked back up. */
  boatUnderTile: number;

  /** Explored overworld panels, row-major 0/1. */
  exploredOverworld: Uint8Array;
  /** Same packing, one grid per dungeon. */
  exploredDungeons: Uint8Array[];
  /** One cell per interior (single-panel rooms). */
  exploredInteriors: Uint8Array[];
  minimapViewY: number;
  minimapFilledSouth: boolean;
  /** Bumped whenever terrain changes under play. */
  mapRevision: number;
}

export function createGame(world: World): GameState {
  retireLooseHearts(world);
  const state: GameState = {
    world,
    location: { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null },
    player: {
      x: world.spawn.x * TILE_PX + (TILE_PX - PLAYER_W) / 2,
      y: world.spawn.y * TILE_PX + (TILE_PX - PLAYER_H) / 2,
      prevX: world.spawn.x * TILE_PX + (TILE_PX - PLAYER_W) / 2,
      prevY: world.spawn.y * TILE_PX + (TILE_PX - PLAYER_H) / 2,
      dir: Dir.Down,
      hearts: 3,
      maxHearts: 3,
      swing: 0,
      cooldown: 0,
      invuln: 0,
      drownTimer: 0,
      moving: false,
      animTime: 0,
    },
    carried: new Array<number>(RESOURCE_COUNT).fill(0),
    delivered: new Array<number>(RESOURCE_COUNT).fill(0),
    elapsed: 0,
    phase: 'playing',
    camera: {
      panelX: Math.floor(world.spawn.x / PANEL_W),
      panelY: Math.floor(world.spawn.y / PANEL_H),
      scroll: 0,
      prevScroll: 0,
      fromX: Math.floor(world.spawn.x / PANEL_W),
      fromY: Math.floor(world.spawn.y / PANEL_H),
    },
    message: null,
    messageTimer: 0,
    harvested: 0,
    heartsFound: 0,
    keysHeld: 0,
    safeSpot: null,
    harvestYield: NODE_YIELD,
    rodReach: 1,
    rodTier: 0,
    dungeonsCleared: world.dungeons.map(() => false),
    hasGaloshes: false,
    hasAxe: false,
    axeDurability: 0,
    hasPickaxe: false,
    pickaxeDurability: 0,
    hasSoundingLine: false,
    hasChart: false,
    hasLodestone: false,
    hasDove: false,
    shopHeartMask: 0,
    hermitHeartClaimed: false,
    hasBoat: false,
    inBoat: false,
    haulingBoat: false,
    boatDepth: BASE_BOAT_DEPTH,
    boatX: -1,
    boatY: -1,
    boatUnderTile: Tile.Grass,
    exploredOverworld: new Uint8Array(world.params.panelsX * world.params.panelsY),
    exploredDungeons: world.dungeons.map((d) => new Uint8Array(d.roomsX * d.roomsY)),
    exploredInteriors: (world.interiors ?? []).map(() => new Uint8Array(1)),
    minimapViewY: 0,
    minimapFilledSouth: false,
    mapRevision: 0,
  };
  markExplored(state);
  return state;
}

/** Wave two removes free overworld hearts; dungeons, barter and the hermit earn them. */
function retireLooseHearts(world: World): void {
  let changed = false;
  for (const poi of world.pois) {
    if (poi.kind !== PoiKind.Heart) continue;
    const i = poi.y * world.w + poi.x;
    if (world.tiles[i] === Tile.HeartContainer) {
      world.tiles[i] = carveTo(world.biome[i]);
      changed = true;
    }
  }
  if (changed) world.pois = world.pois.filter((poi) => poi.kind !== PoiKind.Heart);
}

/** Record the panel the camera is on as visited. Cheap and idempotent. */
export function markExplored(state: GameState): void {
  const map = activeMap(state);
  const w = panelsWide(map);
  const h = panelsHigh(map);
  const x = state.camera.panelX;
  const y = state.camera.panelY;
  if (x < 0 || y < 0 || x >= w || y >= h) return;

  const i = y * w + x;
  if (state.location.kind === 'dungeon') {
    const grid = state.exploredDungeons[state.location.dungeonId];
    if (grid && i < grid.length) grid[i] = 1;
    return;
  }
  if (state.location.kind === 'interior') {
    const grid = state.exploredInteriors[state.location.interiorId];
    if (grid && i < grid.length) grid[i] = 1;
    return;
  }
  if (i < state.exploredOverworld.length) state.exploredOverworld[i] = 1;
}

/** Rebind a live run onto a freshly loaded rules module. */
export function adoptHotState(running: GameState): GameState {
  const next = createGame(running.world);
  const merged: GameState = {
    ...next,
    ...running,
    world: running.world,
    player: { ...next.player, ...running.player },
    camera: { ...next.camera, ...running.camera },
    location: { ...next.location, ...running.location },
    carried: padCounts(running.carried, RESOURCE_COUNT),
    delivered: padCounts(running.delivered, RESOURCE_COUNT),
    dungeonsCleared: padFlags(running.dungeonsCleared, running.world.dungeons.length),
    exploredOverworld: adoptGrid(running.exploredOverworld, next.exploredOverworld),
    exploredDungeons: adoptDungeonGrids(running.exploredDungeons, next.exploredDungeons),
    exploredInteriors: adoptDungeonGrids(running.exploredInteriors ?? [], next.exploredInteriors),
  };
  markExplored(merged);
  for (const a of merged.world.animals) {
    if (typeof a.prevX !== 'number') a.prevX = a.x;
    if (typeof a.prevY !== 'number') a.prevY = a.y;
  }
  syncInterpolation(merged);
  return merged;
}

function adoptGrid(running: Uint8Array | undefined, fallback: Uint8Array): Uint8Array {
  return running && running.length === fallback.length ? running : fallback;
}

function adoptDungeonGrids(
  running: Uint8Array[] | undefined,
  fallback: Uint8Array[],
): Uint8Array[] {
  if (!running || running.length !== fallback.length) return fallback;
  return fallback.map((grid, i) => adoptGrid(running[i], grid));
}

function padCounts(values: number[] | undefined, len: number): number[] {
  const out = new Array<number>(len).fill(0);
  if (!values) return out;
  for (let i = 0; i < Math.min(len, values.length); i++) out[i] = values[i];
  return out;
}

function padFlags(values: boolean[] | undefined, len: number): boolean[] {
  const out = new Array<boolean>(len).fill(false);
  if (!values) return out;
  for (let i = 0; i < Math.min(len, values.length); i++) out[i] = values[i];
  return out;
}

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

// WAVE3_CHUNK_PLACEHOLDER incomplete upload
