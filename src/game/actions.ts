/**
 * The E key: what the HUD offers here, and what pressing E does.
 */

import { isInteriorEntrance } from '../core/interior.js';
import { Biome, RESOURCE_NAMES, resourceOf, Tile } from '../core/tiles.js';
import { obstacleInFront, tryClear } from './ground.js';
import { releaseDove } from './instruments.js';
import {
  enterInteriorAt,
  entrancePrompt,
  findInteriorAtTile,
  interactInterior,
  interiorPrompt,
} from './places.js';
import { depthAt, facingTile, tileUnder } from './queries.js';
import { shrinePrompt, tryImbueRod } from './rod.js';
import {
  boatYardPrompt,
  canSetBoatHere,
  handleBoatYard,
  hasAdjacentBoatable,
  pickUpBoat,
  tryLaunchBoat,
  trySetDownBoat,
} from './skiff.js';
import { interactSettlement, settlementPrompt } from './trade.js';
import type { GameState, ObstaclePrompt } from './types.js';

/** Context action rendered by the HUD. */
export function actionPrompt(state: GameState): ObstaclePrompt | null {
  if (state.phase !== 'playing') return null;

  if (state.location.kind === 'interior') {
    return interiorPrompt(state);
  }

  if (state.location.kind === 'overworld') {
    const { map, i } = tileUnder(state);
    const standing = map.tiles[i] as Tile;
    const biome = map.biome[i] as Biome;

    if (standing === Tile.Shrine) return shrinePrompt(state, biome);
    if (isInteriorEntrance(standing)) {
      const { tx, ty } = tileUnder(state);
      if (findInteriorAtTile(state, tx, ty)) return entrancePrompt(state, standing);
      if (standing === Tile.BoatYard) {
        const prompt = boatYardPrompt(state, biome);
        if (prompt) return prompt;
      }
      if (standing === Tile.TownDoor) return settlementPrompt(state, biome);
    }
    if (standing === Tile.Skiff && !state.haulingBoat && !state.inBoat) {
      return { tile: Tile.Skiff, label: 'Take hold of the skiff', affordable: true };
    }

    if (state.hasBoat && !state.inBoat && (state.haulingBoat || state.boatX < 0) && hasAdjacentBoatable(state)) {
      return {
        tile: Tile.Water,
        label: `Launch the skiff — depth limit ${state.boatDepth}`,
        affordable: true,
      };
    }

    if (state.haulingBoat) {
      return {
        tile: Tile.Skiff,
        label: canSetBoatHere(state) ? 'Set down the skiff' : 'Carry the skiff onto clear dry ground',
        affordable: canSetBoatHere(state),
      };
    }

    if (state.inBoat) {
      const facing = facingTile(state);
      if (
        facing.tx >= 0 &&
        facing.ty >= 0 &&
        facing.tx < facing.map.w &&
        facing.ty < facing.map.h
      ) {
        const fi = facing.ty * facing.map.w + facing.tx;
        const res = resourceOf(facing.map.tiles[fi]);
        const depth = depthAt(state, facing.tx, facing.ty);
        if (res !== null && facing.map.floods && depth > 0) {
          const reachable = depth <= state.rodReach;
          if (state.hasSoundingLine) {
            return {
              tile: facing.map.tiles[fi] as Tile,
              label: `Sounding line: depth ${Math.min(4, depth)} — ${RESOURCE_NAMES[res]} below${reachable ? '; swing to dredge' : '; beyond the Rod'}`,
              affordable: reachable,
            };
          }
          return {
            tile: facing.map.tiles[fi] as Tile,
            label: reachable ? 'Dredge the deep — swing the Rod' : 'Something lies below, beyond the Rod',
            affordable: reachable,
          };
        }
      }
    }
  }

  const obstacle = obstacleInFront(state);
  if (obstacle) return obstacle;
  if (state.hasDove && state.location.kind === 'overworld') {
    return { tile: Tile.Reed, label: 'Release the dove — scout dry land or beasts', affordable: true };
  }
  return null;
}

export function handleInteract(state: GameState): void {
  const { map, tx, ty, i } = tileUnder(state);
  const standing = map.tiles[i] as Tile;
  const biome = map.biome[i] as Biome;

  if (state.location.kind === 'interior') {
    interactInterior(state);
    return;
  }

  if (standing === Tile.Shrine) {
    tryImbueRod(state, biome);
    return;
  }
  if (isInteriorEntrance(standing)) {
    if (findInteriorAtTile(state, tx, ty)) {
      enterInteriorAt(state, tx, ty);
      return;
    }
    if (standing === Tile.BoatYard && handleBoatYard(state, biome)) return;
    if (standing === Tile.TownDoor) {
      interactSettlement(state, biome);
      return;
    }
  }
  if (standing === Tile.Skiff && !state.inBoat && !state.haulingBoat) {
    pickUpBoat(state, tx, ty, i);
    return;
  }
  if (tryLaunchBoat(state)) return;
  if (state.haulingBoat && trySetDownBoat(state)) return;

  const facing = facingTile(state);
  if (obstacleInFront(state)) {
    tryClear(state, facing.tx, facing.ty);
    return;
  }
  if (state.hasDove) {
    releaseDove(state);
    return;
  }
  tryClear(state, facing.tx, facing.ty);
}
