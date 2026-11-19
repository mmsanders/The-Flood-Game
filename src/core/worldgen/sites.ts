/**
 * The trades between the towns. Wave 7.
 *
 * Small working places that explain the land around them: a woodcut in the
 * forest where the logging town gets its timber (and someone left an axe), a
 * charcoal burners' camp at the wood's edge, a quarry in the hills with a
 * worn pickaxe on its floor, a potter's yard by valley water where the clay
 * is, and a vineyard on a warm slope. Each is sited for the reason it would
 * really be there, laid on the plan before roads so a track runs out to it,
 * and named so the end of a run can say what the water took.
 *
 * Footprints are drawn as rows; ' ' is the site's ground.
 */

import { PANEL_H, PANEL_W, type WorldParams, tileHeight, tileWidth } from '../config.js';
import { type Rng, stageRng } from '../rng.js';
import { Biome, Tile } from '../tiles.js';
import { type Point, type Site, SiteKind } from '../world.js';
import { contourThresholds } from './contours.js';
import { UNPLANNED, overwrite } from './plan.js';
import { waterDistance } from './settlements.js';

interface Blueprint {
  kind: SiteKind;
  name: string;
  /** Biomes to try, best first. */
  biomes: Biome[];
  ground: Tile;
  rows: string[];
  /** Prefer water close by (the potter needs clay). */
  wet: boolean;
}

/**
 * S stump  A axe  C charcoal  T tent  B cut stone  P pickaxe  H house
 * K kiln  O pots  V vines  W winepress  k keeper's doorstep
 */
const BLUEPRINTS: readonly Blueprint[] = [
  {
    kind: SiteKind.Woodcut,
    name: 'the old woodcut',
    biomes: [Biome.Forest],
    ground: Tile.Dirt,
    rows: ['S S  S', '   S  ', 'S A  S', '  S   '],
    wet: false,
  },
  {
    kind: SiteKind.Charcoal,
    name: "the charcoal burners' camp",
    biomes: [Biome.Forest, Biome.Scrub],
    ground: Tile.Dirt,
    rows: ['C C C', '     ', ' Tk  '],
    wet: false,
  },
  {
    kind: SiteKind.Quarry,
    name: 'the quarry',
    biomes: [Biome.Mountain, Biome.Scrub],
    ground: Tile.StoneGround,
    rows: ['BB B   ', '     BB', '   P   ', 'B      '],
    wet: false,
  },
  {
    kind: SiteKind.Kiln,
    name: "the potter's yard",
    biomes: [Biome.Valley],
    ground: Tile.Dirt,
    rows: ['H K O', 'k   O', '     '],
    wet: true,
  },
  {
    kind: SiteKind.Vineyard,
    name: 'the vineyard',
    biomes: [Biome.Scrub, Biome.Valley],
    ground: Tile.Dirt,
    rows: ['VVVVV W', '       ', 'VVVVV H', '      k', 'VVVVV  '],
    wet: false,
  },
];

const GLYPH: Record<string, Tile> = {
  S: Tile.Stump,
  A: Tile.AxeLeft,
  C: Tile.Charcoal,
  T: Tile.Tent,
  B: Tile.CutStone,
  P: Tile.PickaxeLeft,
  H: Tile.House,
  K: Tile.Kiln,
  O: Tile.Pots,
  V: Tile.Vine,
  W: Tile.Winepress,
};

const MIN_FROM_PEOPLE = 12;
const MIN_FROM_SITE = 14;

export function placeSites(
  seed: number,
  params: WorldParams,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  keepAway: readonly Point[],
): Site[] {
  const w = tileWidth(params);
  const h = tileHeight(params);
  const rng = stageRng(seed, 'sites');
  const water = waterDistance(plan, w, h);
  const thresholds = contourThresholds(params);
  const sites: Site[] = [];

  for (const bp of BLUEPRINTS) {
    const fw = bp.rows[0].length;
    const fh = bp.rows.length;
    for (const want of bp.biomes) {
      const at = pickSite(rng, elev, biome, plan, water, w, h, want, fw, fh, bp.wet, keepAway, sites, thresholds);
      if (at < 0) continue;
      sites.push(stampSite(plan, w, at % w, (at / w) | 0, bp, want));
      break;
    }
  }
  return sites;
}

function pickSite(
  rng: Rng,
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  water: Uint16Array,
  w: number,
  h: number,
  want: Biome,
  fw: number,
  fh: number,
  wet: boolean,
  keepAway: readonly Point[],
  sites: readonly Site[],
  thresholds: readonly number[],
): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let y = 2; y < h - fh - 3; y++) {
    for (let x = 2; x < w - fw - 2; x++) {
      const i = y * w + x;
      if (biome[i] !== want) continue;
      if (!fitsOnePanel(x, y, fw, fh)) continue;
      if (!clearOf(keepAway, x, y, MIN_FROM_PEOPLE) || !clearOf(sites, x, y, MIN_FROM_SITE)) continue;
      if (sharesPanel(keepAway, x, y)) continue;
      if (!footprintClear(elev, biome, plan, w, x, y, fw, fh, want, thresholds)) continue;
      const near = water[i] < 0xffff ? Math.max(0, 24 - water[i]) : 0;
      const score = (wet ? near * 3 : 0) + rng() * 8;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

function fitsOnePanel(x: number, y: number, fw: number, fh: number): boolean {
  const x0 = x - 1;
  const x1 = x + fw;
  const y0 = y - 1;
  const y1 = y + fh;
  if (Math.floor(x0 / PANEL_W) !== Math.floor(x1 / PANEL_W)) return false;
  if (Math.floor(y0 / PANEL_H) !== Math.floor(y1 / PANEL_H)) return false;
  return x0 % PANEL_W >= 1 && y0 % PANEL_H >= 1 && x1 % PANEL_W <= PANEL_W - 2 && y1 % PANEL_H <= PANEL_H - 2;
}

/** Never on the same screen as a town, the ark, the camp or a cave mouth. */
export function sharesPanel(points: readonly Point[], x: number, y: number): boolean {
  const px = Math.floor(x / PANEL_W);
  const py = Math.floor(y / PANEL_H);
  for (const p of points) {
    if (Math.floor(p.x / PANEL_W) === px && Math.floor(p.y / PANEL_H) === py) return true;
  }
  return false;
}

function clearOf(points: readonly Point[], x: number, y: number, min: number): boolean {
  for (const p of points) if ((p.x - x) ** 2 + (p.y - y) ** 2 < min * min) return false;
  return true;
}

function footprintClear(
  elev: Uint8Array,
  biome: Uint8Array,
  plan: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  fw: number,
  fh: number,
  want: Biome,
  thresholds: readonly number[],
): boolean {
  let lo = 255;
  let hi = 0;
  for (let y = y0 - 1; y <= y0 + fh; y++) {
    for (let x = x0 - 1; x <= x0 + fw; x++) {
      const i = y * w + x;
      if (plan[i] !== UNPLANNED || biome[i] !== want) return false;
      if (elev[i] < lo) lo = elev[i];
      if (elev[i] > hi) hi = elev[i];
    }
  }
  for (const t of thresholds) if (lo < t && hi >= t) return false;
  return hi - lo < 28;
}

function stampSite(plan: Uint8Array, w: number, x0: number, y0: number, bp: Blueprint, b: Biome): Site {
  let keeper: Point | null = null;
  let tool: Point | null = null;
  for (let dy = 0; dy < bp.rows.length; dy++) {
    for (let dx = 0; dx < bp.rows[dy].length; dx++) {
      const g = bp.rows[dy][dx];
      const i = (y0 + dy) * w + x0 + dx;
      if (g === 'k') {
        keeper = { x: x0 + dx, y: y0 + dy };
        overwrite(plan, i, bp.ground);
        continue;
      }
      const tile = GLYPH[g] ?? bp.ground;
      if (tile === Tile.AxeLeft || tile === Tile.PickaxeLeft) tool = { x: x0 + dx, y: y0 + dy };
      overwrite(plan, i, tile);
    }
  }
  return { kind: bp.kind, name: bp.name, biome: b, x: x0, y: y0, keeper, tool };
}
