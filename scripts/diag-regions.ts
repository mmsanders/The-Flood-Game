/**
 * Diagnostic for Wave 4: runs worldgen up to (but not including) connectivity
 * repair and reports the walkable regions that repair would have to join,
 * with what walls each one in and how much of that wall is contour ledge.
 *
 *   npx tsx scripts/diag-regions.ts [seed=1000] [contoursPerBand=1]
 *
 * Mirrors the stage order in src/core/worldgen/index.ts; keep them in step.
 */
import { DEFAULT_PARAMS, tileHeight, tileWidth } from '../src/core/config.js';
import { stageRng } from '../src/core/rng.js';
import { Tile, TILE_NAMES } from '../src/core/tiles.js';
import { labelRegions } from '../src/core/worldgen/connectivity.js';
import { cutContours, markContours, contourThresholds } from '../src/core/worldgen/contours.js';
import { generateElevation } from '../src/core/worldgen/elevation.js';
import { sealElevationFaces } from '../src/core/worldgen/escarpments.js';
import { carveLandforms } from '../src/core/worldgen/landforms.js';
import { paintTiles } from '../src/core/worldgen/paint.js';
import { freshPlan } from '../src/core/worldgen/plan.js';
import { placePois } from '../src/core/worldgen/pois.js';
import { PoiKind } from '../src/core/world.js';
import { layRoads } from '../src/core/worldgen/roads.js';
import { placeSettlements } from '../src/core/worldgen/settlements.js';

const params = { ...DEFAULT_PARAMS, contoursPerBand: Number(process.argv[3] ?? 1) };
const seed = Number(process.argv[2] ?? 1000);
const w = tileWidth(params), h = tileHeight(params);
const { elev, biome } = generateElevation(seed, params);
const plan = freshPlan(w * h);
carveLandforms(seed, params, elev, biome, plan);
cutContours(stageRng(seed, 'contours'), elev, plan, w, h, params);
const { settlements } = placeSettlements(seed, params, elev, biome, plan);
const { spawn, pois } = placePois(seed, params, elev, biome, plan, settlements);
layRoads(seed, params, elev, biome, plan, settlements, { spawn, dungeons: pois.filter((p) => p.kind === PoiKind.Dungeon), docks: pois.filter((p) => p.kind === PoiKind.BoatYard) });
const tiles = paintTiles({ seed, params, elev, biome, plan });
sealElevationFaces(tiles, elev, w, h);
const { labels, sizes } = labelRegions(tiles, w, h);
let main = 0; for (let r = 1; r < sizes.length; r++) if (sizes[r] > sizes[main]) main = r;
const { marks, terrace } = markContours(elev, w, h, contourThresholds(params));
// classify each stranded region's border blockers
const small = sizes.map((s, r) => ({ r, s })).filter((x) => x.r !== main).sort((a, b) => b.s - a.s);
console.log('regions', sizes.length, 'main', sizes[main], 'stranded sizes', small.slice(0, 15).map((x) => x.s).join(','));
for (const { r, s } of small.slice(0, 8)) {
  const border = new Map<string, number>();
  let cx = 0, cy = 0, n = 0, contourBorder = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== r) continue;
    cx += i % w; cy += (i / w) | 0; n++;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (labels[j] === r) continue;
      const name = TILE_NAMES[tiles[j] as Tile] ?? String(tiles[j]);
      border.set(name, (border.get(name) ?? 0) + 1);
      if (marks[j]) contourBorder++;
    }
  }
  console.log(`  size ${s} at (${(cx / n) | 0},${(cy / n) | 0}) terrace ${terrace[labels.indexOf(r)]} contour-border ${contourBorder}`, [...border.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' '));
}
