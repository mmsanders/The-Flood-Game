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

/** Elevation the water climbs in one day after the grace period. */
export const FLOOD_RISE_PER_DAY = MAX_ELEV / (FLOOD_DAYS - FLOOD_GRACE_DAYS);

/**
 * How many days of water sit on this elevation. 0 is dry. 1 is just under
 * (still readable). 4 or more is the deep — opaque water.
 */
export function floodDepth(elev: number, waterLevel: number): number {
  if (waterLevel <= elev) return 0;
  return Math.max(1, Math.ceil((waterLevel - elev) / FLOOD_RISE_PER_DAY));
}

/**
 * Days for the runoff front to travel the length of the map.
 *
 * The gorge does not fill like a bathtub. It is rain coming off the high
 * ground, so the water arrives at the top of the channel and runs *down* it:
 * a front sweeping from the northern spring to the southern mouth. One day,
 * so it is something you watch happen on the first morning rather than a state
 * the world was already in.
 */
export const GORGE_FILL_DAYS = 1;

/** Depth the channel runs at once the front has gone past. */
const GORGE_RUNNING_DEPTH = 2;

/**
 * Rows of shallower water at the leading edge, so the front reads as water
 * arriving rather than as a line that teleports down the map.
 */
const GORGE_FRONT_ROWS = 10;

/**
 * How deep the gorge runs at a given row, on a given day.
 *
 * Starts at the top of the map on day one and reaches the mouth a day later.
 * Sea level still applies on top: once the flood proper reaches the channel,
 * whichever is deeper wins.
 */
export function gorgeDepthAt(day: number, y: number, mapHeight: number): number {
  if (day <= 0) return 0;
  const front = (day / GORGE_FILL_DAYS) * mapHeight;
  if (y > front) return 0;
  return front - y < GORGE_FRONT_ROWS ? 1 : GORGE_RUNNING_DEPTH;
}

/**
 * Standing water on a tile, 0 (dry) to 4 (the deep).
 *
 * The one place that answers "how much water is here", so wading, sailing and
 * dredging cannot disagree about it:
 *
 * - **Natural water** is never shallow. A pond is over your head — depth 2 —
 *   whatever the sea is doing, which is what stops it being a shortcut you
 *   paddle across.
 * - **The gorge** carries runoff, which arrives at the top of the channel on
 *   day one and runs down it — so `runoff` is the depth for *this row*, not a
 *   single number for the whole channel.
 * - **Everything else** is the flood: elevation against sea level.
 */
export function waterDepth(
  tile: number,
  elev: number,
  waterLevel: number,
  runoff: number,
): number {
  const flood = floodDepth(elev, waterLevel);
  if (tile === Tile.Water) return flood > 2 ? flood : 2;
  if (tile === Tile.Gorge) return flood > runoff ? flood : runoff;
  return flood;
}

/**
 * Depth past which a tile is too deep to stand in at all.
 *
 * Depth 1 is water you are standing in; 2 is over your head. Nothing wades
 * past 1 today — galoshes are the first thing that will.
 */
export const WADE_DEPTH = 1;

/** Overlay fill for a flooded tile, or null if dry. */
export function floodOverlayFill(depth: number): string | null {
  if (depth <= 0) return null;
  if (depth === 1) return 'rgba(43, 108, 176, 0.24)';
  if (depth === 2) return 'rgba(43, 108, 176, 0.50)';
  if (depth === 3) return 'rgba(28, 74, 128, 0.76)';
  return '#1c4a80';
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
