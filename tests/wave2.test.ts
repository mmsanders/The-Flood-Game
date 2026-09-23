import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import { AnimalKind, AnimalStatus } from '../src/core/animals.js';
import { BASE_BOAT_DEPTH, PITCHED_BOAT_DEPTH, boatDestroyedAtDepth } from '../src/core/boat.js';
import { FLOOD_RISE_PER_DAY } from '../src/core/flood.js';
import { marketAmount } from '../src/core/items.js';
import { Biome, Resource, Tile } from '../src/core/tiles.js';
import { PoiKind } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  Dir,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  createGame,
  depthAt,
  isBoatableTile,
  snapCamera,
  step,
  waterLevel,
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

function run(state: GameState, seconds: number, input = IDLE): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) step(state, input, dt);
}

describe('wave 2: the depth ladder', () => {
  it('lets galoshes cross depth one and keeps the wearer from drowning there', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 4);
    placeAt(state, spawn.x, spawn.y);
    state.elapsed = state.world.params.secondsPerDay * 3;

    const i = spawn.y * state.world.w + spawn.x + 1;
    state.world.tiles[i] = Tile.Grass;
    state.world.elev[i] = Math.max(0, Math.floor(waterLevel(state)) - 1);
    expect(depthAt(state, spawn.x + 1, spawn.y)).toBe(1);

    run(state, 0.75, { moveX: 1, moveY: 0, attackPressed: false });
    expect(Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX)).toBe(spawn.x);

    placeAt(state, spawn.x, spawn.y);
    state.hasGaloshes = true;
    run(state, 0.75, { moveX: 1, moveY: 0, attackPressed: false });
    expect(Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX)).toBeGreaterThan(spawn.x);

    placeAt(state, spawn.x + 1, spawn.y);
    const hearts = state.player.hearts;
    run(state, 2.5);
    expect(state.player.hearts).toBe(hearts);
  });

  it('caps an ordinary skiff at depth two, a pitched skiff at three, and both at four', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    state.elapsed = state.world.params.secondsPerDay * 20;
    const i = spawn.y * state.world.w + spawn.x + 1;
    const level = waterLevel(state);
    state.world.tiles[i] = Tile.Grass;
    state.world.elev[i] = Math.max(0, Math.floor(level - 3.5 * FLOOD_RISE_PER_DAY));
    expect(depthAt(state, spawn.x + 1, spawn.y)).toBe(3);

    state.boatDepth = BASE_BOAT_DEPTH;
    expect(isBoatableTile(state, spawn.x + 1, spawn.y)).toBe(false);
    state.boatDepth = PITCHED_BOAT_DEPTH;
    expect(isBoatableTile(state, spawn.x + 1, spawn.y)).toBe(true);

    state.world.elev[i] = Math.max(0, Math.floor(level - 6.5 * FLOOD_RISE_PER_DAY));
    expect(depthAt(state, spawn.x + 1, spawn.y)).toBe(4);
    expect(isBoatableTile(state, spawn.x + 1, spawn.y)).toBe(false);
  });
});

describe('wave 2: the physical skiff', () => {
  it('can be set down, stays in the world, and picked back up', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.hasBoat = true;
    state.haulingBoat = true;

    step(state, INTERACT, 1 / 60);
    expect(state.haulingBoat).toBe(false);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x]).toBe(Tile.Skiff);

    step(state, INTERACT, 1 / 60);
    expect(state.haulingBoat).toBe(true);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x]).toBe(Tile.Grass);
  });

  it('halves overland speed while portaging', () => {
    const plain = createGame(generateWorld(4242, SMALL));
    const hauled = createGame(generateWorld(4242, SMALL));
    for (const state of [plain, hauled]) {
      const { spawn } = state.world;
      clearArea(state, spawn.x, spawn.y, 6);
      placeAt(state, spawn.x, spawn.y);
    }
    hauled.hasBoat = true;
    hauled.haulingBoat = true;

    const px = plain.player.x;
    const hx = hauled.player.x;
    run(plain, 0.4, { moveX: 1, moveY: 0, attackPressed: false });
    run(hauled, 0.4, { moveX: 1, moveY: 0, attackPressed: false });
    const normalDistance = plain.player.x - px;
    const haulDistance = hauled.player.x - hx;
    expect(haulDistance).toBeCloseTo(normalDistance * 0.5, 0);
  });

  it('is lost when water deeper than the hull closes around a set-down skiff', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.hasBoat = true;
    state.haulingBoat = true;
    state.boatDepth = BASE_BOAT_DEPTH;

    step(state, INTERACT, 1 / 60);
    expect(state.world.tiles[spawn.y * state.world.w + spawn.x]).toBe(Tile.Skiff);
    expect(state.boatX).toBe(spawn.x);

    state.elapsed = state.world.params.secondsPerDay * 20;
    const i = spawn.y * state.world.w + spawn.x;
    const level = waterLevel(state);
    state.world.elev[i] = Math.max(0, Math.floor(level - 3.5 * FLOOD_RISE_PER_DAY));
    expect(depthAt(state, spawn.x, spawn.y)).toBe(3);
    expect(boatDestroyedAtDepth(state.boatDepth, 3)).toBe(true);

    placeAt(state, spawn.x + 1, spawn.y);
    step(state, IDLE, 1 / 60);

    expect(state.hasBoat).toBe(false);
    expect(state.boatX).toBe(-1);
    expect(state.world.tiles[i]).not.toBe(Tile.Skiff);
    expect(state.message).toMatch(/deep took the skiff/i);
  });

  it('recaulks the carried hull at a high dock for depth three', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.BoatYard;
    state.world.biome[i] = Biome.Scrub;
    state.hasBoat = true;
    state.haulingBoat = true;
    state.boatDepth = BASE_BOAT_DEPTH;
    state.carried[Resource.Pitch] = 20;
    state.carried[Resource.Fiber] = 20;

    step(state, INTERACT, 1 / 60);
    expect(state.boatDepth).toBe(PITCHED_BOAT_DEPTH);
    expect(state.message).toMatch(/depth three/i);
  });
});

describe('wave 2: barter and breakable tools', () => {
  it('barters at the marked valley market instead of spending money', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.TownDoor;
    state.world.biome[i] = Biome.Valley;
    state.carried.fill(100);

    expect(actionPrompt(state)?.label).toMatch(/Dove/i);
    step(state, INTERACT, 1 / 60);
    expect(state.hasDove).toBe(true);
    expect(state.carried[Resource.Fiber]).toBeLessThan(100);
  });

  it('raises material barter prices after their source biome starts drowning', () => {
    expect(marketAmount(Resource.Wood, 6, 0)).toBe(6);
    expect(marketAmount(Resource.Wood, 6, 20)).toBeGreaterThan(6);
  });

  it('uses one axe durability on a normal wood node and three on an ordinary tree', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.hasAxe = true;
    state.axeDurability = 14;
    state.player.dir = Dir.Right;
    const i = spawn.y * state.world.w + spawn.x + 1;

    state.world.tiles[i] = Tile.GopherTree;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Wood]).toBe(1);
    expect(state.axeDurability).toBe(13);

    state.player.cooldown = 0;
    state.world.tiles[i] = Tile.Tree;
    step(state, { moveX: 0, moveY: 0, attackPressed: true }, 1 / 60);
    expect(state.carried[Resource.Wood]).toBe(2);
    expect(state.axeDurability).toBe(10);
  });
});

describe('wave 2: information and earned hearts', () => {
  it('names a drowned resource and its depth once the sounding line is owned', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.elapsed = state.world.params.secondsPerDay * 20;
    state.inBoat = true;
    state.hasBoat = true;
    state.hasSoundingLine = true;
    state.player.dir = Dir.Right;
    const i = spawn.y * state.world.w + spawn.x + 1;
    state.world.tiles[i] = Tile.GopherTree;
    state.world.elev[i] = Math.max(0, Math.floor(waterLevel(state) - 1.5 * FLOOD_RISE_PER_DAY));

    const prompt = actionPrompt(state);
    expect(prompt?.label).toMatch(/Sounding line/i);
    expect(prompt?.label).toMatch(/Gopher Wood/i);
    expect(prompt?.label).toMatch(/depth 2/i);
  });

  it('removes generated loose hearts from the overworld at run start', () => {
    const world = generateWorld(4242, SMALL);
    createGame(world);
    expect(world.pois.some((poi) => poi.kind === PoiKind.Heart)).toBe(false);
    expect(Array.from(world.tiles).includes(Tile.HeartContainer)).toBe(false);
  });

  it('lets the mountain hermit trade a rescued sheep for a heart', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.TownDoor;
    state.world.biome[i] = Biome.Mountain;
    const sheep = state.world.animals.find((animal) => animal.kind === AnimalKind.Sheep);
    expect(sheep).toBeDefined();
    if (!sheep) return;
    sheep.status = AnimalStatus.Boarded;
    const before = state.world.animals.length;

    step(state, INTERACT, 1 / 60);
    expect(state.hermitHeartClaimed).toBe(true);
    expect(state.player.maxHearts).toBe(4);
    expect(state.world.animals.length).toBe(before - 1);
  });
});
