/**
 * The flood.
 *
 * Water is a single rising scalar compared against per-tile elevation, not a
 * row-by-row event. Because the elevation field trends north-south, rows still
 * go under at roughly one per day — but hilltops in a drowned row survive as
 * shrinking islands, and low valleys in a dry row flood early, with no
 * special-casing anywhere.
 */

import { FLOOD_DAYS } from './config.js';
import { Tile } from './tiles.js';
import type { World } from './world.js';

/** Elevation is stored as a byte, so the water has to clear 255 to win. */
const MAX_ELEV = 256;

/**
 * Days of calm before the rain starts.
 *
 * Long enough to get your bearings, meet the voice telling you to build, and
 * gather from the lowlands you're standing in — short enough that it never
 * feels like a tutorial. The water still finishes the job on day 40; it just
 * climbs slightly faster once it starts.
 */
export const FLOOD_GRACE_DAYS = 2;

/**
 * Water height at a given time, in elevation units.
 *
 * day 0..2 -> 0   (the calm before)
 * day 40   -> 256 (everything submerged)
 *
 * Deliberately linear after the grace period: the player should be able to
 * learn the pace and plan against it. Uneven terrain supplies all the
 * variation the pacing needs.
 */
export function waterLevelAtDay(day: number): number {
  const rising = day - FLOOD_GRACE_DAYS;
  if (rising <= 0) return 0;
  const t = Math.min(1, rising / (FLOOD_DAYS - FLOOD_GRACE_DAYS));
  return t * MAX_ELEV;
}

/** Convenience for the running game, which tracks elapsed seconds. */
export function dayAtSeconds(seconds: number, secondsPerDay: number): number {
  return seconds / secondsPerDay;
}

export function waterLevelAtSeconds(seconds: number, secondsPerDay: number): number {
  return waterLevelAtDay(dayAtSeconds(seconds, secondsPerDay));
}

/** Is this elevation under the flood at this water level? */
export function isSubmergedElev(elev: number, waterLevel: number): boolean {
  return elev < waterLevel;
}

export function isSubmerged(world: World, x: number, y: number, waterLevel: number): boolean {
  const i = y * world.w + x;
  return world.elev[i] < waterLevel;
}

/**
 * The day a tile goes under, as a float. Infinity is never used — every tile
 * drowns by day 40 — but naturally-watery tiles are already gone at day 0.
 */
export function drownDay(world: World, x: number, y: number): number {
  const i = y * world.w + x;
  if (world.tiles[i] === Tile.Water) return 0;
  return drownDayForElev(world.elev[i]);
}

/** Inverse of waterLevelAtDay: the day this elevation goes under. */
export function drownDayForElev(elev: number): number {
  return FLOOD_GRACE_DAYS + (elev / MAX_ELEV) * (FLOOD_DAYS - FLOOD_GRACE_DAYS);
}

/**
 * Can the player occupy this tile right now? Combines terrain walkability with
 * the flood, which is the only place the two rules meet.
 */
export function isPassable(world: World, x: number, y: number, waterLevel: number): boolean {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
  const i = y * world.w + x;
  if (world.elev[i] < waterLevel) return false;
  const tile = world.tiles[i];
  if (tile >= Tile.Tree && tile <= Tile.Water) return false;
  if (tile >= Tile.Flax && tile <= Tile.PitchSeep) return false;
  return true;
}
