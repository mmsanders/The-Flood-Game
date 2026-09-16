/**
 * Tools that break. The axe is a tool first and a key second: chopping a
 * harvestable node costs one durability, punching never-harvestable scenery
 * costs two or three, and both yield one unit.
 */

import { Resource, Tile, isResourceNode, resourceOf } from './tiles.js';

export const AXE_MAX_DURABILITY = 12;

/** Durability spent on a normally-harvestable resource node. */
export const AXE_COST_HARVESTABLE = 1;

/** Durability spent punching scenery that was never a node. */
export const AXE_COST_SCENERY = 3;

export interface AxeStrike {
  resource: Resource;
  durabilityCost: number;
}

/**
 * What an axe swing would take from this tile, or null if the axe has nothing
 * to do here.
 */
export function axeTarget(tile: number): AxeStrike | null {
  if (isResourceNode(tile)) {
    const resource = resourceOf(tile);
    if (resource === null) return null;
    return { resource, durabilityCost: AXE_COST_HARVESTABLE };
  }
  switch (tile) {
    case Tile.Tree:
      return { resource: Resource.Wood, durabilityCost: AXE_COST_SCENERY };
    case Tile.Shrub:
      return { resource: Resource.Fiber, durabilityCost: 2 };
    case Tile.Rock:
      return { resource: Resource.Stone, durabilityCost: AXE_COST_SCENERY };
    default:
      return null;
  }
}

export function hasAxe(durability: number): boolean {
  return durability > 0;
}
