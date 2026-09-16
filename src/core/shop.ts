/**
 * Barter, not money. Shops trade the player's stock for gear, and prices move
 * as the world drowns — wood gets dearer every day the forest is underwater.
 */

import { Resource } from './tiles.js';

export const enum ShopItem {
  Galoshes = 0,
  Axe = 1,
  SoundingLine = 2,
  Pitch = 3,
  HeartContainer = 4,
}

export const SHOP_ITEM_NAMES: Record<ShopItem, string> = {
  [ShopItem.Galoshes]: 'Galoshes',
  [ShopItem.Axe]: 'Axe',
  [ShopItem.SoundingLine]: 'Sounding line',
  [ShopItem.Pitch]: 'Pitch',
  [ShopItem.HeartContainer]: 'Heart container',
};

/** One unit of payment: a resource and how many of it. */
export interface BarterPrice {
  resource: Resource;
  amount: number;
}

export interface ShopOffer {
  item: ShopItem;
  /** Base costs before drowning scarcity. */
  base: readonly BarterPrice[];
}

/**
 * Catalogue order. The shop prompt walks this list; owned unique gear is
 * skipped so the counter always has something to say.
 */
export const SHOP_CATALOG: readonly ShopOffer[] = [
  {
    item: ShopItem.Galoshes,
    base: [{ resource: Resource.Fiber, amount: 8 }],
  },
  {
    item: ShopItem.Axe,
    base: [
      { resource: Resource.Wood, amount: 6 },
      { resource: Resource.Stone, amount: 4 },
    ],
  },
  {
    item: ShopItem.SoundingLine,
    base: [
      { resource: Resource.Fiber, amount: 10 },
      { resource: Resource.Pitch, amount: 2 },
    ],
  },
  {
    item: ShopItem.Pitch,
    base: [
      { resource: Resource.Wood, amount: 4 },
      { resource: Resource.Fiber, amount: 4 },
    ],
  },
  {
    item: ShopItem.HeartContainer,
    base: [
      { resource: Resource.Wood, amount: 20 },
      { resource: Resource.Fiber, amount: 20 },
      { resource: Resource.Stone, amount: 12 },
      { resource: Resource.Pitch, amount: 8 },
    ],
  },
];

/**
 * How much of each biome's native stock is still above water, 0..1.
 * Index by Resource (valley fiber, forest wood, scrub stone, mountain pitch).
 */
export interface BiomeDryFraction {
  fiber: number;
  wood: number;
  stone: number;
  pitch: number;
}

/**
 * Scale a base price by how drowned the *supply* biome for that resource is.
 * When the forest is underwater, wood costs climb; paying *in* wood gets no
 * discount — scarcity hits the seller's stock, so every ask rises.
 */
export function scaledPrice(
  base: readonly BarterPrice[],
  dry: BiomeDryFraction,
): BarterPrice[] {
  const out: BarterPrice[] = [];
  for (const part of base) {
    const dryFrac = dryFractionFor(part.resource, dry);
    // At full dry land: 1x. Fully drowned: up to 3x. Smooth, never below base.
    const mult = 1 + 2 * (1 - dryFrac);
    out.push({ resource: part.resource, amount: Math.max(1, Math.ceil(part.amount * mult)) });
  }
  return out;
}

function dryFractionFor(resource: Resource, dry: BiomeDryFraction): number {
  switch (resource) {
    case Resource.Fiber:
      return dry.fiber;
    case Resource.Wood:
      return dry.wood;
    case Resource.Stone:
      return dry.stone;
    case Resource.Pitch:
      return dry.pitch;
  }
}

export function canAffordBarter(carried: readonly number[], price: readonly BarterPrice[]): boolean {
  for (const part of price) {
    if (carried[part.resource] < part.amount) return false;
  }
  return true;
}

export function payBarter(carried: number[], price: readonly BarterPrice[]): void {
  for (const part of price) carried[part.resource] -= part.amount;
}

/** Hermit outdoor trade: a painful but focused ask for one heart. */
export const HERMIT_HEART_COST: readonly BarterPrice[] = [
  { resource: Resource.Pitch, amount: 6 },
  { resource: Resource.Wood, amount: 8 },
];
