import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import {
  type Dungeon,
  type Dir4,
  OBSTACLE_COST,
  RewardKind,
  type RoomMeta,
  generateDungeon,
  generateDungeonRoom,
} from '../src/core/dungeon.js';
import { BIOME_COUNT, Biome, Tile, isWalkable } from '../src/core/tiles.js';
import { PoiKind } from '../src/core/world.js';
import { generateValidWorld, generateWorld } from '../src/core/worldgen/index.js';
