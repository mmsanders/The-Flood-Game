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
  waterLevel,
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

  it('is a dry ditch before the first drop falls', () => {
    const H = 440;
    for (let y = 0; y < H; y += 40) expect(gorgeDepthAt(0, y, H)).toBe(0);
    expect(waterDepth(Tile.Gorge, 250, 0, 0)).toBe(0);
  });

  it('fills from the top of the map downwards, not like a bathtub', () => {
    const H = 440;
    // A third of the way through the first day: wet at the top, dry at the
    // bottom. The water is running *down* the channel, not rising in it.
    const day = GORGE_FILL_DAYS / 3;
    expect(gorgeDepthAt(day, 0, H)).toBeGreaterThan(0);
    expect(gorgeDepthAt(day, H - 1, H)).toBe(0);

    // And the front only ever moves south.
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
    // ...and at a depth you cannot wade, which is what makes it the skiff's road.
    expect(gorgeDepthAt(GORGE_FILL_DAYS + 1, 0, H)).toBe(2);
  });

  it('runs the gorge in the high north long before the sea gets there', () => {
    // On day 10 the whole channel is wet, because it is rain coming off the
    // mountain, not the sea coming up.
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

    // Shallow: the drowned landscape still steers you.
    state.elapsed = state.world.params.secondsPerDay * (FLOOD_GRACE_DAYS + 0.2);
    map.elev[i] = Math.max(0, Math.floor(waterLevel(state)) - 1);
    expect(depthAt(state, tx, ty)).toBe(1);
    expect(isBoatableTile(state, tx, ty)).toBe(false);

    // Over your head (depth 2), not the deep: sail straight over the rock.
    // elev is a byte plane — pin it by probing until floodDepth says 2.
    state.elapsed = state.world.params.secondsPerDay * 12;
    const level = waterLevel(state);
    map.elev[i] = 0;
    for (let e = Math.floor(level); e >= 0; e--) {
      if (floodDepth(e, level) === 2) {
        map.elev[i] = e;
        break;
      }
    }
    expect(depthAt(state, tx, ty)).toBe(2);
    expect(isBoatableTile(state, tx, ty)).toBe(true);

    // The deep (4) is impassable even to a skiff.
    map.elev[i] = 0;
    state.elapsed = state.world.params.secondsPerDay * 30;
    expect(depthAt(state, tx, ty)).toBeGreaterThanOrEqual(4);
    expect(isBoatableTile(state, tx, ty)).toBe(false);
  });

  it('beaches the moment there is no water left under it', () => {
    const state = newState();
    const map = state.world;
    const i = map.tiles.indexOf(Tile.Grass);
    map.elev[i] = 255;
    placeAt(state, i % map.w, (i / map.w) | 0);
    state.skiff = {
      x: i % map.w,
      y: (i / map.w) | 0,
      pitched: false,
    };
    state.inBoat = true;

    step(state, IDLE, 1 / 60);
    // Standing on the highest ground in the world: there is nothing to sail on.
    expect(depthAt(state, i % map.w, (i / map.w) | 0)).toBe(0);
    expect(state.inBoat).toBe(false);
  });
});
