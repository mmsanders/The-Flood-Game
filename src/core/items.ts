/**
 * Wave-two equipment and barter prices.
 *
 * There is deliberately no currency. Every purchase competes with the ark for
 * the same four materials, and the price rises as the biome that produces a
 * material disappears under the flood.
 */

import { Biome, Resource } from './tiles.js';

export const enum ItemKind {
  Galoshes = 0,
  Axe = 1,
  Pickaxe = 2,
  SoundingLine = 3,
  HeartContainer = 4,
}

export const ITEM_NAMES: Record<ItemKind, string> = {
  [ItemKind.Galoshes]: 'Galoshes',
  [ItemKind.Axe]: 'Axe',
  [ItemKind.Pickaxe]: 'Pickaxe',
  [ItemKind.SoundingLine]: 'Sounding Line',
  [ItemKind.HeartContainer]: 'Heart Container',
};

export interface BarterPart {
  resource: Resource;
  amount: number;
}

/** A fresh tool is useful for several decisions, not an entire run. */
export const AXE_DURABILITY = 14;
export const PICKAXE_DURABILITY = 14;

/**
 * The central marked building in each settlement is the Wave-two market
 * frontage. Wave three can put the same stock behind an interior without
 * changing the economy.
 */
export const SHOP_STOCK: Record<Biome, readonly ItemKind[]> = {
  [Biome.Valley]: [ItemKind.Galoshes, ItemKind.HeartContainer],
  [Biome.Forest]: [ItemKind.Axe, ItemKind.SoundingLine],
  [Biome.Scrub]: [ItemKind.Pickaxe, ItemKind.HeartContainer],
  [Biome.Mountain]: [],
};

export const ITEM_COST: Record<ItemKind, readonly BarterPart[]> = {
  [ItemKind.Galoshes]: [
    { resource: Resource.Fiber, amount: 8 },
    { resource: Resource.Wood, amount: 2 },
  ],
  [ItemKind.Axe]: [
    { resource: Resource.Fiber, amount: 3 },
    { resource: Resource.Wood, amount: 6 },
  ],
  [ItemKind.Pickaxe]: [
    { resource: Resource.Wood, amount: 3 },
    { resource: Resource.Stone, amount: 7 },
  ],
  [ItemKind.SoundingLine]: [
    { resource: Resource.Fiber, amount: 5 },
    { resource: Resource.Wood, amount: 5 },
    { resource: Resource.Stone, amount: 3 },
  ],
  [ItemKind.HeartContainer]: [
    { resource: Resource.Fiber, amount: 10 },
    { resource: Resource.Wood, amount: 10 },
    { resource: Resource.Stone, amount: 8 },
  ],
};

/**
 * Approximate day each source biome begins disappearing in earnest. This is a
 * deliberately cheap pricing proxy: market prompts are rendered every frame,
 * so they must not scan the entire world to count submerged resource tiles.
 */
const SCARCITY_DAY: Record<Resource, number> = {
  [Resource.Fiber]: 6,
  [Resource.Wood]: 12,
  [Resource.Stone]: 20,
  [Resource.Pitch]: 28,
};

/** Base price with up to a 75% flood-scarcity markup. */
export function marketAmount(resource: Resource, base: number, day: number): number {
  const since = day - SCARCITY_DAY[resource];
  if (since < 0) return base;
  const stage = Math.min(3, 1 + Math.floor(since / 5));
  return Math.ceil(base * (1 + stage * 0.25));
}
