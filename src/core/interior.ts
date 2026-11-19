/**
 * One-room interiors: shop, hermit, carpenter, Noah's tent.
 *
 * Same contract as a one-panel dungeon room — enter from the south on the
 * overworld mouth, stairs back out — so the renderer, camera and warp logic
 * need no second room system. The focus tile is where barter / craft / trade
 * happens once you are inside.
 */

import { PANEL_H, PANEL_W } from './config.js';
import { blankPlanes } from './tilemap.js';
import type { TileMap } from './tilemap.js';
import { Biome, Tile } from './tiles.js';
import type { Point } from './world.js';

export const enum InteriorKind {
  Shop = 0,
  Hermit = 1,
  Carpenter = 2,
  NoahTent = 3,
  /** One per town. Rumours at the counter, rest by the fire. Wave 7. */
  Tavern = 4,
}

export const INTERIOR_NAMES: Record<InteriorKind, string> = {
  [InteriorKind.Shop]: 'the market',
  [InteriorKind.Hermit]: 'the hermitage',
  [InteriorKind.Carpenter]: 'the carpenter',
  [InteriorKind.NoahTent]: 'your tent',
  [InteriorKind.Tavern]: 'the tavern',
};

export interface Interior extends TileMap {
  id: number;
  kind: InteriorKind;
  biomeKind: Biome;
  stairs: Point;
  overworldEntrance: Point;
  /** Where interact runs the room's action (counter, hearth, workbench). */
  focus: Point;
  /**
   * A second spot to stand and press E: beside someone with something to
   * say. Only the carpenter's has one — the stranger from the sand.
   */
  lore: Point | null;
}

/**
 * One panel, walls, a focus, and stairs. The overworld mouth warps here;
 * walking onto the stairs warps back.
 */
export function generateInterior(
  kind: InteriorKind,
  id: number,
  biome: Biome,
  overworldEntrance: Point,
): Interior {
  const w = PANEL_W;
  const h = PANEL_H;
  const planes = blankPlanes(w, h, { tile: Tile.DungeonWall, elev: 255, biome });

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      planes.tiles[y * w + x] = Tile.DungeonFloor;
    }
  }

  const stairs = { x: (w / 2) | 0, y: h - 2 };
  const focus = { x: (w / 2) | 0, y: 3 };
  planes.tiles[stairs.y * w + stairs.x] = Tile.Stairs;
  planes.tiles[focus.y * w + focus.x] = focusTile(kind);

  // Soft furnishings so the room reads as a place rather than a cave.
  if (kind === InteriorKind.Shop || kind === InteriorKind.Hermit) {
    planes.tiles[focus.y * w + focus.x - 2] = Tile.House;
    planes.tiles[focus.y * w + focus.x + 2] = Tile.House;
  } else if (kind === InteriorKind.Carpenter) {
    planes.tiles[focus.y * w + focus.x - 2] = Tile.Path;
    planes.tiles[focus.y * w + focus.x + 2] = Tile.Path;
    // A stranger warming himself by the shavings, and the mat beside him.
    planes.tiles[STRANGER.y * w + STRANGER.x] = Tile.Stranger;
    planes.tiles[(STRANGER.y + 1) * w + STRANGER.x] = Tile.Sand;
  } else if (kind === InteriorKind.Tavern) {
    // Barrels behind the counter, the hearth on the west wall with a mat
    // before it, tables down the room.
    planes.tiles[(focus.y - 1) * w + focus.x - 2] = Tile.Pots;
    planes.tiles[(focus.y - 1) * w + focus.x + 2] = Tile.Pots;
    planes.tiles[HEARTH.y * w + HEARTH.x] = Tile.Kiln;
    planes.tiles[(HEARTH.y + 1) * w + HEARTH.x] = Tile.Sand;
    planes.tiles[6 * w + 10] = Tile.Stall;
    planes.tiles[6 * w + 12] = Tile.Stall;
  } else {
    planes.tiles[2 * w + 3] = Tile.Tent;
    planes.tiles[2 * w + (w - 4)] = Tile.Tent;
  }

  return {
    id,
    kind,
    biomeKind: biome,
    w,
    h,
    ...planes,
    floods: false,
    stairs,
    overworldEntrance,
    focus,
    lore:
      kind === InteriorKind.Carpenter
        ? { x: STRANGER.x, y: STRANGER.y + 1 }
        : kind === InteriorKind.Tavern
          ? { x: HEARTH.x, y: HEARTH.y + 1 }
          : null,
  };
}

/** Where the stranger sits in the carpenter's workshop. */
const STRANGER = { x: 12, y: 5 } as const;

/** The tavern's hearth, with the mat to rest on below it. */
const HEARTH = { x: 3, y: 5 } as const;

function focusTile(kind: InteriorKind): Tile {
  switch (kind) {
    case InteriorKind.Shop:
      return Tile.TownDoor;
    case InteriorKind.Hermit:
      return Tile.TownDoor;
    case InteriorKind.Carpenter:
      return Tile.BoatYard;
    case InteriorKind.NoahTent:
      return Tile.Path;
    case InteriorKind.Tavern:
      return Tile.TavernDoor;
  }
}

/** Overworld tiles that open into a Wave-three interior. */
export function isInteriorEntrance(tile: number): boolean {
  return (
    tile === Tile.TownDoor ||
    tile === Tile.TavernDoor ||
    tile === Tile.BoatYard ||
    tile === Tile.CampTent
  );
}
