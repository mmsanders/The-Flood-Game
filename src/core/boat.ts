/**
 * The skiff: a small boat of gopher wood and fiber, launched from a town
 * slipway. It is not the ark. In Wave two it becomes a physical object: Noah
 * sails it, beaches it, hauls it overland, and can leave it behind.
 */

import { Resource } from './tiles.js';

export const BOAT_COST_FIBER = 6;
export const BOAT_COST_WOOD = 8;

/** Slightly faster than a walk, slower than a sprint. */
export const BOAT_SPEED_SCALE = 1.2;
/** Lugging a beached skiff is intentionally awkward. */
export const BOAT_PORTAGE_SPEED_SCALE = 0.5;

/** The ordinary hull crosses natural water/depth 2 but not the late deep. */
export const BASE_BOAT_DEPTH = 2;
/** Recaulking with pitch at a higher dock buys one more rung of the ladder. */
export const PITCHED_BOAT_DEPTH = 3;
export const BOAT_PITCH_COST = 4;
export const BOAT_RECAULK_FIBER = 3;

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

export function canAffordPitching(carried: readonly number[]): boolean {
  return (
    carried[Resource.Pitch] >= BOAT_PITCH_COST &&
    carried[Resource.Fiber] >= BOAT_RECAULK_FIBER
  );
}

export function payForPitching(carried: number[]): void {
  carried[Resource.Pitch] -= BOAT_PITCH_COST;
  carried[Resource.Fiber] -= BOAT_RECAULK_FIBER;
}

/**
 * A set-down skiff is lost once the water under it exceeds what the hull can
 * answer — or once depth 4 arrives, which nothing short of the ark can take.
 */
export function boatDestroyedAtDepth(boatDepth: number, depth: number): boolean {
  if (depth <= 0) return false;
  return depth > boatDepth || depth >= 4;
}
