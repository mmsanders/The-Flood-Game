import { describe, expect, it } from 'vitest';
import {
  canSkiffNavigate,
  skiffDestroyedAtDepth,
  skiffMaxDepth,
} from '../src/core/boat.js';
import { withParams } from '../src/core/config.js';
import {
  SHOP_CATALOG,
  ShopItem,
  canAffordBarter,
  scaledPrice,
  type BiomeDryFraction,
} from '../src/core/shop.js';
import { AXE_COST_HARVESTABLE, AXE_COST_SCENERY, axeTarget } from '../src/core/tools.js';
import { Resource, Tile } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });

describe('Wave 2: depth ladder by gear tier', () => {
  it('gates navigation: feet / skiff / pitched / nothing', () => {
    expect(skiffMaxDepth(null)).toBe(0);
    expect(skiffMaxDepth({ x: 0, y: 0, pitched: false })).toBe(2);
    expect(skiffMaxDepth({ x: 0, y: 0, pitched: true })).toBe(3);

    const plain = { x: 0, y: 0, pitched: false };
    const pitched = { x: 0, y: 0, pitched: true };
    expect(canSkiffNavigate(plain, 1)).toBe(true);
    expect(canSkiffNavigate(plain, 2)).toBe(true);
    expect(canSkiffNavigate(plain, 3)).toBe(false);
    expect(canSkiffNavigate(pitched, 3)).toBe(true);
    expect(canSkiffNavigate(pitched, 4)).toBe(false);
    expect(canSkiffNavigate(plain, 4)).toBe(false);
  });
});

describe('Wave 2: skiff as a world object (model)', () => {
  it('is lost when parked water exceeds the hull tier', () => {
    const plain = { x: 0, y: 0, pitched: false };
    const pitched = { x: 0, y: 0, pitched: true };
    expect(skiffDestroyedAtDepth(plain, 2)).toBe(false);
    expect(skiffDestroyedAtDepth(plain, 3)).toBe(true);
    expect(skiffDestroyedAtDepth(pitched, 3)).toBe(false);
    expect(skiffDestroyedAtDepth(pitched, 4)).toBe(true);
  });
});

describe('Wave 2: axe durability', () => {
  it('costs 1 on a harvestable node and 3 on scenery', () => {
    expect(axeTarget(Tile.GopherTree)?.durabilityCost).toBe(AXE_COST_HARVESTABLE);
    expect(axeTarget(Tile.Tree)?.durabilityCost).toBe(AXE_COST_SCENERY);
  });
});

describe('Wave 2: barter prices move as the world drowns', () => {
  it('scales wood costs up when the forest is underwater', () => {
    const dry: BiomeDryFraction = { fiber: 1, wood: 1, stone: 1, pitch: 1 };
    const drowned: BiomeDryFraction = { fiber: 1, wood: 0, stone: 1, pitch: 1 };
    const axe = SHOP_CATALOG.find((o) => o.item === ShopItem.Axe)!;
    const atDry = scaledPrice(axe.base, dry);
    const atWet = scaledPrice(axe.base, drowned);
    const woodDry = atDry.find((p) => p.resource === Resource.Wood)!.amount;
    const woodWet = atWet.find((p) => p.resource === Resource.Wood)!.amount;
    expect(woodWet).toBeGreaterThan(woodDry);
  });

  it('refuses a barter the player cannot pay', () => {
    expect(canAffordBarter([0, 0, 0, 0], [{ resource: Resource.Fiber, amount: 1 }])).toBe(false);
    expect(canAffordBarter([8, 0, 0, 0], [{ resource: Resource.Fiber, amount: 8 }])).toBe(true);
  });
});

describe('Wave 2: hearts earned, not scattered', () => {
  it('places no field heart containers by default', () => {
    for (const seed of [1, 7, 4242]) {
      const world = generateWorld(seed, SMALL);
      const hearts = [...world.tiles].filter((t) => t === Tile.HeartContainer).length;
      expect(hearts, `seed ${seed}`).toBe(0);
    }
  });

  it('places at least one Shop tile in a generated world', () => {
    const world = generateWorld(4242, SMALL);
    const shops = [...world.tiles].filter((t) => t === Tile.Shop).length;
    expect(shops).toBeGreaterThan(0);
  });
});
