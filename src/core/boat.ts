/**
 * The skiff: a small boat of gopher wood and fiber, framed at a slipway.
 * It is not the ark. It sits where you leave it — haul it, beach it, lose it.
 *
 * Depth ladder (what the hull can answer):
 *   unpitched  → depth ≤ 2
 *   pitched    → depth ≤ 3
 *   nothing    → depth 4
 */

import { Resource } from './tiles.js';

export const BOAT_COST_FIBER = 6;
export const BOAT_COST_WOOD = 8;

/** Pitch spent at a dock to recaulk the hull for the drowned lowlands. */
export const PITCH_COST = 4;

/** Slightly faster than a walk, slower than a sprint. */
export const BOAT_SPEED_SCALE = 1.2;

/** Dragging the skiff overland. */
export const HAUL_SPEED_SCALE = 0.5;

/** Ankle-deep wading without galoshes. */
export const WADE_SPEED_SCALE = 0.55;

/** Galoshes make depth-1 less of a slog. */
export const GALOSHES_WADE_SPEED_SCALE = 0.8;

export const BOAT_COST: Record<Resource, number> = {
  [Resource.Fiber]: BOAT_COST_FIBER,
  [Resource.Wood]: BOAT_COST_WOOD,
  [Resource.Stone]: 0,
  [Resource.Pitch]: 0,
};

/** World-placed skiff. Null on the player means you have not framed one yet. */
export interface Skiff {
  x: number;
  y: number;
  /** Recaulked at a dock — navigates depth 3. */
  pitched: boolean;
}

export function canAffordBoat(carried: readonly number[]): boolean {
  return (
    carried[Resource.Fiber] >= BOAT_COST_FIBER && carried[Resource.Wood] >= BOAT_COST_WOOD
  );
}

export function payForBoat(carried: number[]): void {
  carried[Resource.Fiber] -= BOAT_COST_FIBER;
  carried[Resource.Wood] -= BOAT_COST_WOOD;
}

export function canAffordPitch(carried: readonly number[]): boolean {
  return carried[Resource.Pitch] >= PITCH_COST;
}

export function payForPitch(carried: number[]): void {
  carried[Resource.Pitch] -= PITCH_COST;
}

/** Deepest water this hull can float on. Depth 4 is always the deep. */
export function skiffMaxDepth(skiff: Skiff | null | undefined): number {
  if (!skiff) return 0;
  return skiff.pitched ? 3 : 2;
}

/** Can the skiff occupy a tile of this standing depth? */
export function canSkiffNavigate(skiff: Skiff | null | undefined, depth: number): boolean {
  if (depth <= 0) return false;
  if (depth >= 4) return false;
  return depth <= skiffMaxDepth(skiff);
}

/**
 * Depth at which a parked skiff is lost and must be rebuilt.
 * Unpitched dies once the channel goes over its head (3+); pitched lasts
 * until the deep (4).
 */
export function skiffDestroyedAtDepth(skiff: Skiff, depth: number): boolean {
  return depth > skiffMaxDepth(skiff) || depth >= 4;
}
