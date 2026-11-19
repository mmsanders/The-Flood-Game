/**
 * Wave 7, part two: fuller towns and the trades between them, the tavern,
 * found tools, and an ending with names.
 */

import { describe, expect, it } from 'vitest';
import { InteriorKind } from '../src/core/interior.js';
import { AXE_DURABILITY, PICKAXE_DURABILITY } from '../src/core/items.js';
import { Resource, Tile, isWalkable } from '../src/core/tiles.js';
import { SettlementKind, SiteKind, type World } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { FOUND_AXE, FOUND_PICKAXE } from '../src/game/ground.js';
import { leftBehind } from '../src/game/people.js';
import { type GameState, actionPrompt, step } from '../src/game/state.js';
import { REST_COST, rumours, signText } from '../src/game/town.js';
import { IDLE, PRESS_E, SMALL, STEP, newGame, placeAt } from './support/scenario.js';

const SEEDS = [1, 2, 3, 7, 4242];

function countNear(world: World, x: number, y: number, r: number, tile: Tile): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (world.tiles[(y + dy) * world.w + x + dx] === tile) n++;
    }
  }
  return n;
}

describe('fuller towns', () => {
  it('gives most towns a tavern, and every tavern a room', () => {
    let towns = 0;
    let taverns = 0;
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      towns += world.settlements.filter((s) => s.kind !== SettlementKind.Hamlet).length;
      const rooms = world.interiors.filter((r) => r.kind === InteriorKind.Tavern);
      taverns += rooms.length;
      for (const r of rooms) {
        expect(world.tiles[r.overworldEntrance.y * world.w + r.overworldEntrance.x]).toBe(Tile.TavernDoor);
      }
    }
    expect(taverns).toBeGreaterThanOrEqual(towns - 1);
  });

  it('puts stalls, a well and a signpost round the square', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      for (const s of world.settlements) {
        if (s.kind === SettlementKind.Hamlet) continue;
        const stalls = countNear(world, s.x, s.y, 4, Tile.Stall);
        const signs = countNear(world, s.x, s.y, 4, Tile.Signpost);
        expect(stalls + signs, `town ${s.kind} seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('walls a merchant\'s garden in the city', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const city = world.settlements.find((s) => s.kind === SettlementKind.City);
      if (!city) continue;
      expect(countNear(world, city.x, city.y, 14, Tile.StoneWall), `seed ${seed}`).toBeGreaterThan(8);
    }
  });
});

describe('the trades', () => {
  it('sites every trade where it belongs, connected to the world', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, SMALL);
      const kinds = new Set(world.sites.map((s) => s.kind));
      expect(kinds.size, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      for (const site of world.sites) {
        if (site.kind === SiteKind.Woodcut) expect(world.tiles[site.tool!.y * world.w + site.tool!.x]).toBe(Tile.AxeLeft);
        if (site.kind === SiteKind.Quarry) expect(world.tiles[site.tool!.y * world.w + site.tool!.x]).toBe(Tile.PickaxeLeft);
      }
      expect(world.stats.connected, `seed ${seed}`).toBe(true);
    }
  });

  it('has someone working the potter\'s yard, the vineyard and the charcoal', () => {
    const world = generateWorld(1, SMALL);
    for (const site of world.sites) {
      if (!site.keeper) continue;
      const place = world.places.find((p) => p.name === site.name);
      expect(place, site.name).toBeDefined();
      expect(world.people.some((p) => world.places[p.origin] === place)).toBe(true);
    }
  });
});

describe('found tools', () => {
  function onTool(kind: SiteKind): { s: GameState; at: { x: number; y: number } } {
    const s = newGame();
    const site = s.world.sites.find((x) => x.kind === kind)!;
    return { s, at: site.tool! };
  }

  it('gives a worn axe from the woodcut, once', () => {
    const { s, at } = onTool(SiteKind.Woodcut);
    placeAt(s, at.x, at.y);
    step(s, IDLE, STEP);
    expect(s.hasAxe).toBe(true);
    expect(s.axeDurability).toBe(FOUND_AXE);
    expect(FOUND_AXE).toBeLessThan(AXE_DURABILITY);
    expect(s.world.tiles[at.y * s.world.w + at.x]).not.toBe(Tile.AxeLeft);
    expect(isWalkable(s.world.tiles[at.y * s.world.w + at.x])).toBe(true);
  });

  it('gives a worn pickaxe from the quarry', () => {
    const { s, at } = onTool(SiteKind.Quarry);
    placeAt(s, at.x, at.y);
    step(s, IDLE, STEP);
    expect(s.hasPickaxe).toBe(true);
    expect(s.pickaxeDurability).toBe(FOUND_PICKAXE);
    expect(FOUND_PICKAXE).toBeLessThan(PICKAXE_DURABILITY);
  });
});

describe('the tavern', () => {
  function inTavern(): GameState {
    const s = newGame();
    const room = s.world.interiors.find((r) => r.kind === InteriorKind.Tavern)!;
    s.location = { kind: 'interior', dungeonId: -1, interiorId: room.id, returnTo: room.overworldEntrance };
    placeAt(s, room.focus.x, room.focus.y);
    return s;
  }

  it('has a keeper with a new rumour each time you ask', () => {
    const s = inTavern();
    expect(actionPrompt(s)?.label).toMatch(/keeper/);
    step(s, PRESS_E, STEP);
    const first = s.message;
    s.messageTimer = 0;
    step(s, PRESS_E, STEP);
    expect(s.message).not.toBe(first);
    expect(s.rumoursHeard).toBe(2);
  });

  it('only tells the truth: the axe rumour goes once the axe is taken', () => {
    const s = newGame();
    const woodcut = s.world.sites.find((x) => x.kind === SiteKind.Woodcut)!;
    const here = s.world.spawn;
    expect(rumours(s, here).some((r) => r.includes('woodcutter left his axe'))).toBe(true);
    s.world.tiles[woodcut.tool!.y * s.world.w + woodcut.tool!.x] = Tile.Dirt;
    expect(rumours(s, here).some((r) => r.includes('woodcutter left his axe'))).toBe(false);
  });

  it('sells a heart back by the fire for fiber, and nothing when you are well', () => {
    const s = inTavern();
    const room = s.world.interiors[s.location.interiorId];
    placeAt(s, room.lore!.x, room.lore!.y);
    s.carried[Resource.Fiber] = REST_COST;
    step(s, PRESS_E, STEP);
    expect(s.carried[Resource.Fiber]).toBe(REST_COST);

    s.player.hearts = 1;
    s.messageTimer = 0;
    step(s, PRESS_E, STEP);
    expect(s.player.hearts).toBe(2);
    expect(s.carried[Resource.Fiber]).toBe(0);
  });
});

describe('the signpost and the ending', () => {
  it('points the way to the nearest places, by name', () => {
    const s = newGame();
    const town = s.world.settlements.find((t) => t.kind !== SettlementKind.Hamlet)!;
    const text = signText(s, town);
    expect(text).toMatch(/(north|south|east|west)/);
    expect(text.split(' · ').length).toBeGreaterThanOrEqual(1);
  });

  it('names who was left behind', () => {
    const s = newGame();
    const text = leftBehind(s);
    expect(text).toMatch(/^the people of /);
    expect(text).toMatch(/ at \w+ (Farm|Steading|Yard|Fold)/);
  });
});
