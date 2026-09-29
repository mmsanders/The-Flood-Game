/**
 * The shape of a run: the player, the camera, where they are, and the whole
 * GameState. A leaf module (no logic, no game imports) so every other module
 * in src/game can depend on it without cycles.
 */

import { Tile } from '../core/tiles.js';
import type { Point, World } from '../core/world.js';

/** Player hitbox, in pixels. Narrower than a tile so doorways feel generous. */
export const PLAYER_W = 10;

export const PLAYER_H = 11;

export const enum Dir {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

export type Phase = 'playing' | 'won' | 'drowned';

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

export interface StepInput {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
  /** Enter a dungeon, climb out, barter, portage, or clear an obstacle. */
  interactPressed?: boolean;
}

export interface ObstaclePrompt {
  tile: Tile;
  label: string;
  affordable: boolean;
}

/**
 * One thing E can do where the player stands: what the HUD offers, and what
 * pressing E does, written side by side so the two cannot drift apart.
 */
export interface Action {
  /** What the HUD shows; null when E acts here without a prompt. */
  prompt: ObstaclePrompt | null;
  /**
   * What E does. Returning false passes E on to the next provider. Absent for
   * hints that only inform — the dredge hint says to swing the Rod, not E.
   */
  run?: (state: GameState) => boolean;
}
