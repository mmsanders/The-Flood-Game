import { describe, expect, it } from 'vitest';
import { withParams } from '../src/core/config.js';
import { Tile, isWalkable } from '../src/core/tiles.js';
import { generateWorld } from '../src/core/worldgen/index.js';
import { SettlementKind } from '../src/core/world.js';

const SMALL = withParams({ panelsX: 8, panelsY: 20 });
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 13);

describe('playtest: road auras', () => {
  it.each(SEEDS.slice(0, 8))('seed %i leaves wilderness gaps between town auras', (seed) => {
    const world = generateWorld(seed, SMALL);
    const towns = world.settlements.filter((s) => s.kind !== SettlementKind.Hamlet);
    if (towns.length < 2) return;

    const isPavement = (t: number) => t === Tile.Path || t === Tile.Road;
    const reachPavement = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const seen = new Uint8Array(world.w * world.h);
      const q: number[] = [];
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = from.x + dx;
          const y = from.y + dy;
          if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
          const i = y * world.w + x;
          if (!isPavement(world.tiles[i]) || seen[i]) continue;
          seen[i] = 1;
          q.push(i);
        }
      }
      let qi = 0;
      while (qi < q.length) {
        const i = q[qi++];
        const x = i % world.w;
        const y = (i / world.w) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
          const j = ny * world.w + nx;
          if (seen[j] || !isPavement(world.tiles[j])) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = to.x + dx;
          const y = to.y + dy;
          if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
          if (seen[y * world.w + x]) return true;
        }
      }
      return false;
    };

    let gaps = 0;
    let pairs = 0;
    for (let i = 0; i < towns.length - 1; i++) {
      const a = towns[i];
      const b = towns[i + 1];
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist < 48) continue;
      pairs++;
      if (!reachPavement(a, b)) gaps++;
    }
    if (towns.length > 0) {
      const t = towns[0];
      const dist = Math.abs(t.x - world.spawn.x) + Math.abs(t.y - world.spawn.y);
      if (dist >= 48) {
        pairs++;
        if (!reachPavement(t, world.spawn)) gaps++;
      }
    }
    expect(pairs, `seed ${seed} had no far town pairs to check`).toBeGreaterThan(0);
    expect(gaps, `seed ${seed} still has continuous pavement between distant towns`).toBe(pairs);
  });
});

describe('playtest: impassable cliffs', () => {
  it('marks Cliff tiles as non-walkable', () => {
    expect(isWalkable(Tile.Cliff)).toBe(false);
    expect(isWalkable(Tile.Steps)).toBe(true);
  });

  it.each(SEEDS.slice(0, 8))('seed %i places impassable cliff faces with stairs on wide bands', (seed) => {
    const world = generateWorld(seed, SMALL);
    let cliffs = 0;
    let stepsBesideCliff = 0;
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] === Tile.Cliff) {
        cliffs++;
        expect(isWalkable(world.tiles[i])).toBe(false);
      }
      if (world.tiles[i] !== Tile.Steps) continue;
      const x = i % world.w;
      const y = (i / world.w) | 0;
      for (const j of [i - 1, i + 1, i - world.w, i + world.w]) {
        if (j < 0 || j >= world.tiles.length) continue;
        const jx = j % world.w;
        const jy = (j / world.w) | 0;
        if (Math.abs(jx - x) + Math.abs(jy - y) !== 1) continue;
        if (world.tiles[j] === Tile.Cliff) {
          stepsBesideCliff++;
          break;
        }
      }
    }
    expect(cliffs, `seed ${seed} has no cliff faces`).toBeGreaterThan(20);
    expect(stepsBesideCliff, `seed ${seed} has no stairs through cliffs`).toBeGreaterThan(0);
  });
});
