/**
 * Wave 7: signs of people. Homesteads and the animals kept at them, wild
 * things that keep away, townsfolk who talk and flee, and the farmer's sale.
 */

import { describe, expect, it } from 'vitest';
import {
  ANIMAL_COUNT,
  ANIMAL_DEFS,
  ANIMAL_H,
  ANIMAL_W,
  type Animal,
  AnimalStatus,
  FARM_KIND,
  WILD_SHY,
  stepAnimals,
} from '../src/core/animals.js';
import { TILE_PX } from '../src/core/config.js';
import { Biome, Resource, Tile, isWalkable } from '../src/core/tiles.js';
import { HomesteadState, PersonRole, PersonStatus, type World } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { ANIMAL_PRICE, forSale, personInReach } from '../src/game/people.js';
import { type GameState, actionPrompt, step } from '../src/game/state.js';
import { IDLE, PRESS_E, SMALL, STEP, newGame, placeAt } from './support/scenario.js';

const SEEDS = [1, 2, 3, 7, 4242];

function tileOf(a: Animal): { x: number; y: number } {
  return { x: Math.floor((a.x + ANIMAL_W / 2) / TILE_PX), y: Math.floor((a.y + ANIMAL_H / 2) / TILE_PX) };
}

describe('homesteads', () => {
  it('puts farms in every biome, the first in each lived in', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      for (const b of [Biome.Valley, Biome.Forest, Biome.Scrub, Biome.Mountain]) {
        const farms = world.homesteads.filter((f) => f.biome === b);
        expect(farms.length, `seed ${seed} biome ${b}`).toBeGreaterThan(0);
        expect(farms[0].state).toBe(HomesteadState.LivedIn);
      }
      expect(world.stats.connected, `seed ${seed}`).toBe(true);
    }
  });

  it('builds each from its story: house or ruin, a well, a fenced paddock', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      for (const f of world.homesteads) {
        const house = world.tiles[f.y * world.w + f.x];
        expect(house).toBe(f.state === HomesteadState.Abandoned ? Tile.Ruin : Tile.House);
        // The well, unless the connectivity repair had to cut a path through it.
        const well = world.tiles[f.y * world.w + f.x - 1];
        expect(well === Tile.Well || isWalkable(well), `${f.name} seed ${seed}`).toBe(true);
        let fence = 0;
        let fallen = 0;
        const { x0, y0, x1, y1 } = f.paddock;
        for (let y = y0 - 1; y <= y1 + 1; y++) {
          for (let x = x0 - 1; x <= x1 + 1; x++) {
            const t = world.tiles[y * world.w + x];
            if (t === Tile.Fence) fence++;
            if (t === Tile.FenceDown) fallen++;
          }
        }
        expect(fence + fallen).toBeGreaterThan(10);
        if (f.state === HomesteadState.FallenFence) expect(fallen).toBeGreaterThanOrEqual(3);
        else expect(fallen).toBe(0);
      }
    }
  });

  it('gives every farm a name', () => {
    const world = generateWorld(1, SMALL);
    const names = world.homesteads.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^\w+ (Farm|Steading|Yard|Fold)$/);
  });
});

describe('animals that live somewhere', () => {
  it('keeps each farm kind in its paddocks — still two of every kind, never a third', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const counts = new Array(ANIMAL_COUNT).fill(0);
      for (const a of world.animals) counts[a.kind]++;
      expect(counts.every((c) => c === 2), `seed ${seed}`).toBe(true);

      for (const f of world.homesteads) {
        const kind = FARM_KIND[f.biome];
        const penned = world.animals.filter((a) => {
          const t = tileOf(a);
          return a.kind === kind && t.x >= f.paddock.x0 && t.x <= f.paddock.x1 && t.y >= f.paddock.y0 && t.y <= f.paddock.y1;
        });
        expect(penned.length, `${f.name} seed ${seed}`).toBeGreaterThan(0);
        for (const a of penned) {
          expect(a.owner).toBe(f.state === HomesteadState.LivedIn ? f.id : -1);
        }
      }
    }
  });

  it('never lets a kept animal stray — a fallen fence gives it a tile, no more', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      for (let t = 0; t < 90; t += STEP) stepAnimals(world.animals, world, 0, STEP, null, world.settled);
      for (const a of world.animals) {
        if (!a.home) continue;
        const p = tileOf(a);
        expect(p.x, `${ANIMAL_DEFS[a.kind].name} seed ${seed}`).toBeGreaterThanOrEqual(a.home.x0);
        expect(p.x).toBeLessThanOrEqual(a.home.x1);
        expect(p.y).toBeGreaterThanOrEqual(a.home.y0);
        expect(p.y).toBeLessThanOrEqual(a.home.y1);
      }
    }
  });

  it('places wild things well away from where people live', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      for (const a of world.animals) {
        if (!ANIMAL_DEFS[a.kind].wild) continue;
        const t = tileOf(a);
        const nearest = Math.min(...world.settled.map((p) => Math.hypot(p.x - t.x, p.y - t.y)));
        expect(nearest, `${ANIMAL_DEFS[a.kind].name} seed ${seed}`).toBeGreaterThanOrEqual(WILD_SHY - 1);
      }
    }
  });

  it('turns a wild thing away when it wanders near a town', () => {
    const world = generateWorld(1, SMALL);
    const lion = world.animals.find((a) => ANIMAL_DEFS[a.kind].wild)!;
    const town = world.settled[0];
    const flat = openGroundNear(world, town.x, town.y, 6);
    lion.x = flat.x * TILE_PX + 3;
    lion.y = flat.y * TILE_PX + 4;
    lion.cooldown = 0;
    const before = Math.hypot(flat.x - town.x, flat.y - town.y);
    for (let t = 0; t < 4; t += STEP) stepAnimals([lion], world, 0, STEP, null, world.settled);
    const after = tileOf(lion);
    expect(Math.hypot(after.x - town.x, after.y - town.y)).toBeGreaterThanOrEqual(before);
  });
});

function openGroundNear(world: World, cx: number, cy: number, r: number): { x: number; y: number } {
  for (let d = r; d < r + 6; d++) {
    for (const [dx, dy] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ]) {
      const x = cx + dx;
      const y = cy + dy;
      if (isWalkable(world.tiles[y * world.w + x])) return { x, y };
    }
  }
  return { x: cx, y: cy };
}

describe('the farmer', () => {
  function atFarmer(): { s: GameState; farmer: NonNullable<ReturnType<typeof personInReach>> } {
    const s = newGame();
    const farmer = s.world.people.find((p) => p.role === PersonRole.Farmer && forSale(s, p))!;
    const t = { x: Math.floor((farmer.x + 4) / TILE_PX), y: Math.floor((farmer.y + 6) / TILE_PX) };
    placeAt(s, t.x, t.y);
    return { s, farmer };
  }

  it('will not let you rope his animal', () => {
    const { s, farmer } = atFarmer();
    s.hasRope = true;
    const animal = forSale(s, farmer)!;
    placeAt(s, tileOf(animal).x, tileOf(animal).y);
    step(s, IDLE, STEP);
    expect(animal.status).toBe(AnimalStatus.Wild);
    expect(s.message).toMatch(/farmer's/);
  });

  it('sells it for ark materials, and then it is yours to lead', () => {
    const { s, farmer } = atFarmer();
    const animal = forSale(s, farmer)!;
    const price = ANIMAL_PRICE[animal.kind]!;
    expect(actionPrompt(s)?.label).toMatch(/^Buy the/);
    expect(actionPrompt(s)?.affordable).toBe(false);

    for (const [r, n] of price) s.carried[r] = n + 1;
    expect(actionPrompt(s)?.affordable).toBe(true);
    step(s, PRESS_E, STEP);
    for (const [r] of price) expect(s.carried[r]).toBe(1);
    expect(animal.owner).toBe(-1);
    expect(s.carried[Resource.Pitch]).toBe(0);

    s.hasRope = true;
    placeAt(s, tileOf(animal).x, tileOf(animal).y);
    step(s, IDLE, STEP);
    expect(animal.status).toBe(AnimalStatus.Led);
  });

  it('never prices anything in pitch', () => {
    for (const price of Object.values(ANIMAL_PRICE)) {
      for (const [r] of price ?? []) expect(r).not.toBe(Resource.Pitch);
    }
  });

  it('leaves his animal behind when the water drives him off', () => {
    const { s, farmer } = atFarmer();
    const animal = forSale(s, farmer)!;
    placeAt(s, s.world.spawn.x, s.world.spawn.y);
    s.elapsed = s.world.params.secondsPerDay * (s.world.places[farmer.origin].drownsOn - 0.3);
    step(s, IDLE, STEP);
    expect(animal.owner).toBe(-1);
    expect(farmer.place === farmer.origin && farmer.status === PersonStatus.Here).toBe(false);
  });
});

describe('townsfolk', () => {
  it('stand on real ground in every town', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      expect(world.people.length).toBeGreaterThan(8);
      for (const p of world.people) {
        const t = Math.floor((p.y + 6) / TILE_PX) * world.w + Math.floor((p.x + 4) / TILE_PX);
        expect(isWalkable(world.tiles[t])).toBe(true);
      }
    }
  });

  it('mock the boat in the dry days and plead at the end', () => {
    const s = newGame();
    const p = s.world.people.find((q) => q.role === PersonRole.Townsfolk)!;
    placeAt(s, Math.floor((p.x + 4) / TILE_PX), Math.floor((p.y + 6) / TILE_PX));
    expect(actionPrompt(s)?.label).toBe('Talk');
    step(s, PRESS_E, STEP);
    const dry = s.message;
    expect(dry).toMatch(/^".*"$/);

    // Late in the run, somewhere still dry: a different tune.
    const high = s.world.places.reduce((a, b) => (b.drownsOn > a.drownsOn ? b : a));
    p.place = s.world.places.indexOf(high);
    p.origin = p.place;
    s.elapsed = s.world.params.secondsPerDay * Math.min(high.drownsOn - 1, 30);
    s.messageTimer = 0;
    placeAt(s, Math.floor((p.x + 4) / TILE_PX), Math.floor((p.y + 6) / TILE_PX));
    step(s, PRESS_E, STEP);
    expect(s.message).not.toBe(dry);
  });

  it('move uphill when no one is looking, and the south empties', () => {
    const s = newGame();
    // Stand somewhere none of them are, and let the water rise.
    s.elapsed = s.world.params.secondsPerDay * 25;
    step(s, IDLE, STEP);
    const { places, people } = s.world;
    for (const p of people) {
      if (p.status === PersonStatus.Gone) continue;
      expect(places[p.place].drownsOn, `person ${p.id}`).toBeGreaterThan(25 - 0.6);
    }
    expect(people.some((p) => p.place !== p.origin)).toBe(true);
  });

  it('only move on the screen you are looking at', () => {
    const s = newGame();
    const p = s.world.people[0];
    const x = p.x;
    const y = p.y;
    placeAt(s, s.world.spawn.x, s.world.spawn.y);
    if (Math.floor(x / 256) === s.camera.panelX && Math.floor(y / 176) === s.camera.panelY) return;
    for (let t = 0; t < 5; t += STEP) step(s, IDLE, STEP);
    expect([p.x, p.y]).toEqual([x, y]);
  });

});
