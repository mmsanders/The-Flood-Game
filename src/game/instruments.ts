/**
 * Instruments that point the way: the lodestone's bearing to the ark, and
 * the dove, released to find the nearest unboarded animal.
 */

import { animalDef, AnimalStatus } from '../core/animals.js';
import { TILE_PX } from '../core/config.js';
import { isWalkable, Tile } from '../core/tiles.js';
import { currentDay, say, waterLevel } from './queries.js';
import { type Action, Dir, type GameState, PLAYER_H, PLAYER_W } from './types.js';

export const LODESTONE_DIR_NAME: Record<Dir, string> = {
  [Dir.Down]: 'south',
  [Dir.Up]: 'north',
  [Dir.Left]: 'west',
  [Dir.Right]: 'east',
};

/** Cardinal bearing from Noah toward the ark. Works on land and at sea. */
export function lodestoneBearing(state: GameState): Dir | null {
  if (!state.hasLodestone) return null;
  const px = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const py = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  const dx = state.world.ark.x - px;
  const dy = state.world.ark.y - py;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? Dir.Right : Dir.Left;
  return dy > 0 ? Dir.Down : Dir.Up;
}

/** Scout nearest dry land (above the flood) or a free animal. Usable at sea. */
export function releaseDove(state: GameState): void {
  // The dove scouts the open sky; underground its bearings would be read off
  // the overworld at cave coordinates.
  if (!state.hasDove || state.location.kind !== 'overworld') return;

  const px = Math.floor((state.player.x + PLAYER_W / 2) / TILE_PX);
  const py = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  const level = waterLevel(state);

  // Prefer a free animal within a modest radius; else the nearest dry walkable tile.
  let bestAnimal: { dx: number; dy: number; name: string } | null = null;
  let bestAnimalD = Infinity;
  for (const animal of state.world.animals) {
    if (animal.status !== AnimalStatus.Wild) continue;
    const ax = Math.floor((animal.x + 8) / TILE_PX);
    const ay = Math.floor((animal.y + 8) / TILE_PX);
    const dx = ax - px;
    const dy = ay - py;
    const d = dx * dx + dy * dy;
    if (d < bestAnimalD) {
      bestAnimalD = d;
      bestAnimal = { dx, dy, name: animalDef(animal.kind).name };
    }
  }

  let bestDry: { dx: number; dy: number } | null = null;
  let bestDryD = Infinity;
  const world = state.world;
  const radius = 48;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const i = y * world.w + x;
      if (!isWalkable(world.tiles[i])) continue;
      if (world.elev[i] < level) continue;
      const d = dx * dx + dy * dy;
      if (d === 0) continue;
      if (d < bestDryD) {
        bestDryD = d;
        bestDry = { dx, dy };
      }
    }
  }

  // Biblical priority: when the flood has begun, dry land matters most.
  const flooded = currentDay(state) >= 1;
  if (flooded && bestDry) {
    say(state, `The dove returns from the ${bearingName(bestDry.dx, bestDry.dy)}. Dry ground.`);
    return;
  }
  if (bestAnimal) {
    say(
      state,
      `The dove circles a ${bestAnimal.name} to the ${bearingName(bestAnimal.dx, bestAnimal.dy)}.`,
    );
    return;
  }
  if (bestDry) {
    say(state, `The dove returns from the ${bearingName(bestDry.dx, bestDry.dy)}. Dry ground.`);
    return;
  }
  say(state, 'The dove finds neither dry ground nor beast nearby.');
}

/** Outdoors with the dove: release it. */
export function doveAction(state: GameState): Action | null {
  if (!state.hasDove || state.location.kind !== 'overworld') return null;
  return {
    prompt: { tile: Tile.Reed, label: 'Release the dove — scout dry land or beasts', affordable: true },
    run: releaseHere,
  };
}

function releaseHere(state: GameState): boolean {
  releaseDove(state);
  return true;
}

function bearingName(dx: number, dy: number): string {
  const parts: string[] = [];
  if (dy < 0) parts.push('north');
  if (dy > 0) parts.push('south');
  if (dx > 0) parts.push('east');
  if (dx < 0) parts.push('west');
  return parts.join('-') || 'here';
}
