/**
 * Game state and the rules that move it forward.
 * DOM-free and deterministic given (world, inputs, dt).
 *
 * NOTE: Restored from main after a bad MCP push replaced this file with a
 * path stub. Full Wave 2 skiff/shop/axe/depth-ladder body is implemented
 * locally under /workspace/flood-wave2/repo and still needs to be pushed.
 */

import { PANEL_H, PANEL_PX_H, PANEL_PX_W, PANEL_W, TILE_PX } from '../core/config.js';
import {
  type Dungeon,
  OBSTACLE_CLEARS_TO,
  OBSTACLE_COST,
  REWARD_NAMES,
  RewardKind,
} from '../core/dungeon.js';

const SEAL_TIER = Resource.Pitch;
import { gorgeDepthAt, waterDepth, waterLevelAtSeconds } from '../core/flood.js';
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
import type { Point, World } from '../core/world.js';
import {
  ANIMAL_DEFS,
  AnimalStatus,
  animalDef,
  animalOverlaps,
  flockScoreOf,
  stepAnimals,
  type FlockScore,
} from '../core/animals.js';
import {
  BOAT_COST_FIBER,
  BOAT_COST_WOOD,
  BOAT_SPEED_SCALE,
  canAffordBoat,
  payForBoat,
} from '../core/boat.js';

export const enum Dir {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

export type Phase = 'playing' | 'won' | 'drowned';

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
const CLEAR_LIMIT = 32;
const FLOAT_OVER_DEPTH = 2;

export interface Player {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  dir: Dir;
  hearts: number;
  maxHearts: number;
  swing: number;
  cooldown: number;
  invuln: number;
  drownTimer: number;
  moving: boolean;
  animTime: number;
}

export interface Camera {
  panelX: number;
  panelY: number;
  scroll: number;
  prevScroll: number;
  fromX: number;
  fromY: number;
}

export interface Location {
  kind: 'overworld' | 'dungeon';
  dungeonId: number;
  returnTo: Point | null;
}

export interface GameState {
  world: World;
  location: Location;
  player: Player;
  carried: number[];
  delivered: number[];
  elapsed: number;
  phase: Phase;
  camera: Camera;
  message: string | null;
  messageTimer: number;
  harvested: number;
  heartsFound: number;
  keysHeld: number;
  safeSpot: Point | null;
  harvestYield: number;
  rodReach: number;
  rodTier: number;
  dungeonsCleared: boolean[];
  hasBoat: boolean;
  inBoat: boolean;
  exploredOverworld: Uint8Array;
  exploredDungeons: Uint8Array[];
  minimapViewY: number;
  minimapFilledSouth: boolean;
  mapRevision: number;
}

export function createGame(world: World): GameState {
  const state: GameState = {
    world,
    location: { kind: 'overworld', dungeonId: -1, returnTo: null },
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
    hasBoat: false,
    inBoat: false,
    exploredOverworld: new Uint8Array(world.params.panelsX * world.params.panelsY),
    exploredDungeons: world.dungeons.map((d) => new Uint8Array(d.roomsX * d.roomsY)),
    minimapViewY: 0,
    minimapFilledSouth: false,
    mapRevision: 0,
  };
  markExplored(state);
  return state;
}

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
  if (i < state.exploredOverworld.length) state.exploredOverworld[i] = 1;
}

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

export function activeMap(state: GameState): TileMap {
  return state.location.kind === 'dungeon'
    ? state.world.dungeons[state.location.dungeonId]
    : state.world;
}

export function currentDungeon(state: GameState): Dungeon | null {
  return state.location.kind === 'dungeon'
    ? state.world.dungeons[state.location.dungeonId]
    : null;
}

export function waterLevel(state: GameState): number {
  return waterLevelAtSeconds(state.elapsed, state.world.params.secondsPerDay);
}

export function currentDay(state: GameState): number {
  return state.elapsed / state.world.params.secondsPerDay;
}

export interface StepInput {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
  interactPressed?: boolean;
}

export function step(state: GameState, input: StepInput, dt: number): void {
  if (state.phase !== 'playing') return;
  state.player.prevX = state.player.x;
  state.player.prevY = state.player.y;
  state.camera.prevScroll = state.camera.scroll;
  state.elapsed += dt;
  const p = state.player;
  p.swing = Math.max(0, p.swing - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (state.messageTimer > 0) {
    state.messageTimer -= dt;
    if (state.messageTimer <= 0) state.message = null;
  }
  if (state.camera.scroll > 0) {
    state.camera.scroll = Math.max(0, state.camera.scroll - dt / SCROLL_TIME);
    tickFlock(state, dt);
    applyFlood(state, dt);
    return;
  }
  movePlayer(state, input, dt);
  maybeDungeonWarp(state);
  if (input.attackPressed && p.cooldown <= 0) {
    p.swing = SWING_TIME;
    p.cooldown = SWING_TIME + SWING_COOLDOWN;
    swingRod(state);
  }
  if (input.interactPressed) handleInteract(state);
  rememberSafeSpot(state);
  tickFlock(state, dt);
  stepTileEffects(state);
  applyFlood(state, dt);
  updateCamera(state);
  checkEndConditions(state);
}

function movePlayer(state: GameState, input: StepInput, dt: number): void {
  const p = state.player;
  let dx = input.moveX;
  let dy = input.moveY;
  if (dx !== 0 && dy !== 0) {
    const inv = Math.SQRT1_2;
    dx *= inv;
    dy *= inv;
  }
  p.moving = dx !== 0 || dy !== 0;
  if (p.moving) {
    p.animTime += dt;
    if (Math.abs(input.moveX) >= Math.abs(input.moveY)) {
      if (input.moveX > 0) p.dir = Dir.Right;
      else if (input.moveX < 0) p.dir = Dir.Left;
    } else if (input.moveY > 0) p.dir = Dir.Down;
    else if (input.moveY < 0) p.dir = Dir.Up;
  }
  const wading = !state.inBoat && hitboxInWater(state, p.x, p.y);
  const speed =
    SPEED_PX * (state.inBoat ? BOAT_SPEED_SCALE : wading ? WADE_SPEED_SCALE : 1) * dt;
  moveAxis(state, dx * speed, 0);
  moveAxis(state, 0, dy * speed);
}

function moveAxis(state: GameState, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (canOccupy(state, nx, ny)) {
    p.x = nx;
    p.y = ny;
    maybeBeach(state);
    return;
  }
  if (tryShoveOff(state, nx, ny)) return;
  const steps = 4;
  for (let i = steps - 1; i > 0; i--) {
    const tx = p.x + (dx * i) / steps;
    const ty = p.y + (dy * i) / steps;
    if (canOccupy(state, tx, ty)) {
      p.x = tx;
      p.y = ty;
      return;
    }
  }
}

function canOccupy(state: GameState, x: number, y: number): boolean {
  const alreadyWading = hitboxInWater(state, state.player.x, state.player.y);
  const sailing = state.inBoat && state.location.kind === 'overworld';
  return (
    cornerClear(state, x, y, sailing, alreadyWading) &&
    cornerClear(state, x + PLAYER_W - 1, y, sailing, alreadyWading) &&
    cornerClear(state, x, y + PLAYER_H - 1, sailing, alreadyWading) &&
    cornerClear(state, x + PLAYER_W - 1, y + PLAYER_H - 1, sailing, alreadyWading)
  );
}

function cornerClear(
  state: GameState,
  cx: number,
  cy: number,
  sailing: boolean,
  alreadyWading: boolean,
): boolean {
  const map = activeMap(state);
  const tx = Math.floor(cx / TILE_PX);
  const ty = Math.floor(cy / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  const tile = map.tiles[i];
  const flooded = depthAt(state, tx, ty) > 0;
  const alreadyOn = hitboxOverlapsTile(state.player.x, state.player.y, tx, ty);
  if (sailing && isBoatableTile(state, tx, ty)) return true;
  if (tile === Tile.DungeonEntrance) {
    if (flooded && !sailing) return alreadyOn;
    return canStepOnEntrance(state, tx, ty) || alreadyOn;
  }
  if (!isWalkable(tile)) return alreadyOn;
  if (flooded && !sailing && !alreadyWading) return false;
  return true;
}

function hitboxOverlapsTile(px: number, py: number, tx: number, ty: number): boolean {
  const x1 = px + PLAYER_W - 1;
  const y1 = py + PLAYER_H - 1;
  const tx0 = tx * TILE_PX;
  const ty0 = ty * TILE_PX;
  const tx1 = tx0 + TILE_PX - 1;
  const ty1 = ty0 + TILE_PX - 1;
  return x1 >= tx0 && px <= tx1 && y1 >= ty0 && py <= ty1;
}

export function depthAt(state: GameState, tx: number, ty: number): number {
  const map = activeMap(state);
  if (!map.floods) return 0;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
  const i = ty * map.w + tx;
  return waterDepth(map.tiles[i], map.elev[i], waterLevel(state), gorgeRunoff(state, ty));
}

export function gorgeRunoff(state: GameState, ty: number): number {
  return gorgeDepthAt(currentDay(state), ty, activeMap(state).h);
}

export function isBoatableTile(state: GameState, tx: number, ty: number): boolean {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const depth = depthAt(state, tx, ty);
  if (depth <= 0) return false;
  return isWalkable(map.tiles[tx + ty * map.w]) || depth >= FLOAT_OVER_DEPTH;
}

function tryShoveOff(state: GameState, x: number, y: number): boolean {
  if (!state.hasBoat || state.inBoat || state.location.kind !== 'overworld') return false;
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
    say(state, 'You shove off.');
    return true;
  }
  return false;
}

function maybeBeach(state: GameState): void {
  if (!state.inBoat) return;
  const map = activeMap(state);
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  const i = ty * map.w + tx;
  if (depthAt(state, tx, ty) > 0) return;
  if (!isWalkable(map.tiles[i])) return;
  state.inBoat = false;
  say(state, 'You beach the skiff.');
}

function hitboxInWater(state: GameState, x: number, y: number): boolean {
  return (
    isSubmergedAt(state, x + PLAYER_W / 2, y + PLAYER_H / 2) ||
    isSubmergedAt(state, x, y) ||
    isSubmergedAt(state, x + PLAYER_W - 1, y) ||
    isSubmergedAt(state, x, y + PLAYER_H - 1) ||
    isSubmergedAt(state, x + PLAYER_W - 1, y + PLAYER_H - 1)
  );
}

function isSubmergedAt(state: GameState, pxX: number, pxY: number): boolean {
  return depthAt(state, Math.floor(pxX / TILE_PX), Math.floor(pxY / TILE_PX)) > 0;
}

function swingRod(state: GameState): void {
  const p = state.player;
  const cx = p.x + PLAYER_W / 2;
  const cy = p.y + PLAYER_H / 2;
  for (let d = 1; d <= state.rodReach; d++) {
    const tx = Math.floor((cx + dirX(p.dir) * TILE_PX * d) / TILE_PX);
    const ty = Math.floor((cy + dirY(p.dir) * TILE_PX * d) / TILE_PX);
    if (harvestAt(state, tx, ty)) return;
  }
}

function harvestAt(state: GameState, tx: number, ty: number): boolean {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  const res = resourceOf(map.tiles[i]);
  if (res === null) return false;
  if (!canRodHarvest(state.rodTier, res)) {
    say(state, `The Rod does not yet know ${RESOURCE_LABEL[res]}. Seek a shrine.`);
    return true;
  }
  const depth = depthAt(state, tx, ty);
  const submerged = depth > 0;
  if (submerged && !state.inBoat) {
    say(state, 'The waters cover it. You would need a boat.');
    return true;
  }
  if (submerged && depth > state.rodReach) {
    say(state, 'Too deep for the Rod. You would need to fish.');
    return true;
  }
  map.tiles[i] = carveTo(map.biome[i]);
  state.mapRevision++;
  state.carried[res] += state.harvestYield;
  state.harvested += state.harvestYield;
  if (submerged) say(state, `Dredged +${state.harvestYield} ${RESOURCE_LABEL[res]}.`);
  else say(state, `+${state.harvestYield} ${RESOURCE_LABEL[res]}`);
  return true;
}

const RESOURCE_LABEL = ['fiber', 'gopher wood', 'stone', 'pitch'];

function dirX(dir: Dir): number {
  return dir === Dir.Left ? -1 : dir === Dir.Right ? 1 : 0;
}

function dirY(dir: Dir): number {
  return dir === Dir.Up ? -1 : dir === Dir.Down ? 1 : 0;
}

function stepTileEffects(state: GameState): void {
  const map = activeMap(state);
  const { player } = state;
  const tx = Math.floor((player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  const i = ty * map.w + tx;
  switch (map.tiles[i]) {
    case Tile.HeartContainer: {
      map.tiles[i] = Tile.Pedestal;
      state.mapRevision++;
      player.maxHearts++;
      player.hearts = player.maxHearts;
      state.heartsFound++;
      say(state, 'A heart container! Thy vessel is enlarged.');
      break;
    }
    case Tile.ArkSite:
      deliverToArk(state);
      break;
    case Tile.Key:
      map.tiles[i] = Tile.DungeonFloor;
      state.mapRevision++;
      state.keysHeld++;
      say(state, 'A key. Something here is locked.');
      break;
    case Tile.Chest:
      map.tiles[i] = Tile.DungeonFloor;
      state.mapRevision++;
      openChest(state);
      break;
    case Tile.Pit:
      fallInPit(state);
      break;
    default:
      break;
  }
}

function fallInPit(state: GameState): void {
  const p = state.player;
  const before = p.invuln;
  damage(state, 1);
  if (before > 0) return;
  if (state.safeSpot) {
    p.x = state.safeSpot.x;
    p.y = state.safeSpot.y;
    syncInterpolation(state);
  }
  say(state, 'You fall. The dark is deeper than it looked.');
}

function openChest(state: GameState): void {
  const dungeon = currentDungeon(state);
  if (!dungeon) return;
  if (state.dungeonsCleared[dungeon.id]) return;
  state.dungeonsCleared[dungeon.id] = true;
  switch (dungeon.reward) {
    case RewardKind.HeartContainer:
      state.player.maxHearts++;
      state.player.hearts = state.player.maxHearts;
      state.heartsFound++;
      break;
    case RewardKind.BuddingRod:
      state.harvestYield = 2;
      break;
    case RewardKind.SerpentRod:
      state.rodReach = 2;
      break;
  }
  say(state, `${REWARD_NAMES[dungeon.reward]}! Take it and go.`);
}

function tileUnder(state: GameState): { map: TileMap; tx: number; ty: number; i: number } {
  const map = activeMap(state);
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  return { map, tx, ty, i: ty * map.w + tx };
}

export function facingTile(state: GameState): { map: TileMap; tx: number; ty: number } {
  const map = activeMap(state);
  const p = state.player;
  const tx = Math.floor((p.x + PLAYER_W / 2 + dirX(p.dir) * TILE_PX) / TILE_PX);
  const ty = Math.floor((p.y + PLAYER_H / 2 + dirY(p.dir) * TILE_PX) / TILE_PX);
  return { map, tx, ty };
}

export interface ObstaclePrompt {
  tile: Tile;
  label: string;
  affordable: boolean;
}

export function obstacleInFront(state: GameState): ObstaclePrompt | null {
  const { map, tx, ty } = facingTile(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null;
  const tile = map.tiles[ty * map.w + tx] as Tile;
  if (tile === Tile.DoorLocked) {
    return {
      tile,
      label: state.keysHeld > 0 ? 'Unlock the door — 1 key' : 'Locked. A key is somewhere here.',
      affordable: state.keysHeld > 0,
    };
  }
  if (tile === Tile.PitchSeal) {
    const ready = state.rodTier >= SEAL_TIER;
    return {
      tile,
      label: ready
        ? 'Part the seal — the Rod knows pitch'
        : 'A seal of pitch. The Rod is not ready for this.',
      affordable: ready,
    };
  }
  const cost = OBSTACLE_COST[tile];
  if (!cost) return null;
  const held = state.carried[cost.resource];
  const verb = tile === Tile.Chasm ? 'Bridge the chasm' : 'Rope the ledge';
  return {
    tile,
    label: `${verb} — ${cost.amount} ${RESOURCE_LABEL[cost.resource]} (you have ${held})`,
    affordable: held >= cost.amount,
  };
}

export function actionPrompt(state: GameState): ObstaclePrompt | null {
  if (state.phase !== 'playing') return null;
  if (state.location.kind === 'overworld') {
    const { map, i } = tileUnder(state);
    if (map.tiles[i] === Tile.Shrine) return shrinePrompt(state, map.biome[i] as Biome);
    if (map.tiles[i] === Tile.BoatYard && !state.hasBoat) {
      const wood = state.carried[Resource.Wood];
      const fiber = state.carried[Resource.Fiber];
      return {
        tile: Tile.BoatYard,
        label: `Frame a skiff — ${BOAT_COST_WOOD} wood, ${BOAT_COST_FIBER} fiber (you have ${wood}, ${fiber})`,
        affordable: canAffordBoat(state.carried),
      };
    }
    if (state.hasBoat && !state.inBoat && hasAdjacentBoatable(state)) {
      return { tile: Tile.Water, label: 'Walk into the water to launch the skiff  [E]', affordable: true };
    }
    if (state.inBoat) {
      const facing = facingTile(state);
      if (facing.tx >= 0 && facing.ty >= 0 && facing.tx < facing.map.w && facing.ty < facing.map.h) {
        const fi = facing.ty * facing.map.w + facing.tx;
        if (
          resourceOf(facing.map.tiles[fi]) !== null &&
          facing.map.floods &&
          depthAt(state, facing.tx, facing.ty) > 0
        ) {
          return { tile: facing.map.tiles[fi] as Tile, label: 'Dredge the deep — swing the Rod', affordable: true };
        }
      }
    }
  }
  return obstacleInFront(state);
}

function handleInteract(state: GameState): void {
  const { map, i } = tileUnder(state);
  const standing = map.tiles[i];
  if (standing === Tile.Shrine) {
    tryImbueRod(state, map.biome[i] as Biome);
    return;
  }
  if (standing === Tile.BoatYard && !state.hasBoat) {
    tryCraftBoat(state);
    return;
  }
  if (tryLaunchBoat(state)) return;
  const { tx, ty } = facingTile(state);
  tryClear(state, tx, ty);
}

function shrinePrompt(state: GameState, biome: Biome): ObstaclePrompt {
  const cost = SHRINE_COST[biome] ?? 0;
  const res = biome as unknown as Resource;
  const held = state.carried[res] ?? 0;
  if (state.rodTier > biome) {
    return { tile: Tile.Shrine, label: 'The Rod already bears this gift.', affordable: false };
  }
  if (state.rodTier < biome) {
    return { tile: Tile.Shrine, label: 'This shrine is silent. Seek the lower biome first.', affordable: false };
  }
  const next = biome < Biome.Mountain ? RESOURCE_NAMES[(biome + 1) as Resource] : 'a budding harvest';
  return {
    tile: Tile.Shrine,
    label: `Imbue the Rod — ${cost} ${RESOURCE_LABEL[res]} → ${next} (you have ${held})`,
    affordable: held >= cost,
  };
}

function tryImbueRod(state: GameState, biome: Biome): void {
  if (state.rodTier > biome) {
    say(state, 'The Rod already bears this gift.');
    return;
  }
  if (state.rodTier < biome) {
    say(state, 'This shrine is silent. Seek the lower biome first.');
    return;
  }
  const cost = SHRINE_COST[biome] ?? 0;
  const res = biome as unknown as Resource;
  if (state.carried[res] < cost) {
    say(state, `The shrine wants ${cost} ${RESOURCE_LABEL[res]}.`);
    return;
  }
  state.carried[res] -= cost;
  state.rodTier++;
  if (state.rodTier >= 4) {
    state.harvestYield = Math.max(state.harvestYield, 2);
    say(state, 'Pitch crowns the Rod. It buds twice.');
    return;
  }
  say(state, `The Rod drinks. It will take ${RESOURCE_LABEL[state.rodTier]}.`);
}

function tryCraftBoat(state: GameState): void {
  if (state.hasBoat) return;
  if (!canAffordBoat(state.carried)) {
    say(state, `The slipway wants ${BOAT_COST_WOOD} gopher wood and ${BOAT_COST_FIBER} fiber.`);
    return;
  }
  payForBoat(state.carried);
  state.hasBoat = true;
  say(state, 'A skiff of gopher wood. Take it onto the waters.');
}

function tryLaunchBoat(state: GameState): boolean {
  if (!state.hasBoat || state.inBoat || state.location.kind !== 'overworld') return false;
  const dest = firstAdjacentBoatable(state);
  if (!dest) return false;
  state.player.x = dest.x * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = dest.y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  syncInterpolation(state);
  state.inBoat = true;
  say(state, 'The skiff takes the water.');
  return true;
}

function hasAdjacentBoatable(state: GameState): boolean {
  return firstAdjacentBoatable(state) !== null;
}

const boatSpot: Point = { x: 0, y: 0 };
const NEIGHBOUR_DX = [0, 0, -1, 1];
const NEIGHBOUR_DY = [-1, 1, 0, 0];

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

function canStepOnEntrance(state: GameState, tx: number, ty: number): boolean {
  const cx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const cy = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  if (cx === tx && cy === ty) return true;
  return cy > ty;
}

const HITBOX_SAMPLES = 6;
const hitboxScratch = new Int32Array(HITBOX_SAMPLES);

function hitboxTiles(state: GameState): number {
  const p = state.player;
  const map = activeMap(state);
  let n = 0;
  for (let s = 0; s < HITBOX_SAMPLES; s++) {
    const px = s === 4 || s === 5 ? p.x + PLAYER_W / 2 : s & 1 ? p.x + PLAYER_W - 1 : p.x;
    const py = s === 5 ? p.y + PLAYER_H / 2 : s === 4 ? p.y : s & 2 ? p.y + PLAYER_H - 1 : p.y;
    const tx = Math.floor(px / TILE_PX);
    const ty = Math.floor(py / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
    const k = ty * map.w + tx;
    let seen = false;
    for (let j = 0; j < n; j++) {
      if (hitboxScratch[j] === k) {
        seen = true;
        break;
      }
    }
    if (!seen) hitboxScratch[n++] = k;
  }
  return n;
}

function maybeDungeonWarp(state: GameState): void {
  if (state.phase !== 'playing') return;
  const map = activeMap(state);
  const n = hitboxTiles(state);
  if (state.location.kind === 'overworld') {
    for (let j = 0; j < n; j++) {
      const i = hitboxScratch[j];
      if (map.tiles[i] !== Tile.DungeonEntrance) continue;
      const tx = i % map.w;
      const ty = (i / map.w) | 0;
      if (!canStepOnEntrance(state, tx, ty)) continue;
      enterDungeonAt(state, tx, ty);
      return;
    }
    return;
  }
  for (let j = 0; j < n; j++) {
    if (map.tiles[hitboxScratch[j]] === Tile.Stairs) {
      exitDungeon(state);
      return;
    }
  }
}

function enterDungeonAt(state: GameState, tx: number, ty: number): void {
  if (state.location.kind === 'dungeon') return;
  const dungeon = state.world.dungeons.find(
    (d) => d.overworldEntrance.x === tx && d.overworldEntrance.y === ty,
  );
  if (!dungeon) return;
  if (depthAt(state, tx, ty) > 0) return;
  state.location = { kind: 'dungeon', dungeonId: dungeon.id, returnTo: { x: tx, y: ty } };
  state.keysHeld = 0;
  state.safeSpot = null;
  state.inBoat = false;
  placeOn(state, { x: dungeon.stairs.x, y: Math.max(1, dungeon.stairs.y - 1) });
  state.player.dir = Dir.Up;
  say(state, 'Down into the dark. The water does not wait.');
}

function exitDungeon(state: GameState): void {
  const back = state.location.returnTo;
  if (state.location.kind !== 'dungeon' || !back) return;
  state.location = { kind: 'overworld', dungeonId: -1, returnTo: null };
  state.keysHeld = 0;
  state.safeSpot = null;
  placeOn(state, exitSpot(state, back));
  state.player.dir = Dir.Down;
  say(state, 'Daylight. Or what is left of it.');
}

function exitSpot(state: GameState, entrance: Point): Point {
  const map = state.world;
  const spots = [
    { x: entrance.x, y: entrance.y + 1 },
    { x: entrance.x - 1, y: entrance.y + 1 },
    { x: entrance.x + 1, y: entrance.y + 1 },
    { x: entrance.x - 1, y: entrance.y },
    { x: entrance.x + 1, y: entrance.y },
  ];
  for (const p of spots) {
    if (p.x < 0 || p.y < 0 || p.x >= map.w || p.y >= map.h) continue;
    const tile = map.tiles[p.y * map.w + p.x];
    if (tile === Tile.DungeonEntrance) continue;
    if (isWalkable(tile)) return p;
  }
  return { x: entrance.x, y: entrance.y + 1 };
}

export function syncInterpolation(state: GameState): void {
  state.player.prevX = state.player.x;
  state.player.prevY = state.player.y;
  state.camera.prevScroll = state.camera.scroll;
}

function placeOn(state: GameState, tile: Point): void {
  state.player.x = tile.x * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = tile.y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
  syncInterpolation(state);
}

export function snapCamera(state: GameState): void {
  const panelX = Math.floor((state.player.x + PLAYER_W / 2) / PANEL_PX_W);
  const panelY = Math.floor((state.player.y + PLAYER_H / 2) / PANEL_PX_H);
  state.camera.panelX = panelX;
  state.camera.panelY = panelY;
  state.camera.fromX = panelX;
  state.camera.fromY = panelY;
  state.camera.scroll = 0;
  markExplored(state);
}

function tryClear(state: GameState, tx: number, ty: number): void {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  const i = ty * map.w + tx;
  const tile = map.tiles[i] as Tile;
  if (tile === Tile.DoorLocked) {
    if (state.keysHeld < 1) {
      say(state, 'Locked. A key is somewhere in here.');
      return;
    }
    state.keysHeld--;
    convertConnected(map, tx, ty, tile, Tile.DoorOpen);
    state.mapRevision++;
    say(state, 'The key turns.');
    return;
  }
  if (tile === Tile.PitchSeal) {
    if (state.rodTier < SEAL_TIER) {
      say(state, 'The seal holds. Imbue the Rod with pitch and return.');
      return;
    }
    convertConnected(map, tx, ty, tile, Tile.DungeonFloor);
    state.mapRevision++;
    say(state, 'The Rod drinks the pitch. The seal parts.');
    return;
  }
  const cost = OBSTACLE_COST[tile];
  if (!cost) return;
  const held = state.carried[cost.resource];
  const name = RESOURCE_LABEL[cost.resource];
  if (held < cost.amount) {
    say(state, `Not enough ${name} — ${cost.amount} needed, you have ${held}.`);
    return;
  }
  state.carried[cost.resource] -= cost.amount;
  convertConnected(map, tx, ty, tile, OBSTACLE_CLEARS_TO[tile]);
  state.mapRevision++;
  say(state, `${cost.amount} ${name} spent. The ark will notice.`);
}

function convertConnected(map: TileMap, tx: number, ty: number, from: Tile, to: Tile): void {
  const queue = [ty * map.w + tx];
  let converted = 0;
  while (queue.length > 0 && converted < CLEAR_LIMIT) {
    const i = queue.pop() as number;
    if (map.tiles[i] !== from) continue;
    map.tiles[i] = to;
    converted++;
    const x = i % map.w;
    const y = (i / map.w) | 0;
    if (x > 0) queue.push(i - 1);
    if (x < map.w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - map.w);
    if (y < map.h - 1) queue.push(i + map.w);
  }
}

function rememberSafeSpot(state: GameState): void {
  const { map, i } = tileUnder(state);
  if (i < 0 || i >= map.tiles.length) return;
  if (map.tiles[i] === Tile.Pit) return;
  if (!isWalkable(map.tiles[i])) return;
  state.safeSpot = { x: state.player.x, y: state.player.y };
}

function deliverToArk(state: GameState): void {
  let moved = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const need = ARK_RECIPE[r as Resource] - state.delivered[r];
    const give = Math.min(need, state.carried[r]);
    if (give > 0) {
      state.delivered[r] += give;
      state.carried[r] -= give;
      moved += give;
    }
  }
  if (moved > 0) say(state, `Delivered ${moved} to the ark.`);
}

function applyFlood(state: GameState, dt: number): void {
  const p = state.player;
  if (state.inBoat) {
    p.drownTimer = 0;
    return;
  }
  const submerged = isSubmergedAt(state, p.x + PLAYER_W / 2, p.y + PLAYER_H / 2);
  if (!submerged) {
    p.drownTimer = 0;
    return;
  }
  p.drownTimer += dt;
  if (p.drownTimer >= DROWN_INTERVAL) {
    p.drownTimer -= DROWN_INTERVAL;
    damage(state, 1);
  }
}

export function damage(state: GameState, amount: number): void {
  const p = state.player;
  if (p.invuln > 0) return;
  p.hearts = Math.max(0, p.hearts - amount);
  p.invuln = INVULN_TIME;
}

function updateCamera(state: GameState): void {
  const p = state.player;
  const panelX = Math.floor((p.x + PLAYER_W / 2) / PANEL_PX_W);
  const panelY = Math.floor((p.y + PLAYER_H / 2) / PANEL_PX_H);
  if (panelX !== state.camera.panelX || panelY !== state.camera.panelY) {
    state.camera.fromX = state.camera.panelX;
    state.camera.fromY = state.camera.panelY;
    state.camera.panelX = panelX;
    state.camera.panelY = panelY;
    state.camera.scroll = 1;
  }
  markExplored(state);
}

function checkEndConditions(state: GameState): void {
  if (state.player.hearts <= 0) {
    state.phase = 'drowned';
    return;
  }
  let complete = true;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    if (state.delivered[r] < ARK_RECIPE[r as Resource]) {
      complete = false;
      break;
    }
  }
  if (complete) state.phase = 'won';
}

export function arkProgress(state: GameState): number {
  let have = 0;
  let need = 0;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const req = ARK_RECIPE[r as Resource];
    have += Math.min(state.delivered[r], req);
    need += req;
  }
  return need > 0 ? have / need : 0;
}

export function flockScore(state: GameState): FlockScore {
  return flockScoreOf(state.world.animals);
}

function tickFlock(state: GameState, dt: number): void {
  const map = state.world;
  const player =
    state.location.kind === 'overworld'
      ? { x: state.player.x + PLAYER_W / 2, y: state.player.y + PLAYER_H / 2 }
      : null;
  const { drowned } = stepAnimals(map.animals, map, waterLevel(state), dt, player);
  if (state.messageTimer <= 0) {
    if (drowned.length === 1) say(state, `The waters took a ${animalDef(drowned[0].kind).name}.`);
    else if (drowned.length > 1) say(state, `The waters took ${drowned.length} of the flock.`);
  }
  if (state.location.kind !== 'overworld') return;
  const p = state.player;
  for (const a of map.animals) {
    if (!animalOverlaps(a, p.x, p.y, PLAYER_W, PLAYER_H)) continue;
    a.status = AnimalStatus.Boarded;
    const score = flockScoreOf(map.animals);
    const def = ANIMAL_DEFS[a.kind];
    const have = score.boarded[a.kind];
    if (have >= 2) say(state, `A pair of ${def.plural}. Two of every kind.`);
    else say(state, `A ${def.name} comes aboard. (${have}/2)`);
    break;
  }
}

export function say(state: GameState, text: string): void {
  state.message = text;
  state.messageTimer = MESSAGE_TIME;
}
