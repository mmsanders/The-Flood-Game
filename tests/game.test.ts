import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W, TILE_PX, withParams } from '../src/core/config.js';
import { FLOOD_DAYS } from '../src/core/config.js';
import { ARK_RECIPE } from '../src/core/resources.js';
import { RESOURCE_COUNT, Resource, Tile } from '../src/core/tiles.js';
import type { World } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  Dir,
  type GameState,
  PLAYER_H,
  PLAYER_W,
  arkProgress,
  createGame,
  currentDay,
  step,
} from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });

const IDLE = { moveX: 0, moveY: 0, attackPressed: false };

/** Advance the simulation by `seconds` at a fixed 60Hz. */
function run(state: GameState, seconds: number, input = IDLE): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) step(state, input, dt);
}

/** Put the player's centre exactly on a tile. */
function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
}

function setTile(world: World, tx: number, ty: number, tile: Tile): void {
  world.tiles[ty * world.w + tx] = tile;
}

/** Clear a patch so movement tests aren't fighting whatever generated there. */
function clearArea(world: World, tx: number, ty: number, radius: number): void {
  for (let y = ty - radius; y <= ty + radius; y++) {
    for (let x = tx - radius; x <= tx + radius; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      world.tiles[y * world.w + x] = Tile.Grass;
      // Well above any water line these tests will reach.
      world.elev[y * world.w + x] = 250;
    }
  }
}

let state: GameState;

beforeEach(() => {
  state = createGame(generateWorld(4242, SMALL));
});

describe('game: setup', () => {
  it('starts the player at spawn with three hearts and nothing carried', () => {
    expect(state.player.hearts).toBe(3);
    expect(state.player.maxHearts).toBe(3);
    expect(state.carried).toEqual([0, 0, 0, 0]);
    expect(state.delivered).toEqual([0, 0, 0, 0]);
    expect(state.phase).toBe('playing');

    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
    expect(tx).toBe(state.world.spawn.x);
    expect(ty).toBe(state.world.spawn.y);
  });

  it('opens the camera on the panel containing spawn', () => {
    expect(state.camera.panelX).toBe(Math.floor(state.world.spawn.x / PANEL_W));
    expect(state.camera.panelY).toBe(Math.floor(state.world.spawn.y / PANEL_H));
  });
});

describe('game: movement', () => {
  beforeEach(() => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 6);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
  });

  it('walks in the direction pressed', () => {
    const startX = state.player.x;
    run(state, 0.5, { moveX: 1, moveY: 0, attackPressed: false });
    expect(state.player.x).toBeGreaterThan(startX);
    expect(state.player.dir).toBe(Dir.Right);
  });

  it('does not move diagonally faster than straight', () => {
    const straight = createGame(generateWorld(4242, SMALL));
    clearArea(straight.world, straight.world.spawn.x, straight.world.spawn.y, 8);
    placeAt(straight, straight.world.spawn.x, straight.world.spawn.y);
    const start = { x: straight.player.x, y: straight.player.y };
    run(straight, 0.5, { moveX: 1, moveY: 0, attackPressed: false });
    const straightDist = Math.hypot(straight.player.x - start.x, straight.player.y - start.y);

    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 8);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
    const dStart = { x: state.player.x, y: state.player.y };
    run(state, 0.5, { moveX: 1, moveY: 1, attackPressed: false });
    const diagDist = Math.hypot(state.player.x - dStart.x, state.player.y - dStart.y);

    expect(diagDist).toBeLessThanOrEqual(straightDist + 0.5);
  });

  it('is stopped by blocking scenery', () => {
    const { spawn } = state.world;
    for (let dy = -3; dy <= 3; dy++) setTile(state.world, spawn.x + 2, spawn.y + dy, Tile.Tree);

    run(state, 2, { moveX: 1, moveY: 0, attackPressed: false });

    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    expect(tx).toBeLessThan(spawn.x + 2);
  });

  it('cannot walk off the edge of the world', () => {
    clearArea(state.world, 1, state.world.spawn.y, 6);
    placeAt(state, 1, state.world.spawn.y);
    run(state, 3, { moveX: -1, moveY: 0, attackPressed: false });
    expect(state.player.x).toBeGreaterThanOrEqual(0);
  });

  it('scrolls the camera when crossing a panel edge', () => {
    const edgeX = (state.camera.panelX + 1) * PANEL_W;
    clearArea(state.world, edgeX, state.world.spawn.y, 4);
    placeAt(state, edgeX - 1, state.world.spawn.y);
    const before = state.camera.panelX;

    run(state, 1.2, { moveX: 1, moveY: 0, attackPressed: false });

    expect(state.camera.panelX).toBe(before + 1);
    expect(state.camera.fromX).toBe(before);
  });
});

describe('game: the Rod of Aaron', () => {
  beforeEach(() => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 5);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
  });

  it('harvests the resource node it is swung at', () => {
    const { spawn } = state.world;
    setTile(state.world, spawn.x + 1, spawn.y, Tile.GopherTree);
    state.player.dir = Dir.Right;

    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(1);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x + 1]).not.toBe(Tile.GopherTree);
  });

  it('harvests nothing when swung at empty ground', () => {
    state.player.dir = Dir.Right;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried).toEqual([0, 0, 0, 0]);
  });

  it('respects its cooldown rather than harvesting every frame', () => {
    const { spawn } = state.world;
    for (let i = 1; i <= 3; i++) setTile(state.world, spawn.x + 1, spawn.y, Tile.Flax);
    state.player.dir = Dir.Right;

    // Two swings in consecutive frames: the second is on cooldown.
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    setTile(state.world, spawn.x + 1, spawn.y, Tile.Flax);
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Fiber]).toBe(1);
  });

  it('faces where it swings', () => {
    const { spawn } = state.world;
    setTile(state.world, spawn.x, spawn.y - 1, Tile.StoneNode);
    state.player.dir = Dir.Up;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Stone]).toBe(1);
  });
});

describe('game: pickups and the ark', () => {
  beforeEach(() => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 5);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
  });

  it('enlarges the heart container on pickup', () => {
    setTile(state.world, state.world.spawn.x, state.world.spawn.y, Tile.HeartContainer);
    step(state, IDLE, 1 / 60);
    expect(state.player.maxHearts).toBe(4);
    expect(state.player.hearts).toBe(4);
    expect(state.heartsFound).toBe(1);
  });

  it('delivers carried resources when standing on the ark site', () => {
    setTile(state.world, state.world.spawn.x, state.world.spawn.y, Tile.ArkSite);
    state.carried[Resource.Wood] = 12;

    step(state, IDLE, 1 / 60);

    expect(state.delivered[Resource.Wood]).toBe(12);
    expect(state.carried[Resource.Wood]).toBe(0);
    expect(arkProgress(state)).toBeGreaterThan(0);
  });

  it('never delivers more than the recipe requires', () => {
    setTile(state.world, state.world.spawn.x, state.world.spawn.y, Tile.ArkSite);
    state.carried[Resource.Pitch] = 999;

    step(state, IDLE, 1 / 60);

    expect(state.delivered[Resource.Pitch]).toBe(ARK_RECIPE[Resource.Pitch]);
    expect(state.carried[Resource.Pitch]).toBe(999 - ARK_RECIPE[Resource.Pitch]);
  });

  it('wins the run once the whole recipe is delivered', () => {
    setTile(state.world, state.world.spawn.x, state.world.spawn.y, Tile.ArkSite);
    for (let r = 0; r < RESOURCE_COUNT; r++) state.carried[r] = ARK_RECIPE[r as Resource];

    step(state, IDLE, 1 / 60);

    expect(state.phase).toBe('won');
    expect(arkProgress(state)).toBe(1);
  });

  it('stops simulating once the run has ended', () => {
    state.phase = 'won';
    const elapsed = state.elapsed;
    run(state, 2);
    expect(state.elapsed).toBe(elapsed);
  });
});

describe('game: drowning', () => {
  it('takes damage while submerged and eventually ends the run', () => {
    // Drop the player onto ground that is already deep under by mid-flood.
    const { world } = state;
    const x = world.spawn.x;
    const y = world.spawn.y;
    clearArea(world, x, y, 3);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        world.elev[(y + dy) * world.w + (x + dx)] = 0;
      }
    }
    placeAt(state, x, y);
    // Jump the clock past the grace period so the water is over this ground.
    state.elapsed = world.params.secondsPerDay * 20;

    run(state, 3);
    expect(state.player.hearts).toBeLessThan(3);

    run(state, 30);
    expect(state.phase).toBe('drowned');
  });

  it('leaves the player unharmed on dry ground', () => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 3);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
    run(state, 5);
    expect(state.player.hearts).toBe(3);
    expect(state.phase).toBe('playing');
  });
});

describe('game: the clock', () => {
  it('advances days at the configured rate', () => {
    run(state, state.world.params.secondsPerDay);
    expect(currentDay(state)).toBeCloseTo(1, 1);
  });

  it('runs forty days over the configured run length', () => {
    expect(FLOOD_DAYS * state.world.params.secondsPerDay).toBe(3600);
  });
});
