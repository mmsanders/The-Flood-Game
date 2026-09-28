/**
 * Escarpments: impassable cliff faces. Scattered overworld ladders are gone.
 */
import { randInt, type Rng } from '../rng.js';
import { Tile } from '../tiles.js';
import { stamp } from './plan.js';
import { isWorldRim } from './seams.js';
import { ESCARPMENT_DROP, fillCliffGaps } from './cliffGaps.js';

/**
 * Where elevation drops a biome band (or more) to the south, a cliff face.
 *
 * Faces are impassable (`Tile.Cliff`). Short bluffs have no stairs — walk
 * around them. Connectivity repair may still cut a stair through a sealed
 * region so the world stays solvable. Biome seams get planned sideways stairs.
 */
export function cutEscarpments(
  _rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): void {
  const drop = ESCARPMENT_DROP;
  const marks = new Uint8Array(w * h);
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (plan[i] === Tile.Water || plan[i] === Tile.Gorge || plan[i] === Tile.Bridge) continue;
      const south = elev[i + w];
      if (elev[i] - south < drop && biome[i] <= biome[i + w]) continue;
      marks[i] = 1;
    }
  }

  fillCliffGaps(marks, w, h, 5);

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < marks.length; start++) {
    if (!marks[start] || seen[start]) continue;
    const run: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      run.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      const n4 = [i - 1, i + 1, i - w, i + w];
      for (const j of n4) {
        if (j < 0 || j >= marks.length || seen[j] || !marks[j]) continue;
        const jx = j % w;
        const jy = (j / w) | 0;
        if (Math.abs(jx - x) + Math.abs(jy - y) !== 1) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (run.length < 1) continue;
    run.sort((a, b) => (a % w) - (b % w) || ((a / w) | 0) - ((b / w) | 0));

    for (let n = 0; n < run.length; n++) {
      const i = run[n];
      const x = i % w;
      const y = (i / w) | 0;
      if (isWorldRim(x, y, w, h)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Gorge || plan[i] === Tile.Bridge) continue;
      stamp(plan, i, Tile.Cliff);
      if (y + 1 < h - 2) {
        const j = i + w;
        if (
          plan[j] !== Tile.Water &&
          plan[j] !== Tile.Gorge &&
          plan[j] !== Tile.Bridge &&
          plan[j] !== Tile.Steps &&
          elev[i] - elev[j] >= drop
        ) {
          stamp(plan, j, Tile.Cliff);
        }
      }
    }
  }
}

export function sealElevationFaces(
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): void {
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (elev[i] - elev[i + w] < ESCARPMENT_DROP) continue;
      if (!canSealAsCliff(tiles[i])) continue;
      tiles[i] = Tile.Cliff;
    }
  }
}

/**
 * Biome seams are N–S walls: you cannot walk from sand onto grass across the
 * band. Stairs punch through sideways so the approach is east/west.
 */
export function markBiomeSeams(
  rng: Rng,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  h: number,
): void {
  const marks = new Uint8Array(w * h);
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (plan[i] === Tile.Water || plan[i] === Tile.Gorge || plan[i] === Tile.Bridge) continue;
      if (biome[i] === biome[i + w]) continue;
      marks[i] = 1;
    }
  }
  fillCliffGaps(marks, w, h, 8);

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < marks.length; start++) {
    if (!marks[start] || seen[start]) continue;
    const run: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      run.push(i);
      const n4 = [i - 1, i + 1, i - w, i + w];
      for (const j of n4) {
        if (j < 0 || j >= marks.length || seen[j] || !marks[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    run.sort((a, b) => (a % w) - (b % w) || ((a / w) | 0) - ((b / w) | 0));
    const stairs = run.length >= 12 ? Math.max(1, (run.length / 28) | 0) : 0;
    const stride = stairs > 0 ? Math.max(14, (run.length / (stairs + 1)) | 0) : 0;
    const offset = stairs > 0 ? randInt(rng, 4, Math.min(10, Math.max(5, stride - 1))) : 0;
    for (let n = 0; n < run.length; n++) {
      const i = run[n];
      const x = i % w;
      const y = (i / w) | 0;
      if (isWorldRim(x, y, w, h)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Gorge || plan[i] === Tile.Bridge) continue;
      const isStair = stairs > 0 && (n + offset) % stride === 0;
      stamp(plan, i, isStair ? Tile.Steps : Tile.Cliff);
    }
  }
}

function canSealAsCliff(tile: number): boolean {
  switch (tile) {
    case Tile.Water:
    case Tile.Gorge:
    case Tile.Bridge:
    case Tile.Steps:
    case Tile.Cliff:
    case Tile.ArkSite:
    case Tile.DungeonEntrance:
    case Tile.HeartContainer:
    case Tile.TownDoor:
    case Tile.BoatYard:
    case Tile.Shrine:
    case Tile.Pedestal:
    case Tile.Skiff:
    case Tile.CampTent:
    case Tile.House:
    case Tile.Tent:
    case Tile.StoneWall:
    case Tile.Fence:
    case Tile.Stairs:
      return false;
    default:
      return true;
  }
}
