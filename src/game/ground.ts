/**
 * What the ground does: tiles that act when stepped on (keys, chests, pits),
 * and obstacles cleared with E.
 *
 * The locked-door and chasm/ledge toll branches in `obstacleInFront` and
 * `tryClear` are dormant: only the multi-room dungeon generator places those
 * tiles, and it is unused until Wave 5 floods dungeons and revives it.
 */

import { TILE_PX } from '../core/config.js';
import { OBSTACLE_CLEARS_TO, OBSTACLE_COST, REWARD_NAMES, RewardKind } from '../core/dungeon.js';
import type { TileMap } from '../core/tilemap.js';
import { isWalkable, Resource, Tile } from '../core/tiles.js';
import { syncInterpolation } from './camera.js';
import {
  activeMap,
  currentDungeon,
  facingTile,
  RESOURCE_LABEL,
  say,
  tileUnder,
} from './queries.js';
import { damage, deliverToArk } from './run.js';
import { type GameState, type ObstaclePrompt, PLAYER_H, PLAYER_W } from './types.js';

/** Tiles converted in one clear. Generous enough for any doorway band. */
const CLEAR_LIMIT = 32;

function sealResourceOf(tile: number): Resource | null {
  switch (tile) {
    case Tile.ReedSeal:
      return Resource.Fiber;
    case Tile.WoodSeal:
      return Resource.Wood;
    case Tile.StoneSeal:
      return Resource.Stone;
    case Tile.PitchSeal:
      return Resource.Pitch;
    default:
      return null;
  }
}

export function stepTileEffects(state: GameState): void {
  const map = activeMap(state);
  const { player } = state;
  const tx = Math.floor((player.x + PLAYER_W / 2) / TILE_PX);
  const ty = Math.floor((player.y + PLAYER_H / 2) / TILE_PX);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;

  const i = ty * map.w + tx;

  switch (map.tiles[i]) {
    // Kept for tests/hand-authored spaces; generated overworld hearts are
    // stripped by createGame, so live hearts are now earned rather than found.
    case Tile.HeartContainer: {
      map.tiles[i] = Tile.Pedestal;
      state.mapRevision++;
      player.maxHearts++;
      player.hearts = player.maxHearts;
      state.heartsFound++;
      say(state, 'A heart container! Thy vessel is enlarged.');
      break;
    }
    case Tile.ArkSite:
      deliverToArk(state);
      break;
    case Tile.Key:
      map.tiles[i] = Tile.DungeonFloor;
      state.mapRevision++;
      state.keysHeld++;
      say(state, 'A key. Something here is locked.');
      break;
    case Tile.Chest:
      map.tiles[i] = Tile.DungeonFloor;
      state.mapRevision++;
      openChest(state);
      break;
    case Tile.Pit:
      fallInPit(state);
      break;
    default:
      break;
  }
}

/** Costs a heart and returns the player to the last ground they stood on. */
function fallInPit(state: GameState): void {
  const p = state.player;
  const before = p.invuln;
  damage(state, 1);
  if (before > 0) return;

  if (state.safeSpot) {
    p.x = state.safeSpot.x;
    p.y = state.safeSpot.y;
    syncInterpolation(state);
  }
  say(state, 'You fall. The dark is deeper than it looked.');
}

function openChest(state: GameState): void {
  const dungeon = currentDungeon(state);
  if (!dungeon) return;
  if (state.dungeonsCleared[dungeon.id]) return;

  state.dungeonsCleared[dungeon.id] = true;

  switch (dungeon.reward) {
    case RewardKind.HeartContainer:
      state.player.maxHearts++;
      state.player.hearts = state.player.maxHearts;
      state.heartsFound++;
      break;
    case RewardKind.BuddingRod:
      state.harvestYield = 2;
      break;
    case RewardKind.SerpentRod:
      state.rodReach = 2;
      break;
    case RewardKind.Chart:
      state.hasChart = true;
      break;
    case RewardKind.Galoshes:
      state.hasGaloshes = true;
      break;
  }

  say(state, `${REWARD_NAMES[dungeon.reward]}! Take it and go.`);
}

/** What the player could pay for right now, if anything. */
export function obstacleInFront(state: GameState): ObstaclePrompt | null {
  const { map, tx, ty } = facingTile(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return null;

  const tile = map.tiles[ty * map.w + tx] as Tile;

  if (tile === Tile.DoorLocked) {
    return {
      tile,
      label:
        state.keysHeld > 0 ? 'Unlock the door — 1 key' : 'Locked. A key is somewhere here.',
      affordable: state.keysHeld > 0,
    };
  }

  const needed = sealResourceOf(tile);
  if (needed !== null) {
    const ready = state.rodTier >= needed;
    const name = RESOURCE_LABEL[needed];
    return {
      tile,
      label: ready
        ? `Part the seal — the Rod knows ${name}`
        : `A seal of ${name}. The Rod is not ready for this.`,
      affordable: ready,
    };
  }

  const cost = OBSTACLE_COST[tile];
  if (!cost) return null;

  const held = state.carried[cost.resource];
  const verb = tile === Tile.Chasm ? 'Bridge the chasm' : 'Rope the ledge';
  return {
    tile,
    label: `${verb} — ${cost.amount} ${RESOURCE_LABEL[cost.resource]} (you have ${held})`,
    affordable: held >= cost.amount,
  };
}

/** Pay to cross. Costs come out of the same stock the ark needs. */
export function tryClear(state: GameState, tx: number, ty: number): void {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;

  const i = ty * map.w + tx;
  const tile = map.tiles[i] as Tile;

  if (tile === Tile.DoorLocked) {
    if (state.keysHeld < 1) {
      say(state, 'Locked. A key is somewhere in here.');
      return;
    }
    state.keysHeld--;
    convertConnected(map, tx, ty, tile, Tile.DoorOpen);
    state.mapRevision++;
    say(state, 'The key turns.');
    return;
  }

  const needed = sealResourceOf(tile);
  if (needed !== null) {
    const name = RESOURCE_LABEL[needed];
    if (state.rodTier < needed) {
      say(state, `The seal holds. Imbue the Rod with ${name} and return.`);
      return;
    }
    convertConnected(map, tx, ty, tile, Tile.DungeonFloor);
    state.mapRevision++;
    say(state, `The Rod drinks the ${name}. The seal parts.`);
    return;
  }

  const cost = OBSTACLE_COST[tile];
  if (!cost) return;

  const held = state.carried[cost.resource];
  const name = RESOURCE_LABEL[cost.resource];
  if (held < cost.amount) {
    say(state, `Not enough ${name} — ${cost.amount} needed, you have ${held}.`);
    return;
  }

  state.carried[cost.resource] -= cost.amount;
  convertConnected(map, tx, ty, tile, OBSTACLE_CLEARS_TO[tile]);
  state.mapRevision++;
  say(state, `${cost.amount} ${name} spent. The ark will notice.`);
}

/** Convert a whole obstacle band in one payment. */
function convertConnected(map: TileMap, tx: number, ty: number, from: Tile, to: Tile): void {
  const queue = [ty * map.w + tx];
  let converted = 0;

  while (queue.length > 0 && converted < CLEAR_LIMIT) {
    const i = queue.pop() as number;
    if (map.tiles[i] !== from) continue;
    map.tiles[i] = to;
    converted++;

    const x = i % map.w;
    const y = (i / map.w) | 0;
    if (x > 0) queue.push(i - 1);
    if (x < map.w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - map.w);
    if (y < map.h - 1) queue.push(i + map.w);
  }
}

/** Track the last safe ground, so a pit has somewhere to spit the player out. */
export function rememberSafeSpot(state: GameState): void {
  const { map, i } = tileUnder(state);
  if (i < 0 || i >= map.tiles.length) return;
  if (map.tiles[i] === Tile.Pit) return;
  if (!isWalkable(map.tiles[i])) return;
  state.safeSpot = { x: state.player.x, y: state.player.y };
}
