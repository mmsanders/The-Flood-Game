/**
 * Every tunable number in one typed object.
 *
 * Worldgen takes a WorldParams and never reads globals, so the dev tool can
 * later expose sliders over these fields without any refactor. Defaults live
 * in DEFAULT_PARAMS; call `withParams` to override a subset.
 */

/** Panel dimensions, in tiles. Matches Zelda 1's 16x11 screen exactly. */
export const PANEL_W = 16;
export const PANEL_H = 11;

/** Rendered tile size, in pixels. 16x16 at 16-bit-ish fidelity. */
export const TILE_PX = 16;

/** Panel size in pixels: 256 x 176, again matching Zelda 1. */
export const PANEL_PX_W = PANEL_W * TILE_PX;
export const PANEL_PX_H = PANEL_H * TILE_PX;

/** Genesis 7:12 — forty days and forty nights. One map row per day. */
export const FLOOD_DAYS = 40;

export interface WorldParams {
  /** Map size in panels. Height should stay at FLOOD_DAYS. */
  panelsX: number;
  panelsY: number;

  /** Elevation field shape. */
  elevation: {
    /** How strongly latitude drives height (0 = pure noise, 1 = pure ramp). */
    gradientWeight: number;
    /** Lattice size of the base noise octave, in tiles. */
    scale: number;
    octaves: number;
    lacunarity: number;
    gain: number;
    /**
     * Applied to the normalised gradient before mixing. >1 flattens the south
     * lowlands and steepens the north, which keeps the last few days tense.
     */
    gradientExponent: number;
  };

  /**
   * Biome band edges as fractions of the elevation range, low to high.
   * Four biomes need three interior cut points.
   */
  biomeBands: [number, number, number];

  /** Per-biome density of blocking scenery (trees, rocks), 0..1. */
  scatterDensity: [number, number, number, number];

  /** Per-biome density of harvestable resource nodes, 0..1. */
  resourceDensity: [number, number, number, number];

  /** Roughly how many heart containers to scatter across the map. */
  heartContainers: number;

  /** Reserved dungeon entrances, one per biome (entered in a later milestone). */
  dungeonsPerBiome: number;

  /** Real seconds per in-game day. 40 days x this = full run length. */
  secondsPerDay: number;
}

export const DEFAULT_PARAMS: WorldParams = {
  panelsX: 12,
  panelsY: FLOOD_DAYS,

  elevation: {
    gradientWeight: 0.62,
    scale: 42,
    octaves: 5,
    lacunarity: 2.0,
    gain: 0.5,
    gradientExponent: 1.15,
  },

  // Tuned by sweep (scripts/survey.ts) for a roughly even four-way split:
  // ~24% valley, ~30% forest, ~26% scrub, ~21% mountain. Mountains stay the
  // smallest band on purpose — high ground should feel scarce.
  biomeBands: [0.28, 0.52, 0.72],

  //                 valley forest scrub mountain
  scatterDensity: [0.1, 0.3, 0.24, 0.32],

  // Tuned so each biome holds a few hundred nodes, not thousands: patches
  // should be worth finding, and worth returning to before they drown.
  resourceDensity: [0.012, 0.013, 0.012, 0.006],

  heartContainers: 6,
  dungeonsPerBiome: 1,

  // 40 days x 90s = a 60-minute run. Long enough for the flood to reshape the
  // map several times, short enough to lose and immediately try again.
  secondsPerDay: 90,
};

/** Shallow-merge an override into the defaults, one level deep on `elevation`. */
export function withParams(overrides: DeepPartial<WorldParams> = {}): WorldParams {
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    elevation: { ...DEFAULT_PARAMS.elevation, ...(overrides.elevation ?? {}) },
    biomeBands: (overrides.biomeBands ?? DEFAULT_PARAMS.biomeBands) as [number, number, number],
    scatterDensity: (overrides.scatterDensity ??
      DEFAULT_PARAMS.scatterDensity) as [number, number, number, number],
    resourceDensity: (overrides.resourceDensity ??
      DEFAULT_PARAMS.resourceDensity) as [number, number, number, number],
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

/** Tile-grid dimensions implied by a params object. */
export function tileWidth(p: WorldParams): number {
  return p.panelsX * PANEL_W;
}

export function tileHeight(p: WorldParams): number {
  return p.panelsY * PANEL_H;
}
