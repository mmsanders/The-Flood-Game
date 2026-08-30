/**
 * Game state and the rules that move it forward.
 *
 * Deliberately DOM-free and deterministic given (world, inputs, dt), so the
 * whole simulation can be stepped headlessly in tests without a canvas.
 */

import { PANEL_H, PANEL_PX_H, PANEL_PX_W, PANEL_W, TILE_PX } from '../core/config.js';
import { waterLevelAtSeconds } from '../core/flood.js';
import { ARK_RECIPE, NODE_YIELD, PLAYER_TILES_PER_SEC } from '../core/resources.js';
import {
  RESOURCE_COUNT,
  type Resource,
  Tile,
  carveTo,
  isWalkable,
  resourceOf,
} from '../core/tiles.js';
import type { World } from '../core/world.js';

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

export interface Player {
  /** Top-left of the hitbox, in world pixels. */
  x: number;
  y: number;
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
  fromX: number;
  fromY: number;
}

export interface GameState {
  world: World;
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
}

export function createGame(world: World): GameState {
  return {
    world,
    player: {
      x: world.spawn.x * TILE_PX + (TILE_PX - PLAYER_W) / 2,
      y: world.spawn.y * TILE_PX + (TILE_PX - PLAYER_H) / 2,
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
      fromX: Math.floor(world.spawn.x / PANEL_W),
      fromY: Math.floor(world.spawn.y / PANEL_H),
    },
    message: null,
    messageTimer: 0,
    harvested: 0,
    heartsFound: 0,
  };
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
}

export function step(state: GameState, input: StepInput, dt: number): void {
  if (state.phase !== 'playing') return;

  state.elapsed += dt;

  const p = state.player;
  p.swing = Math.max(0, p.swing - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (state.messageTimer > 0) {
    state.messageTimer -= dt;
    if (state.messageTimer <= 0) state.message = null;
  }

  // Panel transitions lock input, Zelda-style: the screen slides, you wait.
  if (state.camera.scroll > 0) {
    state.camera.scroll = Math.max(0, state.camera.scroll - dt / SCROLL_TIME);
    applyFlood(state, dt);
    return;
  }

  movePlayer(state, input, dt);

  if (input.attackPressed && p.cooldown <= 0) {
    p.swing = SWING_TIME;
    p.cooldown = SWING_TIME + SWING_COOLDOWN;
    swingRod(state);
  }

  stepTileEffects(state);
  applyFlood(state, dt);
  updateCamera(state);
  checkEndConditions(state);
}

// ---------------------------------------------------------------- movement

function movePlayer(state: GameState, input: StepInput, dt: number): void {
  const p = state.player;
  let dx = input.moveX;
  let dy = input.moveY;

  if (dx !== 0 && dy !== 0) {
    // Normalise so diagonals aren't faster than the cardinals.
    const inv = Math.SQRT1_2;
    dx *= inv;
    dy *= inv;
  }

  p.moving = dx !== 0 || dy !== 0;
  if (p.moving) {
    p.animTime += dt;
    // Face the dominant axis, favouring horizontal so strafing reads clearly.
    if (Math.abs(input.moveX) >= Math.abs(input.moveY)) {
      if (input.moveX > 0) p.dir = Dir.Right;
      else if (input.moveX < 0) p.dir = Dir.Left;
    } else if (input.moveY > 0) p.dir = Dir.Down;
    else if (input.moveY < 0) p.dir = Dir.Up;
  }

  const wading = isSubmergedAt(state, p.x + PLAYER_W / 2, p.y + PLAYER_H / 2);
  const speed = SPEED_PX * (wading ? WADE_SPEED_SCALE : 1) * dt;

  // Resolve axes separately so sliding along a wall works.
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
    return;
  }

  // Blocked: step up to the obstruction rather than stopping short of it.
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

/**
 * Can the hitbox sit here? Checks the four corners against terrain.
 *
 * Floodwater blocks movement *into* it, but a player already wading (because
 * the water rose under them) can keep moving through water — otherwise a
 * rising tide would freeze you in place instead of chasing you uphill.
 */
function canOccupy(state: GameState, x: number, y: number): boolean {
  const { world } = state;
  const alreadyWading = isSubmergedAt(
    state,
    state.player.x + PLAYER_W / 2,
    state.player.y + PLAYER_H / 2,
  );
  const level = waterLevel(state);

  const corners: [number, number][] = [
    [x, y],
    [x + PLAYER_W - 1, y],
    [x, y + PLAYER_H - 1],
    [x + PLAYER_W - 1, y + PLAYER_H - 1],
  ];

  for (const [cx, cy] of corners) {
    const tx = Math.floor(cx / TILE_PX);
    const ty = Math.floor(cy / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
    const i = ty * world.w + tx;
    if (!isWalkable(world.tiles[i])) return false;
    if (!alreadyWading && world.elev[i] < level) return false;
  }

  return true;
}

function isSubmergedAt(state: GameState, pxX: number, pxY: number): boolean {
  const { world } = state;
  const tx = Math.floor(pxX / TILE_PX);
  const ty = Math.floor(pxY / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  return world.elev[ty * world.w + tx] < waterLevel(state);
}

// ---------------------------------------------------------------- the rod

/**
 * The Rod of Aaron is weapon and tool at once: the same swing that will fight
 * things later is what harvests a resource node now.
 */
function swingRod(state: GameState): void {
  const p = state.player;
  const cx = p.x + PLAYER_W / 2;
  const cy = p.y + PLAYER_H / 2;

  const reach = TILE_PX;
  const tx = Math.floor((cx + dirX(p.dir) * reach) / TILE_PX);
  const ty = Math.floor((cy + dirY(p.dir) * reach) / TILE_PX);

  harvestAt(state, tx, ty);
}

function harvestAt(state: GameState, tx: number, ty: number): void {
  const { world } = state;
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return;

  const i = ty * world.w + tx;
  const res = resourceOf(world.tiles[i]);
  if (res === null) return;

  world.tiles[i] = carveTo(world.biome[i]);
  state.carried[res] += NODE_YIELD;
  state.harvested++;
  say(state, `+${NODE_YIELD} ${RESOURCE_LABEL[res]}`);
}

const RESOURCE_LABEL = ['fiber', 'gopher wood', 'stone', 'pitch'];

function dirX(dir: Dir): number {
  return dir === Dir.Left ? -1 : dir === Dir.Right ? 1 : 0;
}

function dirY(dir: Dir): number {
  return dir === Dir.Up ? -1 : dir === Dir.Down ? 1 : 0;
}

// ---------------------------------------------------------------- tile effects

function stepTileEffects(state: GameState): void {
  const { world, player } = state;
  const tx = Math.floor((player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return;

  const i = ty * world.w + tx;

  switch (world.tiles[i]) {
    case Tile.HeartContainer: {
      world.tiles[i] = carveTo(world.biome[i]);
      player.maxHearts++;
      player.hearts = player.maxHearts;
      state.heartsFound++;
      say(state, 'A heart container! Thy vessel is enlarged.');
      break;
    }
    case Tile.ArkSite: {
      deliverToArk(state);
      break;
    }
    case Tile.DungeonEntrance: {
      say(state, 'The door is sealed. Not yet.');
      break;
    }
    default:
      break;
  }
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

// ---------------------------------------------------------------- flood

function applyFlood(state: GameState, dt: number): void {
  const p = state.player;
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

// ---------------------------------------------------------------- camera

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
}

// ---------------------------------------------------------------- endings

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

/** Fraction of the ark built, from what's been delivered. */
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

export function say(state: GameState, text: string): void {
  state.message = text;
  state.messageTimer = MESSAGE_TIME;
}
