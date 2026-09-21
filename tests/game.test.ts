import { beforeEach, describe, expect, it } from 'vitest';
import { PANEL_H, PANEL_W, TILE_PX, withParams } from '../src/core/config.js';
import { FLOOD_DAYS } from '../src/core/config.js';
import { ARK_RECIPE, SHRINE_COST } from '../src/core/resources.js';
import { Biome, RESOURCE_COUNT, Resource, Tile } from '../src/core/tiles.js';
import type { World } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  Dir,
  type GameState,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  activeMap,
  adoptHotState,
  arkProgress,
  createGame,
  currentDay,
  obstacleInFront,
  snapCamera,
  step,
} from '../src/game/state.js';
import { visitedCells } from '../src/game/minimap.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });

const IDLE = { moveX: 0, moveY: 0, attackPressed: false };
const INTERACT = { moveX: 0, moveY: 0, attackPressed: false, interactPressed: true };

/** Advance the simulation by `seconds` at a fixed 60Hz. */
function run(state: GameState, seconds: number, input = IDLE): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) step(state, input, dt);
}

/**
 * Put the player's centre exactly on a tile, and snap the camera the way any
 * real teleport does — a scroll left running would swallow the next frame.
 */
function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
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

  it('has only the spawn panel on the map', () => {
    const seen = visitedCells(state.exploredOverworld, state.world.params.panelsX);
    expect(seen).toEqual([{ x: state.camera.panelX, y: state.camera.panelY }]);
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
    const before = Math.min(state.camera.panelX, state.world.params.panelsX - 2);
    const edgeX = (before + 1) * PANEL_W;
    clearArea(state.world, edgeX, state.world.spawn.y, 4);
    placeAt(state, edgeX - 1, state.world.spawn.y);
    state.camera.panelX = before;
    state.camera.fromX = before;

    run(state, 1.2, { moveX: 1, moveY: 0, attackPressed: false });

    expect(state.camera.panelX).toBe(before + 1);
    expect(state.camera.fromX).toBe(before);

    const seen = visitedCells(state.exploredOverworld, state.world.params.panelsX);
    expect(seen).toEqual(
      expect.arrayContaining([
        { x: before, y: state.camera.panelY },
        { x: before + 1, y: state.camera.panelY },
      ]),
    );
    expect(seen).toHaveLength(2);
  });
});

describe('game: the Rod of Aaron', () => {
  beforeEach(() => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 5);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
  });

  it('harvests flax without an upgrade', () => {
    const { spawn } = state.world;
    setTile(state.world, spawn.x + 1, spawn.y, Tile.Flax);
    state.player.dir = Dir.Right;

    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Fiber]).toBe(1);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x + 1]).not.toBe(Tile.Flax);
  });

  it('will not take gopher wood until the Rod is imbued', () => {
    const { spawn } = state.world;
    setTile(state.world, spawn.x + 1, spawn.y, Tile.GopherTree);
    state.player.dir = Dir.Right;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Wood]).toBe(0);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x + 1]).toBe(Tile.GopherTree);
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
    state.rodTier = 2;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Stone]).toBe(1);
  });

  it('imbues the Rod at a shrine, then takes the next resource', () => {
    const { spawn } = state.world;
    state.world.tiles[spawn.y * state.world.w + spawn.x] = Tile.Shrine;
    state.world.biome[spawn.y * state.world.w + spawn.x] = Biome.Valley;
    state.carried[Resource.Fiber] = SHRINE_COST[Biome.Valley];
    placeAt(state, spawn.x, spawn.y);

    const prompt = actionPrompt(state);
    expect(prompt?.affordable).toBe(true);

    step(state, INTERACT, 1 / 60);
    expect(state.rodTier).toBe(1);
    expect(state.carried[Resource.Fiber]).toBe(0);

    setTile(state.world, spawn.x + 1, spawn.y, Tile.GopherTree);
    state.player.dir = Dir.Right;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Wood]).toBe(1);
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
    expect(state.world.tiles[state.world.spawn.y * state.world.w + state.world.spawn.x]).toBe(
      Tile.Pedestal,
    );

    run(state, 0.5, { moveX: 1, moveY: 0, attackPressed: false });
    expect(Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX)).toBeGreaterThan(
      state.world.spawn.x,
    );
  });

  it('can step off a pedestal that straddles a panel seam, but not back on', () => {
    const y = state.world.spawn.y;
    const x = PANEL_W;
    clearArea(state.world, x, y, 3);
    setTile(state.world, x, y, Tile.Pedestal);

    state.player.x = x * TILE_PX - 4;
    state.player.y = y * TILE_PX + (TILE_PX - PLAYER_H) / 2;
    const startX = state.player.x;
    run(state, 0.6, { moveX: -1, moveY: 0, attackPressed: false });
    expect(state.player.x).toBeLessThan(startX);

    placeAt(state, x - 1, y);
    const west = state.player.x;
    run(state, 0.6, { moveX: 1, moveY: 0, attackPressed: false });
    expect(Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX)).toBe(x - 1);
    expect(state.player.x).toBeLessThanOrEqual(west + TILE_PX);
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

  it('can walk out of floodwater onto higher ground', () => {
    const { world } = state;
    const x = world.spawn.x;
    const y = world.spawn.y;
    clearArea(world, x, y, 4);
    for (let dy = -2; dy <= 2; dy++) {
      world.elev[(y + dy) * world.w + x] = 0;
      world.elev[(y + dy) * world.w + x + 1] = 250;
    }
    placeAt(state, x, y);
    state.elapsed = world.params.secondsPerDay * 20;

    run(state, 1.2, { moveX: 1, moveY: 0, attackPressed: false });

    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    expect(tx).toBeGreaterThanOrEqual(x + 1);
    expect(world.elev[y * world.w + tx]).toBe(250);
  });

  it('cannot walk into floodwater from dry land', () => {
    const { world } = state;
    const x = world.spawn.x;
    const y = world.spawn.y;
    clearArea(world, x, y, 4);
    for (let dy = -2; dy <= 2; dy++) {
      world.elev[(y + dy) * world.w + x] = 250;
      world.elev[(y + dy) * world.w + x + 1] = 0;
    }
    placeAt(state, x, y);
    state.elapsed = world.params.secondsPerDay * 20;

    run(state, 1.2, { moveX: 1, moveY: 0, attackPressed: false });

    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    expect(tx).toBe(x);
  });
});

describe('game: the clock', () => {
  it('advances days at the configured rate', () => {
    run(state, state.world.params.secondsPerDay);
    expect(currentDay(state)).toBeCloseTo(1, 1);
  });

  it('runs forty days over the configured run length', () => {
    expect(FLOOD_DAYS * state.world.params.secondsPerDay).toBe(7200);
  });
});

// ---------------------------------------------------------------- dungeons

describe('game: entering and leaving dungeons', () => {
  function standOnEntrance(s: GameState, dungeonIndex = 0): void {
    const d = s.world.dungeons[dungeonIndex];
    placeAt(s, d.overworldEntrance.x, d.overworldEntrance.y);
  }

  it('descends from an entrance and lands just inside the stairs', () => {
    standOnEntrance(state);
    step(state, INTERACT, 1 / 60);

    expect(state.location.kind).toBe('dungeon');
    expect(state.location.dungeonId).toBe(0);
    expect(activeMap(state)).toBe(state.world.dungeons[0]);

    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
    const d = state.world.dungeons[0];
    expect(tx).toBe(d.stairs.x);
    expect(ty).toBe(d.stairs.y - 1);

    const seen = visitedCells(state.exploredDungeons[0], d.roomsX);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      x: Math.floor(d.stairs.x / PANEL_W),
      y: Math.floor(d.stairs.y / PANEL_H),
    });
  });

  it('surfaces south of the mouth, with the clock still running', () => {
    standOnEntrance(state);
    const entrance = { ...state.world.dungeons[0].overworldEntrance };
    step(state, INTERACT, 1 / 60);

    const before = state.elapsed;
    run(state, 3);
    const stairs = state.world.dungeons[0].stairs;
    placeAt(state, stairs.x, stairs.y);
    step(state, IDLE, 1 / 60);

    expect(state.location.kind).toBe('overworld');
    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
    expect(tx).toBe(entrance.x);
    expect(ty).toBeGreaterThan(entrance.y);
    // The flood does not pause for spelunking.
    expect(state.elapsed).toBeGreaterThan(before + 2.5);
  });

  it('refuses an entrance the water has already taken', () => {
    standOnEntrance(state);
    const d = state.world.dungeons[0];
    state.world.elev[d.overworldEntrance.y * state.world.w + d.overworldEntrance.x] = 0;
    state.elapsed = state.world.params.secondsPerDay * 30;

    step(state, INTERACT, 1 / 60);

    expect(state.location.kind).toBe('overworld');
  });

  it('never drowns the player underground', () => {
    standOnEntrance(state);
    step(state, INTERACT, 1 / 60);
    // Well past the point where the whole overworld is gone.
    state.elapsed = state.world.params.secondsPerDay * 39;
    run(state, 8);

    expect(state.player.hearts).toBe(3);
    expect(state.phase).toBe('playing');
  });

  it('does not carry keys between dungeons', () => {
    standOnEntrance(state);
    step(state, INTERACT, 1 / 60);
    state.keysHeld = 3;
    const stairs = state.world.dungeons[0].stairs;
    placeAt(state, stairs.x, stairs.y);
    step(state, IDLE, 1 / 60);
    expect(state.keysHeld).toBe(0);
  });

  it('blocks the mouth from the west, north and east, and lets you in from the south', () => {
    const d = state.world.dungeons[0];
    const { x, y } = d.overworldEntrance;
    clearArea(state.world, x, y, 3);
    state.world.tiles[y * state.world.w + x] = Tile.DungeonEntrance;

    placeAt(state, x - 1, y);
    run(state, 0.8, { moveX: 1, moveY: 0, attackPressed: false });
    expect(state.location.kind).toBe('overworld');
    expect(Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX)).toBeLessThan(x);

    placeAt(state, x, y - 1);
    run(state, 0.8, { moveX: 0, moveY: 1, attackPressed: false });
    expect(state.location.kind).toBe('overworld');
    expect(Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX)).toBeLessThan(y);

    placeAt(state, x, y + 1);
    run(state, 0.8, { moveX: 0, moveY: -1, attackPressed: false });
    expect(state.location.kind).toBe('dungeon');
  });

  it('will not let the player step onto a flooded dungeon mouth', () => {
    const d = state.world.dungeons[0];
    const { x, y } = d.overworldEntrance;
    clearArea(state.world, x, y, 3);
    state.world.tiles[y * state.world.w + x] = Tile.DungeonEntrance;
    state.world.elev[y * state.world.w + x] = 0;
    state.elapsed = state.world.params.secondsPerDay * 30;

    placeAt(state, x, y + 1);
    run(state, 0.8, { moveX: 0, moveY: -1, attackPressed: false });

    expect(state.location.kind).toBe('overworld');
    expect(Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX)).toBeGreaterThan(y);
  });
});

describe('game: the trade', () => {
  /** Put the player next to an obstacle tile, facing it. */
  function faceObstacle(s: GameState, tile: Tile): { x: number; y: number } {
    const d = s.world.dungeons[0];
    s.location = { kind: 'dungeon', interiorId: -1, dungeonId: 0, returnTo: { x: 1, y: 1 } };

    const spot = d.stairs;
    d.tiles[spot.y * d.w + spot.x] = Tile.DungeonFloor;
    d.tiles[spot.y * d.w + spot.x + 1] = tile;
    placeAt(s, spot.x, spot.y);
    s.player.dir = Dir.Right;
    return { x: spot.x + 1, y: spot.y };
  }

  it('names the price and your balance before you pay', () => {
    const at = faceObstacle(state, Tile.Chasm);
    state.carried[Resource.Wood] = 14;

    const prompt = obstacleInFront(state);
    expect(prompt?.label).toContain('2');
    expect(prompt?.label).toContain('14');
    expect(prompt?.affordable).toBe(true);
    expect(at).toBeTruthy();
  });

  it('bridges a chasm with gopher wood, debiting exactly the cost', () => {
    const at = faceObstacle(state, Tile.Chasm);
    state.carried[Resource.Wood] = 10;

    step(state, INTERACT, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(8);
    const d = state.world.dungeons[0];
    expect(d.tiles[at.y * d.w + at.x]).toBe(Tile.Bridge);
  });

  it('ropes a ledge with fiber', () => {
    const at = faceObstacle(state, Tile.Ledge);
    state.carried[Resource.Fiber] = 5;

    step(state, INTERACT, 1 / 60);

    expect(state.carried[Resource.Fiber]).toBe(3);
    const d = state.world.dungeons[0];
    expect(d.tiles[at.y * d.w + at.x]).toBe(Tile.Rope);
  });

  it('refuses when you cannot afford it, and debits nothing', () => {
    const at = faceObstacle(state, Tile.Chasm);
    state.carried[Resource.Wood] = 1;

    step(state, INTERACT, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(1);
    const d = state.world.dungeons[0];
    expect(d.tiles[at.y * d.w + at.x]).toBe(Tile.Chasm);
    expect(state.message).toMatch(/not enough/i);
  });

  it('never spends the scarce pitch', () => {
    faceObstacle(state, Tile.Chasm);
    state.carried[Resource.Wood] = 10;
    state.carried[Resource.Pitch] = 7;

    step(state, INTERACT, 1 / 60);

    expect(state.carried[Resource.Pitch]).toBe(7);
  });

  it('opens a locked door with a key, consuming it', () => {
    const at = faceObstacle(state, Tile.DoorLocked);
    state.keysHeld = 1;

    step(state, INTERACT, 1 / 60);

    expect(state.keysHeld).toBe(0);
    const d = state.world.dungeons[0];
    expect(d.tiles[at.y * d.w + at.x]).toBe(Tile.DoorOpen);
  });

  it('refuses a locked door without a key', () => {
    const at = faceObstacle(state, Tile.DoorLocked);
    state.keysHeld = 0;

    step(state, INTERACT, 1 / 60);

    const d = state.world.dungeons[0];
    expect(d.tiles[at.y * d.w + at.x]).toBe(Tile.DoorLocked);
    expect(state.message).toMatch(/locked/i);
  });

  it('charges once for a whole obstacle band, not once per tile', () => {
    const d = state.world.dungeons[0];
    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: 0, returnTo: { x: 1, y: 1 } };
    const spot = d.stairs;
    d.tiles[spot.y * d.w + spot.x] = Tile.DungeonFloor;
    // A four-tile band of chasm in front of the player.
    for (let n = 1; n <= 4; n++) d.tiles[spot.y * d.w + spot.x + n] = Tile.Chasm;
    placeAt(state, spot.x, spot.y);
    state.player.dir = Dir.Right;
    state.carried[Resource.Wood] = 10;

    step(state, INTERACT, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(8);
    for (let n = 1; n <= 4; n++) {
      expect(d.tiles[spot.y * d.w + spot.x + n]).toBe(Tile.Bridge);
    }
  });
});

describe('game: dungeon rewards and hazards', () => {
  function inDungeonAt(s: GameState, p: { x: number; y: number }): void {
    s.location = { kind: 'dungeon', interiorId: -1, dungeonId: 0, returnTo: { x: 1, y: 1 } };
    placeAt(s, p.x, p.y);
  }

  it('grants the dungeon reward once and only once', () => {
    const d = state.world.dungeons[0];
    inDungeonAt(state, d.chest);

    step(state, IDLE, 1 / 60);
    const afterFirst = {
      maxHearts: state.player.maxHearts,
      yield: state.harvestYield,
      reach: state.rodReach,
    };
    expect(state.dungeonsCleared[0]).toBe(true);

    // Put a second chest under the player: the dungeon is already cleared.
    d.tiles[d.chest.y * d.w + d.chest.x] = Tile.Chest;
    step(state, IDLE, 1 / 60);

    expect(state.player.maxHearts).toBe(afterFirst.maxHearts);
    expect(state.harvestYield).toBe(afterFirst.yield);
    expect(state.rodReach).toBe(afterFirst.reach);
  });

  it('picks up a key by walking over it', () => {
    const d = state.world.dungeons[0];
    inDungeonAt(state, d.key);
    step(state, IDLE, 1 / 60);
    expect(state.keysHeld).toBe(1);
  });

  it('costs a heart to fall in a pit, and puts you back on solid ground', () => {
    const d = state.world.dungeons[0];
    const safe = d.stairs;
    inDungeonAt(state, safe);
    d.tiles[safe.y * d.w + safe.x] = Tile.DungeonFloor;
    step(state, IDLE, 1 / 60); // remember this spot as safe

    const pit = { x: safe.x + 1, y: safe.y };
    d.tiles[pit.y * d.w + pit.x] = Tile.Pit;
    placeAt(state, pit.x, pit.y);
    step(state, IDLE, 1 / 60);

    expect(state.player.hearts).toBe(2);
    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    expect(tx).toBe(safe.x);
  });

  it('applies the Budding Rod to harvest yield', () => {
    const forest = state.world.dungeons.find((d) => d.biomeKind === Biome.Forest);
    expect(forest).toBeDefined();
    if (!forest) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: forest.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, forest.chest.x, forest.chest.y);
    step(state, IDLE, 1 / 60);

    expect(state.harvestYield).toBe(2);

    // Back above ground, one swing now yields two.
    state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 4);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
    setTile(state.world, state.world.spawn.x + 1, state.world.spawn.y, Tile.GopherTree);
    state.player.dir = Dir.Right;
    state.rodTier = 1;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(2);
  });

  it('applies the Serpent Rod to reach', () => {
    const mountain = state.world.dungeons.find((d) => d.biomeKind === Biome.Mountain);
    expect(mountain).toBeDefined();
    if (!mountain) return;

    state.location = { kind: 'dungeon', interiorId: -1, dungeonId: mountain.id, returnTo: { x: 1, y: 1 } };
    placeAt(state, mountain.chest.x, mountain.chest.y);
    step(state, IDLE, 1 / 60);

    expect(state.rodReach).toBe(2);

    state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 4);
    placeAt(state, state.world.spawn.x, state.world.spawn.y);
    state.player.dir = Dir.Right;

    // Adjacent harvest still works — extra reach must not skip the near tile.
    setTile(state.world, state.world.spawn.x + 1, state.world.spawn.y, Tile.Flax);
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Fiber]).toBe(1);
    expect(state.world.tiles[state.world.spawn.y * state.world.w + state.world.spawn.x + 1]).not.toBe(
      Tile.Flax,
    );

    // And the extra tile of reach actually lands two tiles out.
    state.player.cooldown = 0;
    setTile(state.world, state.world.spawn.x + 2, state.world.spawn.y, Tile.Flax);
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Fiber]).toBe(2);
    expect(state.world.tiles[state.world.spawn.y * state.world.w + state.world.spawn.x + 2]).not.toBe(
      Tile.Flax,
    );
  });
});

describe('game: hot adopt', () => {
  it('keeps the player, inventory, and clock across a rules reload', () => {
    clearArea(state.world, state.world.spawn.x, state.world.spawn.y, 4);
    placeAt(state, state.world.spawn.x + 2, state.world.spawn.y);
    state.carried[Resource.Wood] = 7;
    state.delivered[Resource.Fiber] = 3;
    state.elapsed = 12.5;
    state.harvestYield = 2;
    state.player.hearts = 2;
    state.player.dir = Dir.Left;

    const next = adoptHotState(state);

    expect(next.world).toBe(state.world);
    expect(next.player.x).toBe(state.player.x);
    expect(next.player.y).toBe(state.player.y);
    expect(next.player.dir).toBe(Dir.Left);
    expect(next.player.hearts).toBe(2);
    expect(next.carried[Resource.Wood]).toBe(7);
    expect(next.delivered[Resource.Fiber]).toBe(3);
    expect(next.elapsed).toBe(12.5);
    expect(next.harvestYield).toBe(2);
    expect(next.exploredOverworld).toBe(state.exploredOverworld);
  });

  it('fills fields added since the run started, and pads short resource arrays', () => {
    const running = {
      ...state,
      carried: [4],
      delivered: [1, 2],
    } as GameState;
    delete (running as { rodReach?: number }).rodReach;

    const next = adoptHotState(running);

    expect(next.rodReach).toBe(1);
    expect(next.carried).toEqual([4, 0, 0, 0]);
    expect(next.delivered).toEqual([1, 2, 0, 0]);
    expect(next.dungeonsCleared).toHaveLength(state.world.dungeons.length);
  });
});
