/**
 * Game state and the rules that move it forward.
 *
 * Deliberately DOM-free and deterministic given (world, inputs, dt), so the
 * whole simulation can be stepped headlessly in tests without a canvas.
 *
 * This module creates a run, adopts a live run across a hot reload, and
 * orders one simulation step. The rules themselves live beside it, one
 * system per module; this is still the single public entry point, so
 * everything the game and tests use is re-exported from here, and main.ts
 * hot-accepts this module alone.
 */

import { BASE_BOAT_DEPTH } from '../core/boat.js';
import { PANEL_H, PANEL_W, TILE_PX } from '../core/config.js';
import { NODE_YIELD } from '../core/resources.js';
import { carveTo, RESOURCE_COUNT, Tile } from '../core/tiles.js';
import { PoiKind, type World } from '../core/world.js';
import { handleInteract } from './actions.js';
import { markExplored, syncInterpolation, updateCamera } from './camera.js';
import { rememberSafeSpot, stepTileEffects } from './ground.js';
import { movePlayer } from './movement.js';
import { maybeDungeonWarp } from './places.js';
import { swingRod } from './rod.js';
import { applyFlood, checkEndConditions, tickFlock } from './run.js';
import { checkStrandedBoat } from './skiff.js';
import { Dir, type GameState, PLAYER_H, PLAYER_W, type StepInput } from './types.js';

export { actionPrompt } from './actions.js';
export { markExplored, snapCamera, syncInterpolation } from './camera.js';
export { obstacleInFront } from './ground.js';
export { LODESTONE_DIR_NAME, lodestoneBearing, releaseDove } from './instruments.js';
export {
  activeMap,
  currentDay,
  currentDungeon,
  currentInterior,
  depthAt,
  facingTile,
  gorgeRunoff,
  isBoatableTile,
  keysHere,
  say,
  waterLevel,
} from './queries.js';
export { arkProgress, damage, flockScore } from './run.js';
export { Dir, PLAYER_H, PLAYER_W } from './types.js';
export type {
  Camera,
  GameState,
  Location,
  ObstaclePrompt,
  Phase,
  Player,
  StepInput,
} from './types.js';

const SWING_TIME = 0.22;
const SWING_COOLDOWN = 0.3;
const SCROLL_TIME = 0.4;

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
    keysByDungeon: new Array<number>(world.dungeons.length).fill(0),
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
    keysByDungeon: adoptKeys(running),
    exploredOverworld: adoptGrid(running.exploredOverworld, next.exploredOverworld),
    exploredDungeons: adoptDungeonGrids(running.exploredDungeons, next.exploredDungeons),
    exploredInteriors: adoptDungeonGrids(running.exploredInteriors ?? [], next.exploredInteriors),
  };
  delete (merged as LegacyState).keysHeld;
  markExplored(merged);
  for (const a of merged.world.animals) {
    if (typeof a.prevX !== 'number') a.prevX = a.x;
    if (typeof a.prevY !== 'number') a.prevY = a.y;
  }
  syncInterpolation(merged);
  return merged;
}

/** Fields a live run may still carry from an older rules module. */
interface LegacyState {
  /** One key count for whichever cave you stood in, zeroed at every stair. */
  keysHeld?: number;
}

/** Keys became per-cave; a key held under the old rules stays in its cave. */
function adoptKeys(running: GameState & LegacyState): number[] {
  const keys = padCounts(running.keysByDungeon, running.world.dungeons.length);
  const cave = running.location.kind === 'dungeon' ? running.location.dungeonId : -1;
  if (!running.keysByDungeon && running.keysHeld && cave >= 0 && cave < keys.length) {
    keys[cave] += running.keysHeld;
  }
  return keys;
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
  checkStrandedBoat(state);

  // Panel transitions lock input, Zelda-style: the screen slides, you wait.
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
