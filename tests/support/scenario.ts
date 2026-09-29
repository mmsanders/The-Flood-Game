/**
 * Shared scenario helpers for the characterization and replay suites.
 *
 * These suites exist to prove that restructuring `src/game/state.ts` changed
 * nothing a player could observe, so they describe behaviour in terms of what
 * the HUD shows and what pressing E does — never in terms of internal
 * function names that a refactor is free to move.
 */

import { TILE_PX, withParams } from '../../src/core/config.js';
import { Biome, Tile } from '../../src/core/tiles.js';
import { generateWorld } from '../../src/core/worldgen/index.js';
import {
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  createGame,
  snapCamera,
  step,
  type GameState,
  type StepInput,
} from '../../src/game/state.js';

export const SMALL = withParams({ panelsX: 8, panelsY: 20 });
export const IDLE: StepInput = { moveX: 0, moveY: 0, attackPressed: false };
export const PRESS_E: StepInput = { moveX: 0, moveY: 0, attackPressed: false, interactPressed: true };
export const STEP = 1 / 60;

export function newGame(seed = 4242): GameState {
  return createGame(generateWorld(seed, SMALL));
}

/** Put the player's centre on a tile and snap the camera, like any teleport. */
export function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  state.player.prevX = state.player.x;
  state.player.prevY = state.player.y;
  snapCamera(state);
}

/** Dry, level grass around a tile, so a scenario isn't fighting worldgen. */
export function clearArea(state: GameState, tx: number, ty: number, radius: number): void {
  const { world } = state;
  for (let y = ty - radius; y <= ty + radius; y++) {
    for (let x = tx - radius; x <= tx + radius; x++) {
      if (x < 1 || y < 1 || x >= world.w - 1 || y >= world.h - 1) continue;
      world.tiles[y * world.w + x] = Tile.Grass;
      world.elev[y * world.w + x] = 250;
    }
  }
}

export function setTile(state: GameState, tx: number, ty: number, tile: Tile, biome?: Biome): void {
  const { world } = state;
  world.tiles[ty * world.w + tx] = tile;
  if (biome !== undefined) world.biome[ty * world.w + tx] = biome;
}

/** A cleared patch well inside the map, away from the rim. */
export function stage(state: GameState): { x: number; y: number } {
  const x = Math.floor(state.world.w / 2);
  const y = Math.floor(state.world.h / 2);
  clearArea(state, x, y, 5);
  placeAt(state, x, y);
  return { x, y };
}

/**
 * Everything pressing E could plausibly change, in one comparable object.
 * Deliberately broad: a refactor that quietly moved a side effect onto the
 * wrong branch should show up here even if the message text survived.
 */
export function digest(state: GameState) {
  const p = state.player;
  return {
    where: state.location.kind,
    dungeonId: state.location.dungeonId,
    interiorId: state.location.interiorId,
    tile: {
      x: Math.floor((p.x + PLAYER_W / 2) / TILE_PX),
      y: Math.floor((p.y + PLAYER_H / 2) / TILE_PX),
    },
    dir: p.dir,
    hearts: `${p.hearts}/${p.maxHearts}`,
    carried: state.carried.join(','),
    delivered: state.delivered.join(','),
    rod: { tier: state.rodTier, reach: state.rodReach, yield: state.harvestYield },
    keys: state.keysHeld,
    skiff: {
      has: state.hasBoat,
      in: state.inBoat,
      hauling: state.haulingBoat,
      depth: state.boatDepth,
      at: `${state.boatX},${state.boatY}`,
    },
    kit: [
      state.hasGaloshes && 'galoshes',
      state.hasAxe && `axe${state.axeDurability}`,
      state.hasPickaxe && `pick${state.pickaxeDurability}`,
      state.hasSoundingLine && 'line',
      state.hasChart && 'chart',
      state.hasLodestone && 'lodestone',
      state.hasDove && 'dove',
    ]
      .filter(Boolean)
      .join(' '),
    shopHearts: state.shopHeartMask,
    hermit: state.hermitHeartClaimed,
    cleared: state.dungeonsCleared.map((c) => (c ? 1 : 0)).join(''),
    message: state.message,
    phase: state.phase,
  };
}

/** What the HUD shows, then what one press of E does to the world. */
export function pressE(state: GameState) {
  const prompt = actionPrompt(state);
  state.message = null;
  state.messageTimer = 0;
  step(state, PRESS_E, STEP);
  return { prompt, after: digest(state) };
}

/** What the HUD shows, with no input — for prompt-only scenarios. */
export function promptOf(state: GameState) {
  const p = actionPrompt(state);
  return p ? { tile: p.tile, label: p.label, affordable: p.affordable } : null;
}
