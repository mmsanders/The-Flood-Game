import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import { AnimalKind, AnimalStatus } from '../src/core/animals.js';
import { generateInterior, InteriorKind } from '../src/core/interior.js';
import { ItemKind } from '../src/core/items.js';
import { Biome, Resource, Tile } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  Dir,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  createGame,
  lodestoneBearing,
  releaseDove,
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

describe('wave 3: interiors', () => {
  it('builds shop, hermit, carpenter and Noah tent interiors for a seed', () => {
    const world = generateWorld(4242, SMALL);
    expect(world.interiors.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(world.interiors.map((room) => room.kind));
    expect(kinds.has(InteriorKind.Shop) || kinds.has(InteriorKind.Hermit)).toBe(true);
    expect(kinds.has(InteriorKind.Carpenter)).toBe(true);
    expect(kinds.has(InteriorKind.NoahTent)).toBe(true);

    for (const room of world.interiors) {
      expect(room.tiles[room.stairs.y * room.w + room.stairs.x]).toBe(Tile.Stairs);
      const entrance =
        world.tiles[room.overworldEntrance.y * world.w + room.overworldEntrance.x];
      if (room.kind === InteriorKind.Carpenter) expect(entrance).toBe(Tile.BoatYard);
      else if (room.kind === InteriorKind.NoahTent) expect(entrance).toBe(Tile.CampTent);
      else expect(entrance).toBe(Tile.TownDoor);
    }
  });

  it('enters a shop from the door and exits via stairs', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.TownDoor;
    state.world.biome[i] = Biome.Valley;
    const room = generateInterior(InteriorKind.Shop, state.world.interiors.length, Biome.Valley, {
      x: spawn.x,
      y: spawn.y,
    });
    state.world.interiors.push(room);
    state.exploredInteriors.push(new Uint8Array(1));

    expect(actionPrompt(state)?.label).toMatch(/Enter the market/i);
    step(state, INTERACT, 1 / 60);
    expect(state.location.kind).toBe('interior');
    expect(state.location.interiorId).toBe(room.id);

    placeAt(state, room.stairs.x, room.stairs.y);
    step(state, IDLE, 1 / 60);
    expect(state.location.kind).toBe('overworld');
  });
});

describe('wave 3: hermit interior trade', () => {
  it('completes the sheep-for-heart bargain indoors', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.TownDoor;
    state.world.biome[i] = Biome.Mountain;
    const room = generateInterior(InteriorKind.Hermit, state.world.interiors.length, Biome.Mountain, {
      x: spawn.x,
      y: spawn.y,
    });
    state.world.interiors.push(room);
    state.exploredInteriors.push(new Uint8Array(1));
    const sheep = state.world.animals.find((a) => a.kind === AnimalKind.Sheep);
    expect(sheep).toBeDefined();
    if (!sheep) return;
    sheep.status = AnimalStatus.Boarded;

    step(state, INTERACT, 1 / 60);
    placeAt(state, room.focus.x, room.focus.y);
    step(state, INTERACT, 1 / 60);
    expect(state.hermitHeartClaimed).toBe(true);
    expect(state.player.maxHearts).toBe(4);
  });
});

describe('wave 3: carpenter and Noah tent', () => {
  it('enters the carpenter at the slipway and frames a skiff at the workbench', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const yard = state.world.boatYard;
    clearArea(state, yard.x, yard.y, 2);
    state.world.tiles[yard.y * state.world.w + yard.x] = Tile.BoatYard;
    placeAt(state, yard.x, yard.y);
    state.carried[Resource.Wood] = 20;
    state.carried[Resource.Fiber] = 20;

    const room = state.world.interiors.find((r) => r.kind === InteriorKind.Carpenter);
    expect(room).toBeDefined();
    if (!room) return;

    step(state, INTERACT, 1 / 60);
    expect(state.location.kind).toBe('interior');
    placeAt(state, room.focus.x, room.focus.y);
    expect(actionPrompt(state)?.label).toMatch(/skiff/i);
    step(state, INTERACT, 1 / 60);
    expect(state.hasBoat).toBe(true);
    expect(state.haulingBoat).toBe(true);
  });

  it("enters Noah's tent at the camp", () => {
    const state = createGame(generateWorld(4242, SMALL));
    const tent = state.world.interiors.find((r) => r.kind === InteriorKind.NoahTent);
    expect(tent).toBeDefined();
    if (!tent) return;
    const { x, y } = tent.overworldEntrance;
    clearArea(state, x, y, 1);
    state.world.tiles[y * state.world.w + x] = Tile.CampTent;
    placeAt(state, x, y);

    expect(actionPrompt(state)?.label).toMatch(/tent/i);
    step(state, INTERACT, 1 / 60);
    expect(state.location.kind).toBe('interior');
    expect(state.location.interiorId).toBe(tent.id);
  });
});

describe('wave 3: instruments', () => {
  it('buys Axe, Lodestone and Dove from shop stock and records ownership', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 4);
    state.carried.fill(100);

    function shopAt(dx: number, biome: Biome) {
      const x = spawn.x + dx;
      const y = spawn.y;
      const i = y * state.world.w + x;
      state.world.tiles[i] = Tile.TownDoor;
      state.world.biome[i] = biome;
      const room = generateInterior(InteriorKind.Shop, state.world.interiors.length, biome, { x, y });
      state.world.interiors.push(room);
      state.exploredInteriors.push(new Uint8Array(1));
      return room;
    }

    const forest = shopAt(0, Biome.Forest);
    placeAt(state, spawn.x, spawn.y);
    step(state, INTERACT, 1 / 60);
    placeAt(state, forest.focus.x, forest.focus.y);
    expect(actionPrompt(state)?.label).toMatch(/Axe/i);
    step(state, INTERACT, 1 / 60);
    expect(state.hasAxe).toBe(true);

    state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
    const scrub = shopAt(1, Biome.Scrub);
    state.hasPickaxe = true;
    placeAt(state, spawn.x + 1, spawn.y);
    step(state, INTERACT, 1 / 60);
    placeAt(state, scrub.focus.x, scrub.focus.y);
    expect(actionPrompt(state)?.label).toMatch(/Lodestone/i);
    step(state, INTERACT, 1 / 60);
    expect(state.hasLodestone).toBe(true);

    state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
    const valley = shopAt(2, Biome.Valley);
    state.hasGaloshes = true;
    placeAt(state, spawn.x + 2, spawn.y);
    step(state, INTERACT, 1 / 60);
    placeAt(state, valley.focus.x, valley.focus.y);
    expect(actionPrompt(state)?.label).toMatch(/Dove/i);
    step(state, INTERACT, 1 / 60);
    expect(state.hasDove).toBe(true);
  });

  it('points the lodestone at the ark on land and at sea', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn, ark } = state.world;
    clearArea(state, spawn.x, spawn.y, 3);
    placeAt(state, spawn.x, spawn.y);
    state.hasLodestone = true;

    placeAt(state, ark.x, ark.y + 4);
    expect(lodestoneBearing(state)).toBe(Dir.Up);

    placeAt(state, ark.x + 4, ark.y);
    expect(lodestoneBearing(state)).toBe(Dir.Left);

    state.inBoat = true;
    state.hasBoat = true;
    placeAt(state, ark.x, ark.y - 3);
    expect(lodestoneBearing(state)).toBe(Dir.Down);
  });

  it('lets the dove name a bearing to dry land or a free beast', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    clearArea(state, spawn.x, spawn.y, 2);
    placeAt(state, spawn.x, spawn.y);
    state.hasDove = true;
    state.elapsed = 0;

    releaseDove(state);
    expect(state.message).toMatch(/dove/i);

    state.elapsed = state.world.params.secondsPerDay * 5;
    state.inBoat = true;
    state.hasBoat = true;
    releaseDove(state);
    expect(state.message).toMatch(/dove/i);
  });

  it('exposes instrument kinds on the item enum used by barter', () => {
    expect(ItemKind.Chart).toBe(5);
    expect(ItemKind.Lodestone).toBe(6);
    expect(ItemKind.Dove).toBe(7);
  });
});
