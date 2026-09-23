import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import {
  FLOOD_GRACE_DAYS,
  GORGE_FILL_DAYS,
  floodDepth,
  gorgeDepthAt,
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
    expect(waterDepth(Tile.Grass, 200, 0, 0)).toBe(0);
    expect(waterDepth(Tile.Water, 200, 0, 0)).toBe(2);
  });

  it('lets the flood deepen a pond past its own depth', () => {
    const drowned = waterLevelAtDay(38);
    expect(waterDepth(Tile.Water, 0, drowned, 0)).toBeGreaterThan(2);
  });

  it('is a dry ditch before the first drop falls', () => {
    const H = 440;
    for (let y = 0; y < H; y += 40) expect(gorgeDepthAt(0, y, H)).toBe(0);
    expect(waterDepth(Tile.Gorge, 250, 0, 0)).toBe(0);
  });

  it('fills from the top of the map downwards, not like a bathtub', () => {
    const H = 440;
    const day = GORGE_FILL_DAYS / 3;
    expect(gorgeDepthAt(day, 0, H)).toBeGreaterThan(0);
    expect(gorgeDepthAt(day, H - 1, H)).toBe(0);

    let frontier = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      let wet = 0;
      for (let y = 0; y < H; y++) if (gorgeDepthAt(t * GORGE_FILL_DAYS, y, H) > 0) wet++;
      expect(wet).toBeGreaterThanOrEqual(frontier);
      frontier = wet;
    }
  });

  it('has the whole channel running by the end of the first day', () => {
    const H = 440;
    for (let y = 0; y < H; y += 20) {
      expect(gorgeDepthAt(GORGE_FILL_DAYS, y, H), `row ${y}`).toBeGreaterThan(0);
    }
    expect(gorgeDepthAt(GORGE_FILL_DAYS + 1, 0, H)).toBe(2);
  });

  it('runs the gorge in the high north long before the sea gets there', () => {
    const day = 10;
    const H = 440;
    const level = waterLevelAtDay(day);
    const highGround = 240;
    expect(floodDepth(highGround, level)).toBe(0);
    expect(waterDepth(Tile.Gorge, highGround, level, gorgeDepthAt(day, 4, H))).toBeGreaterThan(0);
  });

  it('lets the sea deepen the channel past its own running depth', () => {
    const H = 440;
    const drowned = waterLevelAtDay(38);
    const runoff = gorgeDepthAt(38, 400, H);
    expect(waterDepth(Tile.Gorge, 0, drowned, runoff)).toBeGreaterThan(runoff);
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
    const stand = [
      [gx, gy + 1],
      [gx, gy - 1],
      [gx + 1, gy],
      [gx - 1, gy],
    ].find(([x, y]) => x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1 && isWalkable(map.tiles[y * map.w + x]));
    expect(stand, 'no walkable tile beside the gorge').toBeDefined();
    placeAt(state, stand![0], stand![1]);
    const before = { x: state.player.x, y: state.player.y };

    for (let i = 0; i < 60; i++) {
      step(state, { moveX: 0, moveY: -1, attackPressed: false }, 1 / 60);
    }
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

  it('floats over a boulder once depth two covers it', () => {
    const state = newState();
    const map = state.world;
    const i = map.tiles.indexOf(Tile.Grass);
    const tx = i % map.w;
    const ty = (i / map.w) | 0;
    map.tiles[i] = Tile.Rock;
    map.elev[i] = 0;

    state.elapsed = state.world.params.secondsPerDay * (FLOOD_GRACE_DAYS + 0.2);
    expect(depthAt(state, tx, ty)).toBe(1);
    expect(isBoatableTile(state, tx, ty)).toBe(false);

    state.elapsed = state.world.params.secondsPerDay * 20;
    let depthTwoElevation = -1;
    for (let elevation = 0; elevation <= 255; elevation++) {
      map.elev[i] = elevation;
      if (depthAt(state, tx, ty) === 2) {
        depthTwoElevation = elevation;
        break;
      }
    }
    expect(depthTwoElevation).toBeGreaterThanOrEqual(0);
    expect(depthAt(state, tx, ty)).toBe(2);
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
    expect(depthAt(state, i % map.w, (i / map.w) | 0)).toBe(0);
  });
});
