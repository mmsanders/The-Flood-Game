/**
 * Settlements, their markets, and the hermit: what is for sale, what it
 * costs, and bartering for it.
 */

import { AnimalKind, AnimalStatus } from '../core/animals.js';
import {
  AXE_DURABILITY,
  ITEM_COST,
  ITEM_NAMES,
  ItemKind,
  marketAmount,
  PICKAXE_DURABILITY,
  SHOP_STOCK,
} from '../core/items.js';
import { Biome, Tile } from '../core/tiles.js';
import { currentDay, RESOURCE_LABEL, say, tileUnder } from './queries.js';
import type { Action, GameState, ObstaclePrompt } from './types.js';

export function settlementPrompt(state: GameState, biome: Biome): ObstaclePrompt {
  if (biome === Biome.Mountain) return hermitPrompt(state);
  const item = nextShopItem(state, biome);
  if (item === null) {
    return { tile: Tile.TownDoor, label: 'The market has nothing more you need.', affordable: false };
  }
  return {
    tile: Tile.TownDoor,
    label: `Market: ${ITEM_NAMES[item]} — ${priceLabel(state, item)}`,
    affordable: canAffordItem(state, item),
  };
}

export function interactSettlement(state: GameState, biome: Biome): void {
  if (biome === Biome.Mountain) {
    tradeWithHermit(state);
    return;
  }
  const item = nextShopItem(state, biome);
  if (item === null) {
    say(state, 'The market has nothing more you need.');
    return;
  }
  buyItem(state, biome, item);
}

/** A town door with no shop behind it: the market, or the hermit up high. */
export function townAction(state: GameState): Action | null {
  if (state.location.kind !== 'overworld') return null;
  const { map, i } = tileUnder(state);
  if (map.tiles[i] !== Tile.TownDoor) return null;
  return { prompt: settlementPrompt(state, map.biome[i] as Biome), run: tradeHere };
}

function tradeHere(state: GameState): boolean {
  const { map, i } = tileUnder(state);
  interactSettlement(state, map.biome[i] as Biome);
  return true;
}

function nextShopItem(state: GameState, biome: Biome): ItemKind | null {
  for (const item of SHOP_STOCK[biome]) {
    if (!ownsMarketItem(state, biome, item)) return item;
  }
  return null;
}

function ownsMarketItem(state: GameState, biome: Biome, item: ItemKind): boolean {
  switch (item) {
    case ItemKind.Galoshes:
      return state.hasGaloshes;
    case ItemKind.Axe:
      return state.hasAxe;
    case ItemKind.Pickaxe:
      return state.hasPickaxe;
    case ItemKind.SoundingLine:
      return state.hasSoundingLine;
    case ItemKind.HeartContainer:
      return (state.shopHeartMask & (1 << biome)) !== 0;
    case ItemKind.Chart:
      return state.hasChart;
    case ItemKind.Lodestone:
      return state.hasLodestone;
    case ItemKind.Dove:
      return state.hasDove;
  }
}

function priceLabel(state: GameState, item: ItemKind): string {
  const day = currentDay(state);
  let text = '';
  const parts = ITEM_COST[item];
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n];
    const amount = marketAmount(part.resource, part.amount, day);
    if (n > 0) text += ' + ';
    text += `${amount} ${RESOURCE_LABEL[part.resource]}`;
  }
  return text;
}

function canAffordItem(state: GameState, item: ItemKind): boolean {
  const day = currentDay(state);
  for (const part of ITEM_COST[item]) {
    if (state.carried[part.resource] < marketAmount(part.resource, part.amount, day)) return false;
  }
  return true;
}

function buyItem(state: GameState, biome: Biome, item: ItemKind): void {
  if (!canAffordItem(state, item)) {
    say(state, `The barter is ${priceLabel(state, item)}. The flood has no mercy on prices.`);
    return;
  }
  const day = currentDay(state);
  for (const part of ITEM_COST[item]) {
    state.carried[part.resource] -= marketAmount(part.resource, part.amount, day);
  }

  switch (item) {
    case ItemKind.Galoshes:
      state.hasGaloshes = true;
      say(state, 'Galoshes. Depth one is ground again, though slow ground.');
      break;
    case ItemKind.Axe:
      state.hasAxe = true;
      state.axeDurability = AXE_DURABILITY;
      say(state, `An axe, ${AXE_DURABILITY} durability. Ordinary timber is costly to cut.`);
      break;
    case ItemKind.Pickaxe:
      state.hasPickaxe = true;
      state.pickaxeDurability = PICKAXE_DURABILITY;
      say(state, `A pickaxe, ${PICKAXE_DURABILITY} durability. Rock is costly to break.`);
      break;
    case ItemKind.SoundingLine:
      state.hasSoundingLine = true;
      say(state, 'A sounding line. From the skiff, drowned resources name themselves.');
      break;
    case ItemKind.HeartContainer:
      state.shopHeartMask |= 1 << biome;
      state.player.maxHearts++;
      state.player.hearts = state.player.maxHearts;
      state.heartsFound++;
      say(state, 'A painful bargain, but thy vessel is enlarged.');
      break;
    case ItemKind.Chart:
      state.hasChart = true;
      state.mapRevision++;
      say(state, 'A chart. Explored land colours the map; without it, only grey fog.');
      break;
    case ItemKind.Lodestone:
      state.hasLodestone = true;
      say(state, 'A lodestone. It pulls toward the ark — on land or at sea.');
      break;
    case ItemKind.Dove:
      state.hasDove = true;
      say(state, 'A dove. Release it to scout dry ground or beasts still free.');
      break;
  }
}

export function hermitPrompt(state: GameState): ObstaclePrompt {
  if (state.hermitHeartClaimed) {
    return { tile: Tile.TownDoor, label: 'The hermit has already kept his bargain.', affordable: false };
  }
  const sheep = boardedSheep(state);
  return {
    tile: Tile.TownDoor,
    label: `Hermit: one rescued sheep → Heart Container (${sheep} aboard)`,
    affordable: sheep > 0,
  };
}

function boardedSheep(state: GameState): number {
  let count = 0;
  for (const animal of state.world.animals) {
    if (animal.kind === AnimalKind.Sheep && animal.status === AnimalStatus.Boarded) count++;
  }
  return count;
}

export function tradeWithHermit(state: GameState): void {
  if (state.hermitHeartClaimed) {
    say(state, 'The hermit has already kept his bargain.');
    return;
  }
  const index = state.world.animals.findIndex(
    (animal) => animal.kind === AnimalKind.Sheep && animal.status === AnimalStatus.Boarded,
  );
  if (index < 0) {
    say(state, 'The hermit asks for a sheep you have rescued.');
    return;
  }
  state.world.animals.splice(index, 1);
  state.hermitHeartClaimed = true;
  state.player.maxHearts++;
  state.player.hearts = state.player.maxHearts;
  state.heartsFound++;
  say(state, 'The hermit takes the sheep and gives a heart container. A life for strength.');
}
