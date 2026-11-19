/**
 * The weather: the dry prologue, and the moment the rain begins.
 *
 * The water level itself lives in `core/flood.ts`, which is all the rules
 * read. This module is the part the player *feels*: the banner when the
 * prologue ends, the voice that goes with it, and how far the light has
 * turned grey, which the renderer reads every frame.
 */

import { isRaining, RAIN_DAY } from '../core/flood.js';
import { currentDay } from './queries.js';
import type { GameState } from './types.js';

/** Seconds the banner holds the screen. Long enough to read twice. */
export const BANNER_TIME = 6;

export const RAIN_TITLE = 'THE RAIN BEGINS.';

/**
 * The voice from `DESIGN.md`, in the register of the King of All Cosmos:
 * lavish, brusque, faintly disappointed.
 */
export const RAIN_LINE = 'Five days of sunshine, Noah. We hope you enjoyed them. BUILD.';

/** Days over which the light cools once the rain starts. */
const GLOOM_RAMP_DAYS = 0.35;

/** Called once per simulation step. Fires the prologue's end exactly once. */
export function tickWeather(state: GameState, dt: number): void {
  if (state.bannerTimer > 0) {
    state.bannerTimer = Math.max(0, state.bannerTimer - dt);
    if (state.bannerTimer === 0) state.banner = null;
  }
  if (state.rainBegun || !isRaining(currentDay(state))) return;
  state.rainBegun = true;
  state.banner = { title: RAIN_TITLE, line: RAIN_LINE };
  state.bannerTimer = BANNER_TIME;
}

/**
 * How far into the rain the world is, 0 (the prologue's sunshine) to 1 (the
 * settled grey of the flood). Pure, so render and tests agree.
 */
export function gloomAt(day: number): number {
  const t = (day - RAIN_DAY) / GLOOM_RAMP_DAYS;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Days of dry weather left, or 0 once it is raining. For the HUD. */
export function dryDaysLeft(day: number): number {
  return Math.max(0, RAIN_DAY - day);
}
