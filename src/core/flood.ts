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
 * The day the rain begins: the end of the prologue.
 *
 * Before it the world is dry and sunny and the clock is yours — time to learn
 * the map and climb the Rod ladder, which is what actually gates the
 * resources, so a long dry spell cannot be spent stockpiling. After it the
 * water climbs a steeper ramp to the same day 40. Forty days stays
 * load-bearing (Genesis 7:12); only the curve changes.
 *
 * Five is a guess to be playtested. Everything downstream — the gorge front,
 * the dungeon flood, the palette, every drown-day in worldgen validation —
 * reads this one constant.
 */
export const RAIN_DAY = 5;

/** Days of calm before the water starts. The prologue is the grace period. */
export const FLOOD_GRACE_DAYS = RAIN_DAY;

/** Has the rain begun by this day? */
export function isRaining(day: number): boolean {
  return day >= RAIN_DAY;
}

/**
 * Water height at a given time, in elevation units.
 *
 * day 0..5 -> 0   (the prologue)
 * day 40   -> 256 (everything submerged)
 *
 * Deliberately linear after the prologue: the player should be able to
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
 * Gameplay depth, derived from how many flood-days the water has stood above
 * this elevation.
 *
 * Depth 1 stays exactly as before: the first flood-day underwater. The deeper
 * bands are intentionally wider so a much larger share of the drowned world
 * remains navigable by skiff:
 *
 * - raw flood-day 1      -> depth 1
 * - raw flood-days 2..3 -> depth 2
 * - raw flood-days 4..6 -> depth 3
 * - raw flood-day 7+    -> depth 4 (the deep)
 */
export function floodDepth(elev: number, waterLevel: number): number {
  if (waterLevel <= elev) return 0;
  const floodDays = Math.max(1, Math.ceil((waterLevel - elev) / FLOOD_RISE_PER_DAY));
  if (floodDays === 1) return 1;
  if (floodDays <= 3) return 2;
  if (floodDays <= 6) return 3;
  return 4;
}

/**
 * Days for the runoff front to travel the length of the map.
 *
 * The gorge does not fill like a bathtub. It is rain coming off the high
 * ground, so the water arrives at the top of the channel and runs *down* it:
 * a front sweeping from the northern spring to the southern mouth. One day,
 * so it is something you watch happen the morning the rain begins rather than
 * a state the world was already in.
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
 * Held back through the prologue: the channel is a dry ditch until the rain
 * begins, then the front starts at the top of the map and reaches the mouth a
 * day later — the first thing on the map to say the weather has turned.
 * Sea level still applies on top: once the flood proper reaches the channel,
 * whichever is deeper wins.
 */
export function gorgeDepthAt(day: number, y: number, mapHeight: number): number {
  const raining = day - RAIN_DAY;
  if (raining <= 0) return 0;
  const front = (raining / GORGE_FILL_DAYS) * mapHeight;
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
 *   the day the rain begins and runs down it — so `runoff` is the depth for *this row*, not a
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
 * The flood underground.
 *
 * A dungeon is not immune: the rain drains into it and pools on the bottom
 * floor, then fills upward. Rooms are a single plane, so the **room row is
 * depth** — the bottom row is the deepest floor, the stairs are in the top
 * row, and the water climbs toward them.
 *
 * The clock is the mouth's own: dry through the prologue, then filling from
 * the bottom so that the last tile row goes under on the day the entrance
 * itself drowns. A low cave is a race over a couple of days; a mountain cave
 * fills over weeks. Either way the deadline is the one you can already see
 * from outside.
 */
export function dungeonFloodRows(day: number, mouthDrownDay: number, mapHeight: number): number {
  const raining = day - RAIN_DAY;
  if (raining <= 0) return 0;
  const window = mouthDrownDay - RAIN_DAY;
  if (window <= 0) return mapHeight;
  return Math.min(1, raining / window) * mapHeight;
}

/** Tile rows of ankle-deep water at the dungeon's waterline: the galoshes band. */
export const DUNGEON_SHALLOW_ROWS = 3;

/**
 * Standing water on one tile row of a dungeon, given how many rows the flood
 * covers. Depth 1 at the waterline, depth 2 (over your head) below it — no
 * skiff fits down the stairs, so 2 is as deep as a cave needs to get.
 */
export function dungeonDepthAt(ty: number, mapHeight: number, floodRows: number): number {
  const under = floodRows - (mapHeight - 1 - ty);
  if (under <= 0) return 0;
  return under <= DUNGEON_SHALLOW_ROWS ? 1 : 2;
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
