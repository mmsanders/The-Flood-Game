import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import {
  FLOOD_GRACE_DAYS,
  floodDepth,
  gorgeDepthAtDay,
  waterDepth,
  waterLevelAtDay,
} from '../src/core/flood.js';
import { Tile, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  type GameState,
  PLAYER_H,
  PLAYER_W,
  createGame,
  depthAt,
  isBoatableTile,
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

describe('the depth model', () => {
  it('treats natural water as over your head, whatever the sea is doing', () => {
    // Dry land at the same elevation is dry; the pond is not.
    expect(waterDepth(Tile.Grass, 200, 0, 0)).toBe(0);
    expect(waterDepth(Tile.Water, 200, 0, 0)).toBe(2);
  });

  it('lets the flood deepen a pond past its own depth', () => {
    const drowned = waterLevelAtDay(38);
    expect(waterDepth(Tile.Water, 0, drowned, 0)).toBeGreaterThan(2);
  });

  it('keeps the gorge dry until the rain starts, then runs it', () => {
    expect(gorgeDepthAtDay(0)).toBe(0);
    expect(gorgeDepthAtDay(FLOOD_GRACE_DAYS)).toBe(0);
    expect(gorgeDepthAtDay(FLOOD_GRACE_DAYS + 0.5)).toBe(1);
    expect(waterDepth(Tile.Gorge, 250, 0, 0)).toBe(0);
    expect(waterDepth(Tile.Gorge, 250, 0, 1)).toBe(1);
  });

  it('runs the gorge in the high north long before the sea gets there', () => {
    // The complaint this fixes: on day 10 the whole channel should be wet,
    // because it is rain coming off the mountain, not the sea coming up.
    const day = 10;
    const level = waterLevelAtDay(day);
    const runoff = gorgeDepthAtDay(day);
    const highGround = 240;
    expect(floodDepth(highGround, level)).toBe(0);
    expect(waterDepth(Tile.Gorge, highGround, level, runoff)).toBeGreaterThan(0);
  });

  it('deepens the gorge as the rain goes on, and never past the deep', () => {
    let last = 0;
    for (let day = 0; day <= 40; day++) {
      const d = gorgeDepthAtDay(day);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeLessThanOrEqual(4);
      last = d;
    }
    expect(gorgeDepthAtDay(40)).toBe(4);
  });
});

describe('the gorge on the map', () => {
  it('is cut into every world, and cannot be walked into', () => {
    for (const seed of [1, 2, 3, 7, 4242]) {
      const world = generateWorld(seed, SMALL);
      const gorge = [...world.tiles].filter((t) => t === Tile.Gorge).length;
      expect(gorge, `seed ${seed} has no gorge`).toBeGreaterThan(20);
      expect(isWalkable(Tile.Gorge)).toBe(false);
    }
  });

  it('carries its crossings, so the channel never divides the world', () => {
    for (const seed of [1, 2, 3, 7, 4242]) {
      const world = generateWorld(seed, SMALL);
      const bridges = [...world.tiles].filter((t) => t === Tile.Bridge).length;
      expect(bridges, `seed ${seed} has no fords`).toBeGreaterThan(0);
      expect(world.stats.connected, `seed ${seed}`).toBe(true);
    }
  });

  it('refuses to let the player walk in, wet or dry', () => {
    const state = newState();
    const map = state.world;
    const gorge = map.tiles.indexOf(Tile.Gorge);
    expect(gorge).toBeGreaterThanOrEqual(0);

    const gx = gorge % map.w;
    const gy = (gorge / map.w) | 0;
    placeAt(state, gx, gy + 1);
    const before = { x: state.player.x, y: state.player.y };

    // Walk north into it for a second of game time.
    for (let i = 0; i < 60; i++) {
      step(state, { moveX: 0, moveY: -1, attackPressed: false }, 1 / 60);
    }
    // It may not have been directly north, but the player must never be
    // standing on a gorge tile.
    const onX = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    const onY = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
    expect(map.tiles[onY * map.w + onX]).not.toBe(Tile.Gorge);
    expect(Number.isFinite(before.x)).toBe(true);
  });
});

describe('the skiff and the drowned landscape', () => {
  it('will not float on dry ground', () => {
    const state = newState();
    const map = state.world;
    // Day 0: nothing is wet except natural water and the sea.
    let dryLand = -1;
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] === Tile.Grass && map.elev[i] > 200) {
        dryLand = i;
        break;
      }
    }
    if (dryLand < 0) return;
    expect(isBoatableTile(state, dryLand % map.w, (dryLand / map.w) | 0)).toBe(false);
  });

  it('floats over a boulder once the water is over it', () => {
    const state = newState();
    const map = state.world;
    const i = map.tiles.indexOf(Tile.Grass);
    const tx = i % map.w;
    const ty = (i / map.w) | 0;
    map.tiles[i] = Tile.Rock;
    map.elev[i] = 0;

    // Shallow: the drowned landscape still steers you.
    state.elapsed = state.world.params.secondsPerDay * (FLOOD_GRACE_DAYS + 0.2);
    expect(depthAt(state, tx, ty)).toBe(1);
    expect(isBoatableTile(state, tx, ty)).toBe(false);

    // Deep: you sail straight over it.
    state.elapsed = state.world.params.secondsPerDay * 20;
    expect(depthAt(state, tx, ty)).toBeGreaterThanOrEqual(2);
    expect(isBoatableTile(state, tx, ty)).toBe(true);
  });

  it('beaches the moment there is no water left under it', () => {
    const state = newState();
    const map = state.world;
    const i = map.tiles.indexOf(Tile.Grass);
    map.elev[i] = 255;
    state.hasBoat = true;
    state.inBoat = true;
    placeAt(state, i % map.w, (i / map.w) | 0);

    step(state, IDLE, 1 / 60);
    // Standing on the highest ground in the world: there is nothing to sail on.
    expect(depthAt(state, i % map.w, (i / map.w) | 0)).toBe(0);
  });
});
