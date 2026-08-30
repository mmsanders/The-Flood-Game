/**
 * Tile vocabulary.
 *
 * Every tile is one 8-bit number. IDs are grouped so the ranges stay readable
 * in a hex dump: 0x00 terrain, 0x10 resource nodes, 0x20 points of interest.
 * Never renumber an existing tile — the dev tool's byte dumps and any saved
 * seeds assume these values are stable.
 */

export const enum Tile {
  // -- 0x00 terrain ---------------------------------------------------------
  Grass = 0x00,
  Dirt = 0x01,
  Sand = 0x02,
  TallGrass = 0x03,
  Crop = 0x04,
  Path = 0x05,
  Gravel = 0x06,
  StoneGround = 0x07,
  Snow = 0x08,
  Reed = 0x09,

  // -- 0x10 blocking scenery ------------------------------------------------
  Tree = 0x10,
  Shrub = 0x11,
  Rock = 0x12,
  Cliff = 0x13,
  Water = 0x14,

  // -- 0x20 resource nodes --------------------------------------------------
  Flax = 0x20,
  GopherTree = 0x21,
  StoneNode = 0x22,
  PitchSeep = 0x23,

  // -- 0x30 points of interest ----------------------------------------------
  ArkSite = 0x30,
  DungeonEntrance = 0x31,
  HeartContainer = 0x32,
  TownDoor = 0x33,

  // -- 0x40 dungeon terrain -------------------------------------------------
  DungeonFloor = 0x40,
  DungeonWall = 0x41,
  Stairs = 0x42,
  /** Built over a chasm, at the cost of gopher wood. */
  Bridge = 0x43,
  /** Rigged across a ledge, at the cost of fiber. */
  Rope = 0x44,
  DoorOpen = 0x45,

  // -- 0x50 dungeon obstacles (blocking, clearable) -------------------------
  Chasm = 0x50,
  Ledge = 0x51,
  DoorLocked = 0x52,

  /**
   * Walkable, unlike the obstacles above — a pit is a trap rather than a gate.
   * Step in one and it costs a heart and spits you back out.
   */
  Pit = 0x53,

  // -- 0x60 dungeon pickups -------------------------------------------------
  Key = 0x60,
  Chest = 0x61,
}

export const enum Biome {
  Valley = 0,
  Forest = 1,
  Scrub = 2,
  Mountain = 3,
}

export const BIOME_COUNT = 4;

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Valley]: 'Valley',
  [Biome.Forest]: 'Forest',
  [Biome.Scrub]: 'Scrubland',
  [Biome.Mountain]: 'High Mountain',
};

export const enum Resource {
  Fiber = 0,
  Wood = 1,
  Stone = 2,
  Pitch = 3,
}

export const RESOURCE_COUNT = 4;

export const RESOURCE_NAMES: Record<Resource, string> = {
  [Resource.Fiber]: 'Fiber',
  [Resource.Wood]: 'Gopher Wood',
  [Resource.Stone]: 'Stone',
  [Resource.Pitch]: 'Pitch',
};

/** The resource node native to each biome. Index by Biome. */
export const BIOME_RESOURCE_TILE = [
  Tile.Flax,
  Tile.GopherTree,
  Tile.StoneNode,
  Tile.PitchSeep,
] as const;

/** Which resource a node tile yields, or null if it isn't a node. */
export function resourceOf(tile: number): Resource | null {
  switch (tile) {
    case Tile.Flax:
      return Resource.Fiber;
    case Tile.GopherTree:
      return Resource.Wood;
    case Tile.StoneNode:
      return Resource.Stone;
    case Tile.PitchSeep:
      return Resource.Pitch;
    default:
      return null;
  }
}

export function isResourceNode(tile: number): boolean {
  return tile >= Tile.Flax && tile <= Tile.PitchSeep;
}

/**
 * Tiles the player cannot stand on, declared rather than inferred from where
 * their ID happens to fall.
 *
 * Resource nodes block movement — you harvest them from an adjacent tile,
 * which is what makes a node inside a thicket genuinely awkward to reach.
 * POI and pickup tiles stay walkable so stepping on them can trigger.
 */
const BLOCKING: readonly Tile[] = [
  Tile.Tree,
  Tile.Shrub,
  Tile.Rock,
  Tile.Cliff,
  Tile.Water,

  Tile.Flax,
  Tile.GopherTree,
  Tile.StoneNode,
  Tile.PitchSeep,

  Tile.DungeonWall,

  Tile.Chasm,
  Tile.Ledge,
  Tile.DoorLocked,
];

/**
 * A 256-entry lookup built once at module load. A range check would silently
 * mis-classify the next tile group added above it; this cannot.
 */
const WALKABLE = (() => {
  const table = new Uint8Array(256).fill(1);
  for (const tile of BLOCKING) table[tile] = 0;
  return table;
})();

/** Can the player stand here, ignoring floodwater? */
export function isWalkable(tile: number): boolean {
  return WALKABLE[tile & 0xff] === 1;
}

/** Obstacles that can be cleared by spending ark material. */
export function isClearableObstacle(tile: number): boolean {
  return tile === Tile.Chasm || tile === Tile.Ledge || tile === Tile.DoorLocked;
}

export function isDungeonTile(tile: number): boolean {
  return tile >= Tile.DungeonFloor && tile <= Tile.Chest;
}

/** Blocking scenery that worldgen may carve away to restore connectivity. */
export function isCarvable(tile: number): boolean {
  return tile === Tile.Tree || tile === Tile.Shrub || tile === Tile.Rock;
}

/** The ground tile to leave behind when carving a path through scenery. */
export function carveTo(biome: Biome): Tile {
  switch (biome) {
    case Biome.Valley:
      return Tile.Grass;
    case Biome.Forest:
      return Tile.Grass;
    case Biome.Scrub:
      return Tile.Gravel;
    case Biome.Mountain:
      return Tile.StoneGround;
  }
}

export const TILE_NAMES: Record<number, string> = {
  [Tile.Grass]: 'Grass',
  [Tile.Dirt]: 'Dirt',
  [Tile.Sand]: 'Sand',
  [Tile.TallGrass]: 'Tall Grass',
  [Tile.Crop]: 'Crop',
  [Tile.Path]: 'Path',
  [Tile.Gravel]: 'Gravel',
  [Tile.StoneGround]: 'Stone',
  [Tile.Snow]: 'Snow',
  [Tile.Reed]: 'Reeds',
  [Tile.Tree]: 'Tree',
  [Tile.Shrub]: 'Shrub',
  [Tile.Rock]: 'Rock',
  [Tile.Cliff]: 'Cliff',
  [Tile.Water]: 'Water',
  [Tile.Flax]: 'Flax',
  [Tile.GopherTree]: 'Gopher Tree',
  [Tile.StoneNode]: 'Stone Node',
  [Tile.PitchSeep]: 'Pitch Seep',
  [Tile.ArkSite]: 'Ark Site',
  [Tile.DungeonEntrance]: 'Dungeon',
  [Tile.HeartContainer]: 'Heart Container',
  [Tile.TownDoor]: 'Town',
  [Tile.DungeonFloor]: 'Dungeon Floor',
  [Tile.DungeonWall]: 'Dungeon Wall',
  [Tile.Stairs]: 'Stairs',
  [Tile.Bridge]: 'Plank Bridge',
  [Tile.Rope]: 'Rope',
  [Tile.DoorOpen]: 'Open Door',
  [Tile.Chasm]: 'Chasm',
  [Tile.Ledge]: 'Ledge',
  [Tile.DoorLocked]: 'Locked Door',
  [Tile.Pit]: 'Pit',
  [Tile.Key]: 'Key',
  [Tile.Chest]: 'Chest',
};

export function tileName(tile: number): string {
  return TILE_NAMES[tile] ?? `Unknown 0x${tile.toString(16).padStart(2, '0')}`;
}
