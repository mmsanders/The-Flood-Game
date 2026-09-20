import { describe, expect, it } from 'vitest';
import { TILE_PX, withParams } from '../src/core/config.js';
import { REWARD_SEAL, RewardKind } from '../src/core/dungeon.js';
import {
  Resource,
  Tile,
  isCarvable,
  isResourceNode,
  isWalkable,
  tileName,
} from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import {
  type GameState,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  createGame,
  obstacleInFront,
  snapCamera,
  step,
  syncInterpolation,
} from '../src/game/state.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const INTERACT = { moveX: 0, moveY: 0, attackPressed: false, interactPressed: true };

function newState(seed = 4242): GameState {
  return createGame(generateWorld(seed, SMALL));
}

/** Drop the player into a dungeon, facing north at the given tile. */
function standIn(state: GameState, dungeonId: number, tx: number, ty: number): void {
  state.location = { kind: 'dungeon', interiorId: -1, dungeonId, returnTo: { x: 1, y: 1 } };
  state.player.x = tx * TILE_PX + (TILE_PX - PLAYER_W) / 2;
  state.player.y = ty * TILE_PX + (TILE_PX - PLAYER_H) / 2;
  state.player.dir = 1; // up
  snapCamera(state);
  syncInterpolation(state);
}

describe('the seal of pitch', () => {
  it('seals the Serpent Rod and nothing else', () => {
    expect(REWARD_SEAL[RewardKind.SerpentRod]).toBe(Resource.Pitch);
    expect(REWARD_SEAL[RewardKind.HeartContainer]).toBeNull();
    expect(REWARD_SEAL[RewardKind.BuddingRod]).toBeNull();
  });

  it('stands between the stairs and the chest in that dungeon', () => {
    const world = generateWorld(4242, SMALL);
    const sealed = world.dungeons.find((d) => d.reward === RewardKind.SerpentRod);
    expect(sealed).toBeDefined();
    if (!sealed) return;

    const seals = [...sealed.tiles].filter((t) => t === Tile.PitchSeal).length;
    expect(seals).toBeGreaterThan(0);
    expect(isWalkable(Tile.PitchSeal)).toBe(false);

    // Flood-fill from the stairs without passing the seal: the chest must be
    // out of reach. This is the actual claim — not "a seal tile exists".
    const seen = new Set<number>();
    const start = sealed.stairs.y * sealed.w + sealed.stairs.x;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cur = queue.pop() as number;
      const cx = cur % sealed.w;
      const cy = (cur / sealed.w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= sealed.w || ny >= sealed.h) continue;
        const n = ny * sealed.w + nx;
        if (seen.has(n) || !isWalkable(sealed.tiles[n])) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.has(sealed.chest.y * sealed.w + sealed.chest.x)).toBe(false);
    // ...but the key is still on your side of it.
    expect(seen.has(sealed.key.y * sealed.w + sealed.key.x)).toBe(true);
  });

  it('refuses a Rod that has not been imbued with pitch', () => {
    const state = newState();
    const id = state.world.dungeons.findIndex((d) => d.reward === RewardKind.SerpentRod);
    expect(id).toBeGreaterThanOrEqual(0);
    const dungeon = state.world.dungeons[id];
    const seal = dungeon.tiles.indexOf(Tile.PitchSeal);
    const sx = seal % dungeon.w;
    const sy = (seal / dungeon.w) | 0;

    standIn(state, id, sx, sy + 1);
    state.rodTier = 0;

    const prompt = obstacleInFront(state);
    expect(prompt?.tile).toBe(Tile.PitchSeal);
    expect(prompt?.affordable).toBe(false);

    step(state, INTERACT, 1 / 60);
    expect(dungeon.tiles[seal]).toBe(Tile.PitchSeal);
  });

  it('parts for a Rod that knows pitch, and costs nothing to do it', () => {
    const state = newState();
    const id = state.world.dungeons.findIndex((d) => d.reward === RewardKind.SerpentRod);
    const dungeon = state.world.dungeons[id];
    const seal = dungeon.tiles.indexOf(Tile.PitchSeal);
    const sx = seal % dungeon.w;
    const sy = (seal / dungeon.w) | 0;

    standIn(state, id, sx, sy + 1);
    state.rodTier = Resource.Pitch;
    state.carried = [5, 5, 5, 5];

    expect(actionPrompt(state)?.affordable).toBe(true);
    step(state, INTERACT, 1 / 60);

    expect(dungeon.tiles[seal]).toBe(Tile.DungeonFloor);
    // Pitch is never spent on a dungeon — losing it strands the run.
    expect(state.carried).toEqual([5, 5, 5, 5]);
  });

  it('opens the whole seam in one go, not a tile at a time', () => {
    const state = newState();
    const id = state.world.dungeons.findIndex((d) => d.reward === RewardKind.SerpentRod);
    const dungeon = state.world.dungeons[id];
    const before = [...dungeon.tiles].filter((t) => t === Tile.PitchSeal).length;
    expect(before).toBeGreaterThan(1);

    const seal = dungeon.tiles.indexOf(Tile.PitchSeal);
    standIn(state, id, seal % dungeon.w, ((seal / dungeon.w) | 0) + 1);
    state.rodTier = Resource.Pitch;
    step(state, INTERACT, 1 / 60);

    expect([...dungeon.tiles].filter((t) => t === Tile.PitchSeal).length).toBe(0);
  });
});

describe('stairs', () => {
  it('always has open ground above and below it', () => {
    for (const seed of [1, 2, 3, 7, 4242, 9001]) {
      const world = generateWorld(seed, SMALL);
      let checked = 0;
      for (let i = 0; i < world.tiles.length; i++) {
        if (world.tiles[i] !== Tile.Steps) continue;
        const x = i % world.w;
        const y = (i / world.w) | 0;
        // Skip the rim, which is wall by design.
        if (y <= 1 || y >= world.h - 2) continue;
        checked++;
        // Scatter is the thing that must never land here. A cliff, a gorge or
        // a lake beside a stair is a landform doing its job.
        for (const [dir, t] of [
          ['north', world.tiles[i - world.w]],
          ['south', world.tiles[i + world.w]],
        ] as const) {
          expect(
            isCarvable(t) || isResourceNode(t),
            `seed ${seed} stair at ${x},${y} blocked to the ${dir} by ${tileName(t)}`,
          ).toBe(false);
        }
      }
      expect(checked, `seed ${seed} has no stairs at all`).toBeGreaterThan(0);
    }
  });
});

describe('roads', () => {
  it('does not draw a ruler down the map', () => {
    // A uniform cost field made the search return the Manhattan-shortest path,
    // which on open ground is a straight line. Measure the longest unbroken
    // run of road in a single column: a real route bends out of one quickly.
    for (const seed of [1, 2, 3, 7, 4242]) {
      const world = generateWorld(seed, SMALL);
      let longest = 0;
      for (let x = 0; x < world.w; x++) {
        let run = 0;
        for (let y = 0; y < world.h; y++) {
          const t = world.tiles[y * world.w + x];
          if (t === Tile.Path || t === Tile.Road) {
            run++;
            if (run > longest) longest = run;
          } else {
            run = 0;
          }
        }
      }
      expect(longest, `seed ${seed} has a ${longest}-tile straight road`).toBeLessThan(
        world.h / 3,
      );
    }
  });
});
