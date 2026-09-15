/**
 * Time of day.
 *
 * Colour: unfiltered daylight 5%–95%, pink dusk into night, orange dawn
 * back. Shadow length follows the sun from dawn to dusk (gone at noon).
 * At the night wrap the throw stays long and only the opacity fades.
 */

export interface Tod {
  mulR: number;
  mulG: number;
  mulB: number;
  /** Horizontal shadow throw in pixels. 0 means none (noon). */
  shadowDx: number;
  /** 0 at night, 1 through the day. Fades at the night wrap only. */
  shadowAlpha: number;
}

type Rgb = readonly [number, number, number];

const NIGHT_MUL: Rgb = [138, 152, 210];
const MORNING_MUL: Rgb = [255, 164, 88];
const DAY_MUL: Rgb = [255, 255, 255];
const TWILIGHT_MUL: Rgb = [255, 148, 186];

const DAWN_PEAK = 0.025;
const DAY_START = 0.05;
const NOON = 0.5;
const DAY_END = 0.95;
const DUSK_PEAK = 0.975;

/** Longest ground-shadow, in pixels, at peak dawn and peak dusk. */
const SHADOW_MAX = 8;

/** Fractional progress through the current day, in [0, 1). */
export function dayFraction(day: number): number {
  const t = day - Math.floor(day);
  return t < 0 ? t + 1 : t;
}

export function todAt(day: number): Tod {
  const t = dayFraction(day);
  const { dx, alpha } = shadowAt(t);
  if (t < DAWN_PEAK) return mixColor(NIGHT_MUL, MORNING_MUL, t / DAWN_PEAK, dx, alpha);
  if (t < DAY_START) {
    return mixColor(MORNING_MUL, DAY_MUL, (t - DAWN_PEAK) / (DAY_START - DAWN_PEAK), dx, alpha);
  }
  if (t < DAY_END) return pack(DAY_MUL, dx, alpha);
  if (t < DUSK_PEAK) {
    return mixColor(DAY_MUL, TWILIGHT_MUL, (t - DAY_END) / (DUSK_PEAK - DAY_END), dx, alpha);
  }
  return mixColor(TWILIGHT_MUL, NIGHT_MUL, (t - DUSK_PEAK) / (1 - DUSK_PEAK), dx, alpha);
}

/**
 * Length follows the sun from peak dawn to peak dusk. On the night wrap
 * the throw stays at max and only alpha eases out.
 */
function shadowAt(t: number): { dx: number; alpha: number } {
  if (t <= 0 || t >= 1) return { dx: 0, alpha: 0 };
  if (t < DAWN_PEAK) {
    return { dx: -SHADOW_MAX, alpha: smoothstep(t / DAWN_PEAK) };
  }
  if (t <= NOON) {
    return { dx: -SHADOW_MAX * (1 - (t - DAWN_PEAK) / (NOON - DAWN_PEAK)), alpha: 1 };
  }
  if (t <= DUSK_PEAK) {
    return { dx: SHADOW_MAX * ((t - NOON) / (DUSK_PEAK - NOON)), alpha: 1 };
  }
  return { dx: SHADOW_MAX, alpha: 1 - smoothstep((t - DUSK_PEAK) / (1 - DUSK_PEAK)) };
}

function smoothstep(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}

function pack(mul: Rgb, shadowDx: number, shadowAlpha: number): Tod {
  return { mulR: mul[0], mulG: mul[1], mulB: mul[2], shadowDx, shadowAlpha };
}

function mixColor(a: Rgb, b: Rgb, u: number, shadowDx: number, shadowAlpha: number): Tod {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  const t = x * x * (3 - 2 * x);
  return {
    mulR: a[0] + (b[0] - a[0]) * t,
    mulG: a[1] + (b[1] - a[1]) * t,
    mulB: a[2] + (b[2] - a[2]) * t,
    shadowDx,
    shadowAlpha,
  };
}

export function isDaylight(tod: Tod): boolean {
  return tod.mulR >= 254 && tod.mulG >= 254 && tod.mulB >= 254;
}
