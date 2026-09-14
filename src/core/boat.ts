/**
 * The skiff: a small boat of gopher wood and fiber, launched from the valley
 * slipway. It is not the ark. It exists so Noah can take the flood itself and
 * haul up what the water has already covered.
 *
 * No pole — dredging is just the Rod, used from the deck. A fishing-rod
 * blessing is a later Rod of Aaron upgrade.
 */

import { Resource } from './tiles.js';

export const BOAT_COST_FIBER = 6;
export const BOAT_COST_WOOD = 8;

/** Slightly faster than a walk, slower than a sprint. */
export const BOAT_SPEED_SCALE = 1.2;

export const BOAT_COST: Record<Resource, number> = {
  [Resource.Fiber]: BOAT_COST_FIBER,
  [Resource.Wood]: BOAT_COST_WOOD,
  [Resource.Stone]: 0,
  [Resource.Pitch]: 0,
};

export function canAffordBoat(carried: readonly number[]): boolean {
  return (
    carried[Resource.Fiber] >= BOAT_COST_FIBER && carried[Resource.Wood] >= BOAT_COST_WOOD
  );
}

export function payForBoat(carried: number[]): void {
  carried[Resource.Fiber] -= BOAT_COST_FIBER;
  carried[Resource.Wood] -= BOAT_COST_WOOD;
}
