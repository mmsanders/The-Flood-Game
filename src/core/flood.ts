/**
 * The flood.
 *
 * Water is a single rising scalar compared against per-tile elevation, not a
 * row-by-row event. Because the elevation field trends north-south, rows still
 * go under at roughly one per day — but hilltops in a drowned row survive as
 * shrinking islands, and low valleys in a dry row flood early, with no
 * special-casing anywhere.
 */

import { FLOOD_DAYS, PANEL_H, PANEL_W } from './config.js';
import type { TileMap } from './tilemap.js';
import { Tile, isWalkable } from './tiles.js';
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
 *
 * Walkability itself is deliberately not re-implemented here: this used to
 * carry its own copy of the blocking ID ranges, which would have quietly
 * disagreed with `isWalkable` the moment a new tile group was added.
 */
/**
 * How much of a panel is underwater, 0..1.
 *
 * Same predicate the renderer uses per tile (`elev < waterLevel`), averaged
 * over the 16x11 screen. Dungeons set `floods: false` and stay dry. The HUD
 * map reads this every frame so explored land goes blue as the water rises.
 */
export function panelFloodFraction(
  map: Pick<TileMap, 'w' | 'h' | 'elev' | 'floods'>,
  panelX: number,
  panelY: number,
  waterLevel: number,
): number {
  if (!map.floods) return 0;

  const x0 = panelX * PANEL_W;
  const y0 = panelY * PANEL_H;
  if (x0 < 0 || y0 < 0 || x0 >= map.w || y0 >= map.h) return 0;

  const x1 = Math.min(map.w, x0 + PANEL_W);
  const y1 = Math.min(map.h, y0 + PANEL_H);
  let wet = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * map.w;
    for (let x = x0; x < x1; x++) {
      total++;
      if (map.elev[row + x] < waterLevel) wet++;
    }
  }
  return total === 0 ? 0 : wet / total;
}

export function isPassable(world: World, x: number, y: number, waterLevel: number): boolean {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
  const i = y * world.w + x;
  if (world.elev[i] < waterLevel) return false;
  return isWalkable(world.tiles[i]);
}
