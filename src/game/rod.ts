/**
 * The Rod and the tools: swinging, harvesting nodes, axe and pickaxe work,
 * and imbuing the Rod at shrines.
 */

import { TILE_PX } from '../core/config.js';
import { AXE_DURABILITY, PICKAXE_DURABILITY } from '../core/items.js';
import { canRodHarvest, SHRINE_COST } from '../core/resources.js';
import { Biome, carveTo, Resource, RESOURCE_NAMES, resourceOf, Tile } from '../core/tiles.js';
import { activeMap, depthAt, dirX, dirY, RESOURCE_LABEL, say } from './queries.js';
import { type GameState, type ObstaclePrompt, PLAYER_H, PLAYER_W } from './types.js';

/** The Rod is weapon and default harvesting tool; hand tools are emergency alternatives. */
export function swingRod(state: GameState): void {
  const p = state.player;
  const cx = p.x + PLAYER_W / 2;
  const cy = p.y + PLAYER_H / 2;

  for (let d = 1; d <= state.rodReach; d++) {
    const tx = Math.floor((cx + dirX(p.dir) * TILE_PX * d) / TILE_PX);
    const ty = Math.floor((cy + dirY(p.dir) * TILE_PX * d) / TILE_PX);
    if (harvestAt(state, tx, ty, d === 1)) return;
  }

  // Scenery is not a Rod target at all. Axe/pickaxe give the adjacent swing a
  // second meaning without making every ordinary tree a permanent resource.
  const tx = Math.floor((cx + dirX(p.dir) * TILE_PX) / TILE_PX);
  const ty = Math.floor((cy + dirY(p.dir) * TILE_PX) / TILE_PX);
  tryToolHarvest(state, tx, ty);
}

/** True if a resource node was targeted, harvested or not. */
function harvestAt(state: GameState, tx: number, ty: number, allowTool: boolean): boolean {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;

  const i = ty * map.w + tx;
  const res = resourceOf(map.tiles[i]);
  if (res === null) return false;

  if (!canRodHarvest(state.rodTier, res)) {
    if (allowTool && tryToolHarvest(state, tx, ty)) return true;
    say(state, `The Rod does not yet know ${RESOURCE_LABEL[res]}. Seek a shrine.`);
    return true;
  }

  const depth = depthAt(state, tx, ty);
  const submerged = depth > 0;
  if (submerged && !state.inBoat) {
    say(state, 'The waters cover it. You would need a boat.');
    return true;
  }
  if (submerged && depth > state.rodReach) {
    say(state, 'Too deep for the Rod. You would need to fish.');
    return true;
  }

  map.tiles[i] = carveTo(map.biome[i]);
  state.mapRevision++;
  state.carried[res] += state.harvestYield;
  state.harvested += state.harvestYield;
  if (submerged) say(state, `Dredged +${state.harvestYield} ${RESOURCE_LABEL[res]}.`);
  else say(state, `+${state.harvestYield} ${RESOURCE_LABEL[res]}`);
  return true;
}

/**
 * A normal resource node costs one durability; ordinary blocking scenery costs
 * more but still yields one ark-grade unit. That makes tools rescue a route or
 * a drowned progression gate without replacing the Rod as the efficient loop.
 */
function tryToolHarvest(state: GameState, tx: number, ty: number): boolean {
  const map = activeMap(state);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  const tile = map.tiles[i] as Tile;

  let resource: Resource;
  let durability: number;
  let tool: 'axe' | 'pickaxe';

  switch (tile) {
    case Tile.GopherTree:
      resource = Resource.Wood;
      durability = 1;
      tool = 'axe';
      break;
    case Tile.Tree:
      resource = Resource.Wood;
      durability = 3;
      tool = 'axe';
      break;
    case Tile.Shrub:
      resource = Resource.Fiber;
      durability = 2;
      tool = 'axe';
      break;
    case Tile.StoneNode:
      resource = Resource.Stone;
      durability = 1;
      tool = 'pickaxe';
      break;
    case Tile.Rock:
      resource = Resource.Stone;
      durability = 3;
      tool = 'pickaxe';
      break;
    default:
      return false;
  }

  if (tool === 'axe' && !state.hasAxe) return false;
  if (tool === 'pickaxe' && !state.hasPickaxe) return false;
  if (depthAt(state, tx, ty) > 0) {
    say(state, `The ${tool} cannot work under water.`);
    return true;
  }

  map.tiles[i] = carveTo(map.biome[i]);
  state.mapRevision++;
  state.carried[resource] += 1;
  state.harvested += 1;

  if (tool === 'axe') {
    state.axeDurability = Math.max(0, state.axeDurability - durability);
    if (state.axeDurability === 0) {
      state.hasAxe = false;
      say(state, `+1 ${RESOURCE_LABEL[resource]}. The axe breaks.`);
    } else {
      say(state, `+1 ${RESOURCE_LABEL[resource]} — axe ${state.axeDurability}/${AXE_DURABILITY}.`);
    }
  } else {
    state.pickaxeDurability = Math.max(0, state.pickaxeDurability - durability);
    if (state.pickaxeDurability === 0) {
      state.hasPickaxe = false;
      say(state, `+1 ${RESOURCE_LABEL[resource]}. The pickaxe breaks.`);
    } else {
      say(
        state,
        `+1 ${RESOURCE_LABEL[resource]} — pickaxe ${state.pickaxeDurability}/${PICKAXE_DURABILITY}.`,
      );
    }
  }
  return true;
}

export function shrinePrompt(state: GameState, biome: Biome): ObstaclePrompt {
  const cost = SHRINE_COST[biome] ?? 0;
  const res = biome as unknown as Resource;
  const held = state.carried[res] ?? 0;
  if (state.rodTier > biome) {
    return { tile: Tile.Shrine, label: 'The Rod already bears this gift.', affordable: false };
  }
  if (state.rodTier < biome) {
    return {
      tile: Tile.Shrine,
      label: 'This shrine is silent. Seek the lower biome first.',
      affordable: false,
    };
  }
  const next =
    biome < Biome.Mountain ? RESOURCE_NAMES[(biome + 1) as Resource] : 'a budding harvest';
  return {
    tile: Tile.Shrine,
    label: `Imbue the Rod — ${cost} ${RESOURCE_LABEL[res]} → ${next} (you have ${held})`,
    affordable: held >= cost,
  };
}

export function tryImbueRod(state: GameState, biome: Biome): void {
  if (state.rodTier > biome) {
    say(state, 'The Rod already bears this gift.');
    return;
  }
  if (state.rodTier < biome) {
    say(state, 'This shrine is silent. Seek the lower biome first.');
    return;
  }
  const cost = SHRINE_COST[biome] ?? 0;
  const res = biome as unknown as Resource;
  if (state.carried[res] < cost) {
    say(state, `The shrine wants ${cost} ${RESOURCE_LABEL[res]}.`);
    return;
  }
  state.carried[res] -= cost;
  state.rodTier++;
  if (state.rodTier >= 4) {
    state.harvestYield = Math.max(state.harvestYield, 2);
    say(state, 'Pitch crowns the Rod. It buds twice.');
    return;
  }
  const unlocked = RESOURCE_LABEL[state.rodTier];
  say(state, `The Rod drinks. It will take ${unlocked}.`);
}
