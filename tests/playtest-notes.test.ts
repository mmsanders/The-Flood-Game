import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import { RewardKind } from '../src/core/dungeon.js';
import { SHOP_STOCK, ItemKind } from '../src/core/items.js';
import { Biome, Tile, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { createGame } from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const SEEDS = [1, 2, 7, 4242, 9001, 20260830];

describe('playtest notes: gorge', () => {
  it.each(SEEDS)('seed %i cuts a continuous gorge with one bridge per biome band', (seed) => {
    const world = generateWorld(seed, SMALL);
    let gaps = 0;
    let gorge = 0;
    for (let y = 2; y < world.h - 3; y++) {
      for (let x = 2; x < world.w - 2; x++) {
        const i = y * world.w + x;
        if (world.tiles[i] !== Tile.Gorge) continue;
        gorge++;
        const n4 = [i - 1, i + 1, i - world.w, i + world.w];
        const linked = n4.some((j) => {
          if (j < 0 || j >= world.tiles.length) return false;
          const t = world.tiles[j];
          return t === Tile.Gorge || t === Tile.Bridge;
        });
        if (!linked) gaps++;
      }
    }
    expect(gorge, `seed ${seed} has no gorge`).toBeGreaterThan(20);
    expect(gaps, `seed ${seed} left ${gaps} isolated gorge tiles`).toBeLessThan(8);

    const bridges = new Set<number>();
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] !== Tile.Bridge) continue;
      const y = (i / world.w) | 0;
      const n4 = [i - 1, i + 1, i - world.w, i + world.w];
      if (n4.some((j) => j >= 0 && j < world.tiles.length && world.tiles[j] === Tile.Gorge)) {
        bridges.add(y);
      }
    }
    expect(bridges.size, `seed ${seed} gorge crossings ${[...bridges]}`).toBeGreaterThanOrEqual(3);
  });
});

describe('playtest notes: dungeon items', () => {
  it('puts the rods and instruments in dungeons, not hearts', () => {
    const world = generateWorld(4242, SMALL);
    const rewards = world.dungeons.map((d) => d.reward);
    expect(rewards).toContain(RewardKind.BuddingRod);
    expect(rewards).toContain(RewardKind.SerpentRod);
    expect(rewards).toContain(RewardKind.Chart);
    expect(rewards).toContain(RewardKind.Galoshes);
    expect(rewards).not.toContain(RewardKind.HeartContainer);

    const mountain = world.dungeons.find((d) => d.biomeKind === Biome.Mountain);
    const scrub = world.dungeons.find((d) => d.biomeKind === Biome.Scrub);
    expect(mountain?.reward).toBe(RewardKind.BuddingRod);
    expect(scrub?.reward).toBe(RewardKind.SerpentRod);
    expect(mountain && [...mountain.tiles].includes(Tile.PitchSeal)).toBe(true);
    expect(scrub && [...scrub.tiles].includes(Tile.StoneSeal)).toBe(true);
  });

  it('keeps Chart and Galoshes out of the markets', () => {
    const stock = [
      ...SHOP_STOCK[Biome.Valley],
      ...SHOP_STOCK[Biome.Forest],
      ...SHOP_STOCK[Biome.Scrub],
    ];
    expect(stock).not.toContain(ItemKind.Chart);
    expect(stock).not.toContain(ItemKind.Galoshes);
  });
});

describe('playtest notes: boat under-tile', () => {
  it('remembers the ground the skiff was set on', () => {
    const state = createGame(generateWorld(4242, SMALL));
    const { spawn } = state.world;
    const i = spawn.y * state.world.w + spawn.x;
    state.world.tiles[i] = Tile.Sand;
    state.hasBoat = true;
    state.haulingBoat = true;
    state.player.x = spawn.x * TILE_PX + 4;
    state.player.y = spawn.y * TILE_PX + 4;
    state.boatUnderTile = Tile.Sand;
    state.world.tiles[i] = Tile.Skiff;
    state.boatX = spawn.x;
    state.boatY = spawn.y;
    expect(state.boatUnderTile).toBe(Tile.Sand);
    expect(isWalkable(Tile.Skiff)).toBe(true);
  });
});
