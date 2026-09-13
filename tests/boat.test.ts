import { describe, expect, it } from 'vitest';
import { BOAT_COST_FIBER, BOAT_COST_WOOD } from '../src/core/boat.js';
import { TILE_PX, withParams } from '../src/core/config.js';
import { Resource, Tile } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  Dir,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  createGame,
  snapCamera,
  step,
  type GameState,
} from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const IDLE = { moveX: 0, moveY: 0, attackPressed: false };
const INTERACT = { moveX: 0, moveY: 0, attackPressed: false, interactPressed: true };

function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
}

function run(state: GameState, seconds: number, input = IDLE): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) step(state, input, dt);
}

function clearArea(state: GameState, tx: number, ty: number, radius: number): void {
  const { world } = state;
  for (let y = ty - radius; y <= ty + radius; y++) {
    for (let x = tx - radius; x <= tx + radius; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      world.tiles[y * world.w + x] = Tile.Grass;
      world.elev[y * world.w + x] = 250;
    }
  }
}

describe('boat: the slipway', () => {
  it('places a reachable slipway in the world', () => {
    const world = generateWorld(4242, SMALL);
    expect(world.tiles[world.boatYard.y * world.w + world.boatYard.x]).toBe(Tile.BoatYard);
  });

  it('names the price before you pay', () => {
    const state = createGame(generateWorld(4242, SMALL));
    placeAt(state, state.world.boatYard.x, state.world.boatYard.y);
    const prompt = actionPrompt(state);
    expect(prompt?.label).toContain(String(BOAT_COST_WOOD));
    expect(prompt?.label).toContain(String(BOAT_COST_FIBER));
    expect(prompt?.affordable).toBe(false);
  });

  it('frames a skiff from wood and fiber', () => {
    const state = createGame(generateWorld(4242, SMALL));
    placeAt(state, state.world.boatYard.x, state.world.boatYard.y);
    state.carried[Resource.Wood] = BOAT_COST_WOOD + 1;
    state.carried[Resource.Fiber] = BOAT_COST_FIBER + 2;

    step(state, INTERACT, 1 / 60);

    expect(state.hasBoat).toBe(true);
    expect(state.carried[Resource.Wood]).toBe(1);
    expect(state.carried[Resource.Fiber]).toBe(2);
    expect(state.message).toMatch(/skiff/i);
  });

  it('refuses when the stock is short', () => {
    const state = createGame(generateWorld(4242, SMALL));
    placeAt(state, state.world.boatYard.x, state.world.boatYard.y);
    state.carried[Resource.Wood] = 1;
    state.carried[Resource.Fiber] = 1;
    step(state, INTERACT, 1 / 60);
    expect(state.hasBoat).toBe(false);
    expect(state.carried[Resource.Wood]).toBe(1);
  });
});

describe('boat: sailing and dredging', () => {
  it('lets the player occupy floodwater once launched, and does not drown them', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 4);
    placeAt(state, spawn.x, spawn.y);
    state.hasBoat = true;

    const waterX = spawn.x + 1;
    state.world.tiles[spawn.y * state.world.w + waterX] = Tile.Water;
    state.player.dir = Dir.Right;
    step(state, INTERACT, 1 / 60);

    expect(state.inBoat).toBe(true);

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        state.world.elev[(spawn.y + dy) * state.world.w + (spawn.x + dx)] = 0;
      }
    }
    state.elapsed = state.world.params.secondsPerDay * 20;
    run(state, 5);
    expect(state.player.hearts).toBe(3);
    expect(state.phase).toBe('playing');
  });

  it('launches by walking into water from the shore', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 4);
    placeAt(state, spawn.x, spawn.y);
    state.hasBoat = true;
    state.world.tiles[spawn.y * state.world.w + spawn.x - 1] = Tile.Water;

    run(state, 0.6, { moveX: -1, moveY: 0, attackPressed: false });

    expect(state.inBoat).toBe(true);
    const tx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
    expect(tx).toBe(spawn.x - 1);
  });

  it('will not harvest a drowned node on foot', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.world.tiles[spawn.y * state.world.w + spawn.x + 1] = Tile.GopherTree;
    state.world.elev[spawn.y * state.world.w + spawn.x + 1] = 0;
    state.elapsed = state.world.params.secondsPerDay * 20;
    state.player.dir = Dir.Right;

    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(0);
    expect(state.message).toMatch(/boat/i);
  });

  it('dredges a drowned node from the deck of the skiff', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.hasBoat = true;
    state.inBoat = true;
    state.world.tiles[spawn.y * state.world.w + spawn.x + 1] = Tile.GopherTree;
    state.world.elev[spawn.y * state.world.w + spawn.x + 1] = 0;
    state.elapsed = state.world.params.secondsPerDay * 20;
    state.player.dir = Dir.Right;

    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);

    expect(state.carried[Resource.Wood]).toBe(1);
    expect(state.message).toMatch(/dredged/i);
  });
});
