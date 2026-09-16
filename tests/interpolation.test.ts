import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import { AnimalStatus } from '../src/core/animals.js';
import { Tile } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  type GameState,
  PLAYER_H,
  PLAYER_W,
  activeMap,
  adoptHotState,
  createGame,
  snapCamera,
  step,
  syncInterpolation,
} from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const IDLE = { moveX: 0, moveY: 0, attackPressed: false };

function newState(seed = 4242): GameState {
  return createGame(generateWorld(seed, SMALL));
}

function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
  syncInterpolation(state);
}

/**
 * The renderer draws the player between `prevX/prevY` and `x/y`, so any
 * discontinuity that is *not* snapped shows up as a frame of the player
 * sliding across the map. These tests are about that invariant: after a step,
 * the gap between the two must be one step of walking, never a teleport.
 */
const MAX_STEP_PX = (4 * TILE_PX) / 60 + 0.001;

describe('render interpolation', () => {
  it('starts with the previous position equal to the current one', () => {
    const state = newState();
    expect(state.player.prevX).toBe(state.player.x);
    expect(state.player.prevY).toBe(state.player.y);
    expect(state.camera.prevScroll).toBe(state.camera.scroll);
  });

  it('records where the player was at the top of the step', () => {
    const state = newState();
    const before = { x: state.player.x, y: state.player.y };
    step(state, { moveX: 1, moveY: 0, attackPressed: false }, 1 / 60);

    expect(state.player.prevX).toBe(before.x);
    expect(state.player.prevY).toBe(before.y);
  });

  it('never leaves a gap larger than one step of walking', () => {
    const state = newState();
    for (let i = 0; i < 600; i++) {
      const dir = i % 240 < 120 ? 1 : -1;
      step(state, { moveX: dir, moveY: i % 120 < 60 ? 1 : -1, attackPressed: false }, 1 / 60);

      const dx = Math.abs(state.player.x - state.player.prevX);
      const dy = Math.abs(state.player.y - state.player.prevY);
      expect(dx, `frame ${i} dx`).toBeLessThanOrEqual(MAX_STEP_PX);
      expect(dy, `frame ${i} dy`).toBeLessThanOrEqual(MAX_STEP_PX);
    }
  });

  it('snaps when a pit throws the player back to safe ground', () => {
    const state = newState();
    const map = activeMap(state);

    // Stand somewhere, remember it as safe, then drop a pit under the player.
    const spawn = state.world.spawn;
    placeAt(state, spawn.x, spawn.y);
    step(state, IDLE, 1 / 60);
    expect(state.safeSpot).not.toBeNull();

    // Six tiles away, kept inside the map, so the jump back is unmistakable.
    const pitX = Math.min(map.w - 2, spawn.x + 6);
    const pitY = Math.min(map.h - 2, spawn.y + 6);
    placeAt(state, pitX, pitY);
    const far = { x: state.player.x, y: state.player.y };

    map.tiles[pitY * map.w + pitX] = Tile.Pit;

    step(state, IDLE, 1 / 60);

    // The pit did fire: the player is back on the ground they came from...
    expect(state.player.x).not.toBe(far.x);
    expect(state.player.y).not.toBe(far.y);
    // ...and prev came with them, so no frame draws the trip across the map.
    expect(state.player.prevX).toBe(state.player.x);
    expect(state.player.prevY).toBe(state.player.y);
  });

  it('snaps when the skiff launches onto an adjacent tile', () => {
    const state = newState();
    const map = activeMap(state);
    const spawn = state.world.spawn;

    placeAt(state, spawn.x, spawn.y);
    state.skiff = {
      x: Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX),
      y: Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX),
      pitched: false,
    };
    map.tiles[spawn.y * map.w + spawn.x + 1] = Tile.Water;

    step(state, { moveX: 0, moveY: 0, attackPressed: false, interactPressed: true }, 1 / 60);

    if (state.inBoat) {
      expect(state.player.prevX).toBe(state.player.x);
      expect(state.player.prevY).toBe(state.player.y);
    }
  });

  it('carries animals through the same snapshot', () => {
    const state = newState();
    const wild = state.world.animals.find((a) => a.status === AnimalStatus.Wild);
    expect(wild).toBeDefined();
    if (!wild) return;

    expect(wild.prevX).toBe(wild.x);

    for (let i = 0; i < 120; i++) step(state, IDLE, 1 / 60);

    for (const a of state.world.animals) {
      if (a.status !== AnimalStatus.Wild) continue;
      // Even the quickest kind cannot cross more than a tile in one step.
      expect(Math.abs(a.x - a.prevX)).toBeLessThan(TILE_PX);
      expect(Math.abs(a.y - a.prevY)).toBeLessThan(TILE_PX);
    }
  });

  it('repairs a hot-swapped run whose animals predate the field', () => {
    // An HMR reload carries the live world across, so animals spawned before
    // interpolation existed arrive without the new fields. Reading NaN into a
    // lerp would put every creature at the top-left corner of the map.
    const state = newState();
    for (const a of state.world.animals) {
      delete (a as Partial<typeof a>).prevX;
      delete (a as Partial<typeof a>).prevY;
    }

    const adopted = adoptHotState(state);
    for (const a of adopted.world.animals) {
      expect(typeof a.prevX).toBe('number');
      expect(typeof a.prevY).toBe('number');
    }
    expect(adopted.player.prevX).toBe(adopted.player.x);
  });
});
