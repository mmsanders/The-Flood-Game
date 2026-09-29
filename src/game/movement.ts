/**
 * Moving the player's hitbox through the active map: per-axis collision,
 * corner sliding, and wading/submerged checks.
 */

import { BOAT_PORTAGE_SPEED_SCALE, BOAT_SPEED_SCALE } from '../core/boat.js';
import { TILE_PX } from '../core/config.js';
import { PLAYER_TILES_PER_SEC } from '../core/resources.js';
import { isWalkable, Tile } from '../core/tiles.js';
import { canStepOnEntrance } from './places.js';
import { activeMap, depthAt, isBoatableTile } from './queries.js';
import { maybeBeach, tryShoveOff } from './skiff.js';
import { Dir, type GameState, PLAYER_H, PLAYER_W, type StepInput } from './types.js';

const SPEED_PX = PLAYER_TILES_PER_SEC * TILE_PX;
const WADE_SPEED_SCALE = 0.55;

export function movePlayer(state: GameState, input: StepInput, dt: number): void {
  const p = state.player;
  let dx = input.moveX;
  let dy = input.moveY;

  if (dx !== 0 && dy !== 0) {
    const inv = Math.SQRT1_2;
    dx *= inv;
    dy *= inv;
  }

  p.moving = dx !== 0 || dy !== 0;
  if (p.moving) {
    p.animTime += dt;
    if (Math.abs(input.moveX) >= Math.abs(input.moveY)) {
      if (input.moveX > 0) p.dir = Dir.Right;
      else if (input.moveX < 0) p.dir = Dir.Left;
    } else if (input.moveY > 0) p.dir = Dir.Down;
    else if (input.moveY < 0) p.dir = Dir.Up;
  }

  const wading = !state.inBoat && hitboxInWater(state, p.x, p.y);
  const scale = state.inBoat
    ? BOAT_SPEED_SCALE
    : state.haulingBoat
      ? BOAT_PORTAGE_SPEED_SCALE
      : wading
        ? WADE_SPEED_SCALE
        : 1;
  const speed = SPEED_PX * scale * dt;

  moveAxis(state, dx * speed, 0);
  moveAxis(state, 0, dy * speed);
}

function moveAxis(state: GameState, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;

  if (canOccupy(state, nx, ny)) {
    p.x = nx;
    p.y = ny;
    maybeBeach(state);
    return;
  }

  if (tryShoveOff(state, nx, ny)) return;

  const steps = 4;
  for (let i = steps - 1; i > 0; i--) {
    const tx = p.x + (dx * i) / steps;
    const ty = p.y + (dy * i) / steps;
    if (canOccupy(state, tx, ty)) {
      p.x = tx;
      p.y = ty;
      return;
    }
  }
}

/** Can the hitbox sit here? Checks the four corners against terrain. */
function canOccupy(state: GameState, x: number, y: number): boolean {
  const sailing = state.inBoat && state.location.kind === 'overworld';
  return (
    cornerClear(state, x, y, sailing) &&
    cornerClear(state, x + PLAYER_W - 1, y, sailing) &&
    cornerClear(state, x, y + PLAYER_H - 1, sailing) &&
    cornerClear(state, x + PLAYER_W - 1, y + PLAYER_H - 1, sailing)
  );
}

/** One corner of the hitbox against terrain and floodwater. */
function cornerClear(state: GameState, cx: number, cy: number, sailing: boolean): boolean {
  const map = activeMap(state);
  const tx = Math.floor(cx / TILE_PX);
  const ty = Math.floor(cy / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;

  const i = ty * map.w + tx;
  const tile = map.tiles[i];
  const depth = depthAt(state, tx, ty);
  const flooded = depth > 0;
  const alreadyOn = hitboxOverlapsTile(state.player.x, state.player.y, tx, ty);

  if (sailing && isBoatableTile(state, tx, ty)) return true;
  if (tile === Tile.DungeonEntrance) {
    if (flooded && !sailing) return alreadyOn;
    return canStepOnEntrance(state, tx, ty) || alreadyOn;
  }

  // Depth one is the galoshes rung. The gorge is normally impassable terrain,
  // but once its bed is covered ankle-deep the boots can take it deliberately.
  if (flooded && !sailing) {
    if (state.hasGaloshes && depth === 1 && (isWalkable(tile) || tile === Tile.Gorge)) {
      return true;
    }
    // If the flood rose under Noah, let him move within that tile to escape,
    // but never advance from one unsafe flooded tile into another.
    return alreadyOn;
  }

  if (!isWalkable(tile)) return alreadyOn;
  return true;
}

/** True if the hitbox at (px, py) covers any pixel of tile (tx, ty). */
function hitboxOverlapsTile(px: number, py: number, tx: number, ty: number): boolean {
  const x1 = px + PLAYER_W - 1;
  const y1 = py + PLAYER_H - 1;
  const tx0 = tx * TILE_PX;
  const ty0 = ty * TILE_PX;
  const tx1 = tx0 + TILE_PX - 1;
  const ty1 = ty0 + TILE_PX - 1;
  return x1 >= tx0 && px <= tx1 && y1 >= ty0 && py <= ty1;
}

/** True if any part of the hitbox is standing in floodwater. */
function hitboxInWater(state: GameState, x: number, y: number): boolean {
  return (
    isSubmergedAt(state, x + PLAYER_W / 2, y + PLAYER_H / 2) ||
    isSubmergedAt(state, x, y) ||
    isSubmergedAt(state, x + PLAYER_W - 1, y) ||
    isSubmergedAt(state, x, y + PLAYER_H - 1) ||
    isSubmergedAt(state, x + PLAYER_W - 1, y + PLAYER_H - 1)
  );
}

function isSubmergedAt(state: GameState, pxX: number, pxY: number): boolean {
  return depthAt(state, Math.floor(pxX / TILE_PX), Math.floor(pxY / TILE_PX)) > 0;
}
