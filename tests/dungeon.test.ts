import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PANEL_H, PANEL_W, withParams } from '../src/core/config.js';
import {
  type Dungeon,
  type Dir4,
  OBSTACLE_COST,
  RewardKind,
  type RoomMeta,
  generateDungeon,
} from '../src/core/dungeon.js';
import { BIOME_COUNT, Biome, Tile, isWalkable } from '../src/core/tiles.js';
import { PoiKind } from '../src/core/world.js';
import { generateWorld } from '../src/core/worldgen/index.js';

const SEEDS = Array.from({ length: 24 }, (_, i) => i * 3121 + 11);
const SMALL = withParams({ panelsX: 8, panelsY: 20 });

function make(seed: number, biome: Biome = Biome.Forest): Dungeon {
  return generateDungeon(seed, 0, biome, { x: 10, y: 10 });
}

/** Rooms reachable from the entrance, optionally treating obstacles as walls. */
function reachableRooms(d: Dungeon, blockedBy: Set<number>): Set<number> {
  const entrance = d.rooms.findIndex((r) => r.kind === 'entrance');
  const seen = new Set<number>([entrance]);
  const queue = [entrance];

  while (queue.length > 0) {
    const r = queue.shift() as number;
    for (let dir = 0; dir < 4; dir++) {
      const next = d.rooms[r].links[dir];
      if (next === -1 || seen.has(next)) continue;
      const gate = d.obstacles.find(
        (o) =>
          (o.between[0] === r && o.between[1] === next) ||
          (o.between[0] === next && o.between[1] === r),
      );
      if (gate && blockedBy.has(gate.tile)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

function roomAt(d: Dungeon, kind: RoomMeta['kind']): number {
  return d.rooms.findIndex((r) => r.kind === kind);
}

describe('dungeon: determinism', () => {
  it('produces byte-identical dungeons from the same seed', () => {
    const a = make(4242);
    const b = make(4242);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.stairs).toEqual(b.stairs);
    expect(a.chest).toEqual(b.chest);
    expect(a.key).toEqual(b.key);
  });

  it('produces different dungeons from different seeds', () => {
    expect(make(1).tiles).not.toEqual(make(2).tiles);
  });

  it('never calls Math.random', () => {
    const real = Math.random;
    let calls = 0;
    Math.random = () => {
      calls++;
      return real();
    };
    try {
      make(999);
    } finally {
      Math.random = real;
    }
    expect(calls).toBe(0);
  });
});

describe('dungeon: shape', () => {
  it('is a whole number of panels, so rooms are panels', () => {
    const d = make(7);
    expect(d.w % PANEL_W).toBe(0);
    expect(d.h % PANEL_H).toBe(0);
    expect(d.w / PANEL_W).toBe(d.roomsX);
    expect(d.h / PANEL_H).toBe(d.roomsY);
    expect(d.rooms.length).toBe(d.roomsX * d.roomsY);
  });

  it('never floods, and sits above any possible water line', () => {
    const d = make(7);
    expect(d.floods).toBe(false);
    for (const e of d.elev) expect(e).toBe(255);
  });

  it('has exactly one entrance, one treasure room and one key room', () => {
    for (const seed of SEEDS) {
      const d = make(seed);
      const count = (k: RoomMeta['kind']): number =>
        d.rooms.filter((r) => r.kind === k).length;
      expect(count('entrance'), `seed ${seed}`).toBe(1);
      expect(count('treasure'), `seed ${seed}`).toBe(1);
      expect(count('key'), `seed ${seed}`).toBe(1);
    }
  });

  it('puts the entrance on the bottom row, since you descend into it', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const d = make(seed);
      expect(d.rooms[roomAt(d, 'entrance')].ry).toBe(d.roomsY - 1);
    }
  });

  it('places stairs, chest and key on walkable tiles', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const d = make(seed);
      for (const p of [d.stairs, d.chest, d.key]) {
        expect(isWalkable(d.tiles[p.y * d.w + p.x]), `seed ${seed}`).toBe(true);
      }
      expect(d.tiles[d.stairs.y * d.w + d.stairs.x]).toBe(Tile.Stairs);
      expect(d.tiles[d.chest.y * d.w + d.chest.x]).toBe(Tile.Chest);
      expect(d.tiles[d.key.y * d.w + d.key.x]).toBe(Tile.Key);
    }
  });

  it('surrounds the dungeon with solid wall', () => {
    const d = make(31);
    for (let x = 0; x < d.w; x++) {
      expect(isWalkable(d.tiles[x])).toBe(false);
      expect(isWalkable(d.tiles[(d.h - 1) * d.w + x])).toBe(false);
    }
    for (let y = 0; y < d.h; y++) {
      expect(isWalkable(d.tiles[y * d.w])).toBe(false);
      expect(isWalkable(d.tiles[y * d.w + d.w - 1])).toBe(false);
    }
  });
});

describe('dungeon: structure is guaranteed, not hoped for', () => {
  it.each(SEEDS)('seed %i connects every room to the entrance', (seed) => {
    const d = make(seed);
    const reached = reachableRooms(d, new Set());
    expect(reached.size).toBe(d.rooms.length);
  });

  it.each(SEEDS)('seed %i never puts the key behind the door it opens', (seed) => {
    const d = make(seed);
    // Treat the locked door as impassable: the key must still be reachable.
    const withoutKey = reachableRooms(d, new Set<number>([Tile.DoorLocked]));
    expect(withoutKey.has(roomAt(d, 'key')), `key unreachable on seed ${seed}`).toBe(true);
  });

  it.each(SEEDS)('seed %i puts the treasure behind the locked door', (seed) => {
    const d = make(seed);
    const withoutKey = reachableRooms(d, new Set<number>([Tile.DoorLocked]));
    expect(withoutKey.has(roomAt(d, 'treasure')), `seed ${seed}`).toBe(false);
  });

  it.each(SEEDS)('seed %i keeps the toll on the ark affordable', (seed) => {
    const d = make(seed);
    const spend = d.obstacles.reduce(
      (sum, o) => sum + (OBSTACLE_COST[o.tile]?.amount ?? 0),
      0,
    );
    // A raid should bite into the hull, not consume it: the recipe wants 60
    // wood and 40 fiber, so a handful of units is a real but survivable cost.
    expect(spend, `seed ${seed} costs ${spend}`).toBeLessThanOrEqual(8);
  });

  it('reaches the treasure once the door is open and the tolls are paid', () => {
    for (const seed of SEEDS) {
      const d = make(seed);
      const reached = reachableRooms(d, new Set());
      expect(reached.has(roomAt(d, 'treasure')), `seed ${seed}`).toBe(true);
    }
  });

  it('only ever charges wood or fiber, never the scarce pitch', () => {
    for (const seed of SEEDS) {
      for (const o of make(seed).obstacles) {
        const cost = OBSTACLE_COST[o.tile];
        if (!cost) continue; // the locked door costs a key, not resources
        expect([0, 1]).toContain(cost.resource); // Fiber or Wood
      }
    }
  });
});

describe('dungeon: rewards', () => {
  it('gives each biome its designated reward', () => {
    expect(make(1, Biome.Valley).reward).toBe(RewardKind.HeartContainer);
    expect(make(1, Biome.Forest).reward).toBe(RewardKind.BuddingRod);
    expect(make(1, Biome.Scrub).reward).toBe(RewardKind.HeartContainer);
    expect(make(1, Biome.Mountain).reward).toBe(RewardKind.SerpentRod);
  });
});

describe('dungeon: attached to the world', () => {
  it('builds one dungeon per dungeon entrance', () => {
    const world = generateWorld(20260830, SMALL);
    const entrances = world.pois.filter((p) => p.kind === PoiKind.Dungeon);
    expect(world.dungeons.length).toBe(entrances.length);
    expect(world.dungeons.length).toBe(BIOME_COUNT);
  });

  it('links each dungeon back to its overworld entrance', () => {
    const world = generateWorld(20260830, SMALL);
    for (const d of world.dungeons) {
      const tile = world.tiles[d.overworldEntrance.y * world.w + d.overworldEntrance.x];
      expect(tile).toBe(Tile.DungeonEntrance);
    }
  });

  it('covers all four biomes across the dungeon set', () => {
    const world = generateWorld(20260830, SMALL);
    expect(new Set(world.dungeons.map((d) => d.biomeKind)).size).toBe(BIOME_COUNT);
  });

  it('leaves the ark winnable without entering a single dungeon', () => {
    // Dungeons are optional. The solvability check must never come to depend
    // on them, or the run stops being winnable by ordinary play.
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = generateWorld(seed, DEFAULT_PARAMS);
      expect(world.stats.solvable, world.stats.problems.join('; ')).toBe(true);
    }
  });

  it('regenerates dungeons identically for a given world seed', () => {
    const a = generateWorld(4242, SMALL);
    const b = generateWorld(4242, SMALL);
    for (let i = 0; i < a.dungeons.length; i++) {
      expect(a.dungeons[i].tiles).toEqual(b.dungeons[i].tiles);
    }
  });
});

/** Keeps the Dir4 import meaningful for readers of the room graph. */
export type { Dir4 };
