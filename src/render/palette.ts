/**
 * The palette.
 *
 * A deliberately small, fixed set of colours in the NES/early-16-bit register:
 * saturated, flat, high contrast. Everything the game and the dev tool draw
 * comes from here, so retuning the look is a single-file change.
 */

export const PALETTE = {
  // Ground
  grass: '#4a9e34',
  grassAlt: '#3d8a2a',
  tallGrass: '#2f7a22',
  dirt: '#a9743c',
  crop: '#c9a227',
  sand: '#d8c48a',
  path: '#c2a878',
  gravel: '#8b8578',
  stoneGround: '#7a7568',
  snow: '#e8eef2',
  reed: '#5c8f4a',

  // Blocking scenery
  tree: '#1d5e1a',
  treeTrunk: '#5a3a1c',
  shrub: '#2c7a3a',
  rock: '#6b6459',
  rockShade: '#4e4840',
  cliff: '#514b42',
  cliffShade: '#39342e',

  // Resources
  flax: '#d9d05a',
  gopher: '#7a4a1e',
  stoneNode: '#9aa0a6',
  pitch: '#241f1c',

  // Points of interest
  ark: '#b5732c',
  dungeon: '#1a1420',
  heart: '#d63a3a',
  town: '#c56a2e',

  // Water and flood
  water: '#2b6cb0',
  waterDeep: '#1c4a80',
  waterShallow: '#4a8fd0',
  floodTint: 'rgba(30, 90, 170, 0.62)',

  // UI
  ink: '#1a1a20',
  paper: '#efe6d2',
  hudBack: 'rgba(12, 12, 18, 0.82)',
  outline: '#0f0f14',
} as const;

/**
 * One representative colour per tile, for the dev tool's zoomed-out world map
 * where a tile is a single pixel and there's no room for a sprite.
 */
export const TILE_COLOR: Record<number, string> = {
  0x00: PALETTE.grass,
  0x01: PALETTE.dirt,
  0x02: PALETTE.sand,
  0x03: PALETTE.tallGrass,
  0x04: PALETTE.crop,
  0x05: PALETTE.path,
  0x06: PALETTE.gravel,
  0x07: PALETTE.stoneGround,
  0x08: PALETTE.snow,
  0x09: PALETTE.reed,

  0x10: PALETTE.tree,
  0x11: PALETTE.shrub,
  0x12: PALETTE.rock,
  0x13: PALETTE.cliff,
  0x14: PALETTE.water,

  0x20: PALETTE.flax,
  0x21: PALETTE.gopher,
  0x22: PALETTE.stoneNode,
  0x23: PALETTE.pitch,

  0x30: PALETTE.ark,
  0x31: PALETTE.dungeon,
  0x32: PALETTE.heart,
  0x33: PALETTE.town,
};

export function tileColor(tile: number): string {
  return TILE_COLOR[tile] ?? '#ff00ff';
}

/** Per-biome tint used by the dev tool's biome overlay. */
export const BIOME_COLORS = ['#7fbf4f', '#2f7d38', '#b0a06a', '#e2e6ea'] as const;

/** Elevation heatmap ramp, low to high. */
export const ELEVATION_RAMP = [
  '#0d2b45',
  '#1f5673',
  '#3d8a7a',
  '#6fb15c',
  '#c3c04a',
  '#d08a3a',
  '#b5533a',
  '#f2eee6',
] as const;

export function elevationColor(elev: number): string {
  const t = Math.max(0, Math.min(255, elev)) / 255;
  const i = Math.min(ELEVATION_RAMP.length - 1, Math.floor(t * ELEVATION_RAMP.length));
  return ELEVATION_RAMP[i];
}
