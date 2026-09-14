import { describe, expect, it } from 'vitest';
import {
  ANIMAL_COUNT,
  ANIMALS_PER_KIND,
  FLOCK_TOTAL,
  AnimalKind,
  AnimalStatus,
  flockScoreOf,
  spawnAnimals,
} from '../src/core/animals.js';
import { TILE_PX, withParams } from '../src/core/config.js';
import { Tile } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  PLAYER_H,
  PLAYER_W,
  createGame,
  flockScore,
  snapCamera,
  step,
  type GameState,
} from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });

const IDLE = { moveX: 0, moveY: 0, attackPressed: false };

function placeAt(state: GameState, tx: number, ty: number): void {
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  snapCamera(state);
}

function run(state: GameState, seconds: number, input = IDLE): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) step(state, input, dt);
}

describe('animals: worldgen', () => {
  it('places two of each kind, twenty in all', () => {
    const world = generateWorld(4242, SMALL);
    expect(world.animals).toHaveLength(FLOCK_TOTAL);
    const counts = new Array<number>(ANIMAL_COUNT).fill(0);
    for (const a of world.animals) counts[a.kind]++;
    for (let k = 0; k < ANIMAL_COUNT; k++) {
      expect(counts[k], `kind ${k}`).toBe(ANIMALS_PER_KIND);
    }
  });

  it('is deterministic for a seed', () => {
    const a = generateWorld(99, SMALL).animals.map((n) => [n.kind, n.x, n.y]);
    const b = generateWorld(99, SMALL).animals.map((n) => [n.kind, n.x, n.y]);
    expect(a).toEqual(b);
  });

  it('keeps every creature on walkable ground at spawn', () => {
    const world = generateWorld(7, SMALL);
    for (const a of world.animals) {
      const tx = Math.floor((a.x + 5) / TILE_PX);
      const ty = Math.floor((a.y + 4) / TILE_PX);
      expect(world.tiles[ty * world.w + tx]).not.toBe(Tile.Water);
      expect(world.tiles[ty * world.w + tx]).not.toBe(Tile.Cliff);
    }
  });
});

describe('animals: gathering', () => {
  it('boards a creature the player walks into, without winning the run', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const sheep = state.world.animals.find((a) => a.kind === AnimalKind.Sheep);
    expect(sheep).toBeDefined();
    if (!sheep) return;

    const tx = Math.floor(sheep.x / TILE_PX);
    const ty = Math.floor(sheep.y / TILE_PX);
    placeAt(state, tx, ty);
    step(state, IDLE, 1 / 60);

    expect(sheep.status).toBe(AnimalStatus.Boarded);
    expect(flockScore(state).rescued).toBeGreaterThanOrEqual(1);
    expect(state.phase).toBe('playing');
  });

  it('counts a pair only after the second of a kind is boarded', () => {
    const tiles = new Uint8Array(16);
    tiles.fill(Tile.Grass);
    const biome = new Uint8Array(16);
    const animals = spawnAnimals(1, tiles, biome, 4, new Set(), { x: 0, y: 0 });
    animals[0].status = AnimalStatus.Boarded;
    expect(flockScoreOf(animals).pairs).toBe(0);
    const second = animals.find((a) => a.kind === animals[0].kind && a !== animals[0]);
    if (second) second.status = AnimalStatus.Boarded;
    expect(flockScoreOf(animals).pairs).toBe(1);
  });

  it('drowns a wild creature once the water covers its tile', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const victim = state.world.animals[0];
    const tx = Math.floor(victim.x / TILE_PX);
    const ty = Math.floor(victim.y / TILE_PX);
    state.world.elev[ty * state.world.w + tx] = 0;
    state.elapsed = state.world.params.secondsPerDay * 20;
    run(state, 0.1);
    expect(victim.status).toBe(AnimalStatus.Drowned);
  });
});
