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
import { waterLevelAtSeconds } from '../core/flood.js';
import { ARK_RECIPE, NODE_YIELD, PLAYER_TILES_PER_SEC } from '../core/resources.js';
import type { TileMap } from '../core/tilemap.js';
import {
  RESOURCE_COUNT,
  type Resource,
  Tile,
  carveTo,
  isWalkable,
  resourceOf,
} from '../core/tiles.js';
import type { Point, World } from '../core/world.js';

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

/** Where the player currently is. Dungeons are separate maps, not sub-areas. */
export interface Location {
  kind: 'overworld' | 'dungeon';
  /** Index into `world.dungeons`, or -1 above ground. */
  dungeonId: number;
  /** Overworld tile to put the player back on when they surface. */
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
  /** Swing reach in tiles. The Serpent Rod extends it. */
  rodReach: number;
  dungeonsCleared: boolean[];
}

export function createGame(world: World): GameState {
  return {
    world,
    location: { kind: 'overworld', dungeonId: -1, returnTo: null },
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
    keysHeld: 0,
    safeSpot: null,
    harvestYield: NODE_YIELD,
    rodReach: 1,
    dungeonsCleared: world.dungeons.map(() => false),
  };
}

/**
 * The map the player is standing on.
 *
 * Movement, collision, harvesting and rendering all read this rather than
 * `state.world`, which is what lets a dungeon be a whole separate map without
 * a single "am I underground" branch in any of them.
 */
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
  /** Enter a dungeon, climb out, or pay to clear the obstacle in front. */
  interactPressed?: boolean;
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

  if (input.interactPressed) handleInteract(state);

  rememberSafeSpot(state);
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
  const map = activeMap(state);
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
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    const i = ty * map.w + tx;
    if (!isWalkable(map.tiles[i])) return false;
    if (map.floods && !alreadyWading && map.elev[i] < level) return false;
  }

  return true;
}

function isSubmergedAt(state: GameState, pxX: number, pxY: number): boolean {
  const map = activeMap(state);
  if (!map.floods) return false;
  const tx = Math.floor(pxX / TILE_PX);
  const ty = Math.floor(pxY / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return map.elev[ty * map.w + tx] < waterLevel(state);
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

  const reach = TILE_PX * state.rodReach;
  const tx = Math.floor((cx + dirX(p.dir) * reach) / TILE_PX);
  const ty = Math.floor((cy + dirY(p.dir) * reach) / TILE_PX);

  harvestAt(state, tx, ty);
}

function harvestAt(state: GameState, tx: number, ty: number): void {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;

  const i = ty * map.w + tx;
  const res = resourceOf(map.tiles[i]);
  if (res === null) return;

  map.tiles[i] = carveTo(map.biome[i]);
  state.carried[res] += state.harvestYield;
  state.harvested += state.harvestYield;
  say(state, `+${state.harvestYield} ${RESOURCE_LABEL[res]}`);
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
  const map = activeMap(state);
  const { player } = state;
  const tx = Math.floor((player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;

  const i = ty * map.w + tx;

  switch (map.tiles[i]) {
    case Tile.HeartContainer: {
      map.tiles[i] = carveTo(map.biome[i]);
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
    case Tile.Key: {
      map.tiles[i] = Tile.DungeonFloor;
      state.keysHeld++;
      say(state, 'A key. Something here is locked.');
      break;
    }
    case Tile.Chest: {
      map.tiles[i] = Tile.DungeonFloor;
      openChest(state);
      break;
    }
    case Tile.Pit: {
      fallInPit(state);
      break;
    }
    // Stairs and dungeon doors are entered deliberately, never by walking
    // over them — otherwise arriving would immediately bounce you back out.
    default:
      break;
  }
}

/** Costs a heart and returns the player to the last ground they stood on. */
function fallInPit(state: GameState): void {
  const p = state.player;
  const before = p.invuln;
  damage(state, 1);
  // Invulnerability frames would otherwise let a player walk a pit for free.
  if (before > 0) return;

  if (state.safeSpot) {
    p.x = state.safeSpot.x;
    p.y = state.safeSpot.y;
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

// ---------------------------------------------------------------- interaction

/** Tile the player is standing on. */
function tileUnder(state: GameState): { map: TileMap; tx: number; ty: number; i: number } {
  const map = activeMap(state);
  const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  return { map, tx, ty, i: ty * map.w + tx };
}

/** Tile the player is facing, within the rod's reach. */
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

/**
 * What the player could pay for right now, if anything.
 *
 * The HUD renders this verbatim. Making the price and your balance visible at
 * the moment of the decision is the whole point of the mechanic — a cost you
 * discover only after paying it isn't a trade, it's a surprise.
 */
export function obstacleInFront(state: GameState): ObstaclePrompt | null {
  const { map, tx, ty } = facingTile(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null;

  const tile = map.tiles[ty * map.w + tx] as Tile;

  if (tile === Tile.DoorLocked) {
    return {
      tile,
      label:
        state.keysHeld > 0 ? 'Unlock the door — 1 key' : 'Locked. A key is somewhere here.',
      affordable: state.keysHeld > 0,
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

function handleInteract(state: GameState): void {
  const { map, i } = tileUnder(state);
  const standing = map.tiles[i];

  if (standing === Tile.DungeonEntrance) {
    enterDungeon(state);
    return;
  }
  if (standing === Tile.Stairs) {
    exitDungeon(state);
    return;
  }

  const { tx, ty } = facingTile(state);
  tryClear(state, tx, ty);
}

function enterDungeon(state: GameState): void {
  if (state.location.kind === 'dungeon') return;

  const { tx, ty } = tileUnder(state);
  const dungeon = state.world.dungeons.find(
    (d) => d.overworldEntrance.x === tx && d.overworldEntrance.y === ty,
  );
  if (!dungeon) return;

  // Once the water reaches the mouth, that dungeon is gone for the run. This
  // is what makes a low-lying dungeon a decision about when, not whether.
  if (state.world.elev[ty * state.world.w + tx] < waterLevel(state)) {
    say(state, 'The way down is underwater. Too late for this one.');
    return;
  }

  state.location = {
    kind: 'dungeon',
    dungeonId: dungeon.id,
    returnTo: { x: tx, y: ty },
  };
  // Keys never travel between dungeons: each lock is opened by its own key.
  state.keysHeld = 0;
  state.safeSpot = null;
  placeOn(state, dungeon.stairs);
  say(state, 'Down into the dark. The water does not wait.');
}

function exitDungeon(state: GameState): void {
  const back = state.location.returnTo;
  if (state.location.kind !== 'dungeon' || !back) return;

  state.location = { kind: 'overworld', dungeonId: -1, returnTo: null };
  state.keysHeld = 0;
  state.safeSpot = null;
  placeOn(state, back);
  say(state, 'Daylight. Or what is left of it.');
}

/** Move the player onto a tile and snap the camera to its panel. */
function placeOn(state: GameState, tile: Point): void {
  state.player.x = tile.x * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = tile.y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
}

/**
 * Put the camera on the player's panel with no transition.
 *
 * Any teleport has to do this. A scroll left running would swallow the next
 * frame's input entirely, since panel transitions deliberately lock control.
 */
export function snapCamera(state: GameState): void {
  const panelX = Math.floor((state.player.x + PLAYER_W / 2) / PANEL_PX_W);
  const panelY = Math.floor((state.player.y + PLAYER_H / 2) / PANEL_PX_H);
  state.camera.panelX = panelX;
  state.camera.panelY = panelY;
  state.camera.fromX = panelX;
  state.camera.fromY = panelY;
  state.camera.scroll = 0;
}

/**
 * Pay to cross. Costs come out of the same stock the ark needs, which is the
 * entire reason dungeons are interesting rather than just long.
 */
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
    say(state, 'The key turns.');
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
  say(state, `${cost.amount} ${name} spent. The ark will notice.`);
}

/**
 * Convert a whole obstacle band in one payment.
 *
 * An obstacle spans both sides of a doorway, so charging per tile would bill
 * the player several times for one crossing.
 */
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

/** Track the last safe ground, so a pit has somewhere to spit the player out. */
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
