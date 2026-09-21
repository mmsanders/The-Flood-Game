/**
 * Escarpments: impassable cliff faces with occasional stairs on wide bands.
 */
import { randInt, type Rng } from '../rng.js';
import { Tile } from '../tiles.js';
import { stamp } from './plan.js';
import { isWorldRim } from './seams.js';
import { ESCARPMENT_DROP, WIDE_CLIFF, fillCliffGaps } from './cliffGaps.js';

/**
 * Where elevation drops a biome band (or more) to the south, a cliff face.
 *
 * Faces are impassable (`Tile.Cliff`). Short bluffs have no stairs — walk
 * around them. Really wide bands get occasional stairs so northward progress
 * stays possible without turning every escarpment into a picket of Steps.
 * Connectivity repair may still cut a stair through a sealed region; that is
 * intentional so the world stays solvable without continuous paved roads.
 */
export function cutEscarpments(
  rng: Rng,
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

  // Close short horizontal gaps so a cliff face reads as a barrier instead of
  // a dashed line you stroll through. Five tiles is under a third of a panel.
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
    // Stamp every run, including short bluffs. Skipping runs under 8 left
    // elevation-drop shadows drawn on walkable grass — the playtest lie.
    if (run.length < 1) continue;
    run.sort((a, b) => (a % w) - (b % w) || ((a / w) | 0) - ((b / w) | 0));

    // Stairs only on wide faces, and sparsely. A run under WIDE_CLIFF is a
    // bluff you walk around; above it, one stair per ~28 tiles of face.
    const wide = run.length >= WIDE_CLIFF;
    const stairs = wide ? Math.max(1, (run.length / 28) | 0) : 0;
    const stride = stairs > 0 ? Math.max(18, (run.length / (stairs + 1)) | 0) : 0;
    const offset = stairs > 0 ? randInt(rng, 3, Math.min(8, Math.max(4, stride - 1))) : 0;

    for (let n = 0; n < run.length; n++) {
      const i = run[n];
      const x = i % w;
      const y = (i / w) | 0;
      if (isWorldRim(x, y, w, h)) continue;
      if (plan[i] === Tile.Water || plan[i] === Tile.Gorge || plan[i] === Tile.Bridge) continue;
      const isStair = stairs > 0 && (n + offset) % stride === 0;
      stamp(plan, i, isStair ? Tile.Steps : Tile.Cliff);
      // Thicken the face one tile south on the steepest drops so the band
      // reads as a wall rather than a one-tile ribbon.
      if (!isStair && y + 1 < h - 2) {
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

/**
 * After paint, any leftover walkable ground on a hard elevation drop becomes
 * a cliff. Landforms stamp most of these; this catch-up is what keeps the
 * renderer honest — a 40-unit face is never grass you stroll through.
 *
 * Reserved mouths (doors, shrines, the ark) stay put; connectivity may still
 * cut Steps through a sealed band so the world remains solvable.
 */
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