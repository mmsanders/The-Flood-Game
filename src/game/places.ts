/**
 * Moving between maps: entering and leaving settlement interiors, and
 * warping into and out of caves.
 */

import { TILE_PX } from '../core/config.js';
import {
  type Interior,
  INTERIOR_NAMES,
  InteriorKind,
  isInteriorEntrance,
} from '../core/interior.js';
import { isWalkable, Tile } from '../core/tiles.js';
import type { Point } from '../core/world.js';
import { placeOn } from './camera.js';
import { activeMap, currentInterior, depthAt, say, tileUnder } from './queries.js';
import { boatYardPrompt, handleBoatYard } from './skiff.js';
import { hermitPrompt, interactSettlement, settlementPrompt, tradeWithHermit } from './trade.js';
import {
  type Action,
  Dir,
  type GameState,
  type ObstaclePrompt,
  PLAYER_H,
  PLAYER_W,
} from './types.js';

/** Distinct tiles covered by the player hitbox, without allocating. */
const HITBOX_SAMPLES = 6;

const hitboxScratch = new Int32Array(HITBOX_SAMPLES);

function entrancePrompt(state: GameState, tile: Tile): ObstaclePrompt {
  const { tx, ty } = tileUnder(state);
  const room = findInteriorAtTile(state, tx, ty);
  if (!room) {
    return { tile, label: 'A closed door.', affordable: false };
  }
  return {
    tile,
    label: `Enter ${INTERIOR_NAMES[room.kind]}`,
    affordable: depthAt(state, tx, ty) <= 0,
  };
}

function interiorPrompt(state: GameState): ObstaclePrompt | null {
  const room = currentInterior(state);
  if (!room) return null;
  const { tx, ty } = tileUnder(state);
  const onFocus = tx === room.focus.x && ty === room.focus.y;
  if (!onFocus) return null;

  if (room.kind === InteriorKind.Shop) {
    return settlementPrompt(state, room.biomeKind);
  }
  if (room.kind === InteriorKind.Hermit) {
    return hermitPrompt(state);
  }
  if (room.kind === InteriorKind.Carpenter) {
    return boatYardPrompt(state, room.biomeKind);
  }
  return {
    tile: Tile.Path,
    label: 'Your tent. Rest, then build.',
    affordable: true,
  };
}

function interactInterior(state: GameState): void {
  const room = currentInterior(state);
  if (!room) return;
  const { tx, ty } = tileUnder(state);
  if (tx !== room.focus.x || ty !== room.focus.y) {
    say(state, 'The stairs lead back outside.');
    return;
  }
  if (room.kind === InteriorKind.Shop) {
    interactSettlement(state, room.biomeKind);
    return;
  }
  if (room.kind === InteriorKind.Hermit) {
    tradeWithHermit(state);
    return;
  }
  if (room.kind === InteriorKind.Carpenter) {
    handleBoatYard(state, room.biomeKind);
    return;
  }
  say(state, 'Canvas and rope. Home, until the rain.');
}

/** Inside a building, E always belongs to the room — even off the counter. */
export function interiorAction(state: GameState): Action | null {
  if (state.location.kind !== 'interior') return null;
  return { prompt: interiorPrompt(state), run: useInterior };
}

function useInterior(state: GameState): boolean {
  interactInterior(state);
  return true;
}

/** A doorway with a room behind it: step inside. */
export function entranceAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld') return null;
  const { map, tx, ty, i } = tileUnder(state);
  const standing = map.tiles[i] as Tile;
  if (!isInteriorEntrance(standing) || !findInteriorAtTile(state, tx, ty)) return null;
  return { prompt: entrancePrompt(state, standing), run: enterHere };
}

function enterHere(state: GameState): boolean {
  const { tx, ty } = tileUnder(state);
  enterInteriorAt(state, tx, ty);
  return true;
}

function findInteriorAtTile(state: GameState, tx: number, ty: number): Interior | null {
  const list = state.world.interiors ?? [];
  for (const room of list) {
    if (room.overworldEntrance.x === tx && room.overworldEntrance.y === ty) return room;
  }
  return null;
}

function enterInteriorAt(state: GameState, tx: number, ty: number): void {
  if (state.location.kind !== 'overworld') return;
  if (depthAt(state, tx, ty) > 0) return;

  const room = findInteriorAtTile(state, tx, ty);
  if (!room) return;
  if (state.haulingBoat && room.kind !== InteriorKind.Carpenter) {
    say(state, 'The skiff will not fit through the door. Set it down first.');
    return;
  }

  state.location = {
    kind: 'interior',
    dungeonId: -1,
    interiorId: room.id,
    returnTo: { x: tx, y: ty },
  };
  state.safeSpot = null;
  state.inBoat = false;
  placeOn(state, { x: room.stairs.x, y: Math.max(1, room.stairs.y - 1) });
  state.player.dir = Dir.Up;
  say(state, `Inside ${INTERIOR_NAMES[room.kind]}.`);
}

function exitInterior(state: GameState): void {
  const back = state.location.returnTo;
  if (state.location.kind !== 'interior' || !back) return;

  state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
  state.safeSpot = null;
  placeOn(state, exitSpot(state, back));
  state.player.dir = Dir.Down;
  say(state, 'Back into the open air.');
}

/** Cave mouths are solid from west, north and east. You step in from the south. */
export function canStepOnEntrance(state: GameState, tx: number, ty: number): boolean {
  const cx = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const cy = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  if (cx === tx && cy === ty) return true;
  return cy > ty;
}

function hitboxTiles(state: GameState): number {
  const p = state.player;
  const map = activeMap(state);
  let n = 0;

  for (let s = 0; s < HITBOX_SAMPLES; s++) {
    const px =
      s === 4 || s === 5 ? p.x + PLAYER_W / 2 : s & 1 ? p.x + PLAYER_W - 1 : p.x;
    const py =
      s === 5 ? p.y + PLAYER_H / 2 : s === 4 ? p.y : s & 2 ? p.y + PLAYER_H - 1 : p.y;

    const tx = Math.floor(px / TILE_PX);
    const ty = Math.floor(py / TILE_PX);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;

    const k = ty * map.w + tx;
    let seen = false;
    for (let j = 0; j < n; j++) {
      if (hitboxScratch[j] === k) {
        seen = true;
        break;
      }
    }
    if (!seen) hitboxScratch[n++] = k;
  }

  return n;
}

/** Touching a mouth from the south goes in; touching the stairs comes out. */
export function maybeDungeonWarp(state: GameState): void {
  if (state.phase !== 'playing') return;
  const map = activeMap(state);
  const n = hitboxTiles(state);

  if (state.location.kind === 'overworld') {
    for (let j = 0; j < n; j++) {
      const i = hitboxScratch[j];
      const tile = map.tiles[i];
      const tx = i % map.w;
      const ty = (i / map.w) | 0;
      if (!canStepOnEntrance(state, tx, ty)) continue;
      if (tile === Tile.DungeonEntrance) {
        enterDungeonAt(state, tx, ty);
        return;
      }
      if (isInteriorEntrance(tile)) {
        enterInteriorAt(state, tx, ty);
        return;
      }
    }
    return;
  }

  for (let j = 0; j < n; j++) {
    if (map.tiles[hitboxScratch[j]] === Tile.Stairs) {
      if (state.location.kind === 'interior') exitInterior(state);
      else exitDungeon(state);
      return;
    }
  }
}

function enterDungeonAt(state: GameState, tx: number, ty: number): void {
  if (state.location.kind !== 'overworld') return;
  if (state.haulingBoat) {
    say(state, 'The skiff will not fit below. Set it down first.');
    return;
  }

  const dungeon = state.world.dungeons.find(
    (d) => d.overworldEntrance.x === tx && d.overworldEntrance.y === ty,
  );
  if (!dungeon) return;

  if (depthAt(state, tx, ty) > 0) return;

  state.location = {
    kind: 'dungeon',
    dungeonId: dungeon.id,
    interiorId: -1,
    returnTo: { x: tx, y: ty },
  };
  state.keysHeld = 0;
  state.safeSpot = null;
  state.inBoat = false;
  placeOn(state, { x: dungeon.stairs.x, y: Math.max(1, dungeon.stairs.y - 1) });
  state.player.dir = Dir.Up;
  say(state, 'Down into the dark. The water does not wait.');
}

function exitDungeon(state: GameState): void {
  const back = state.location.returnTo;
  if (state.location.kind !== 'dungeon' || !back) return;

  state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
  state.keysHeld = 0;
  state.safeSpot = null;
  placeOn(state, exitSpot(state, back));
  state.player.dir = Dir.Down;
  say(state, 'Daylight. Or what is left of it.');
}

/** South of the mouth, so the next step does not fall back in. */
function exitSpot(state: GameState, entrance: Point): Point {
  const map = state.world;
  const spots = [
    { x: entrance.x, y: entrance.y + 1 },
    { x: entrance.x - 1, y: entrance.y + 1 },
    { x: entrance.x + 1, y: entrance.y + 1 },
    { x: entrance.x - 1, y: entrance.y },
    { x: entrance.x + 1, y: entrance.y },
  ];
  for (const p of spots) {
    if (p.x < 0 || p.y < 0 || p.x >= map.w || p.y >= map.h) continue;
    const tile = map.tiles[p.y * map.w + p.x];
    if (tile === Tile.DungeonEntrance) continue;
    if (isWalkable(tile)) return p;
  }
  return { x: entrance.x, y: entrance.y + 1 };
}
