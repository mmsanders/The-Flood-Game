/**
 * The endless sand: the game's first map that does not obey euclidean
 * adjacency. Round-one note 5.
 *
 * Somewhere along the far south of the map, the east or west edge turns to
 * sand. Walk off it and *"Endless sand stretches in every direction..."* —
 * every way but back leads to the same screen again. A stranger at the
 * carpenter's knows an eight-step path through it, and the path ends at an
 * oasis. `EASTMOST PENINSULA IS THE SECRET`, in this game's register.
 *
 * The primitive is a 3x3-panel map whose eight outer panels are identical to
 * the centre. The player always stands in the centre: crossing into a
 * neighbour starts the ordinary panel slide, and the game quietly moves the
 * player and camera back by one panel so the slide *ends* in the centre. It
 * looks exactly like walking into the next screen, because the next screen is
 * this one. Anything else that wants to loop can reuse it.
 *
 * Off the world map, so it never floods. The gate on the overworld does — the
 * far south goes under within days of the rain, which is what makes this an
 * early-game secret rather than something to save for later.
 */

import { PANEL_H, PANEL_W } from './config.js';
import { stageRng } from './rng.js';
import { blankPlanes, type TileMap } from './tilemap.js';
import { Biome, Tile } from './tiles.js';

/** A step through the sand, by compass. Matches panel offsets below. */
export const enum Compass {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

export const COMPASS_DX = [0, 1, 0, -1] as const;
export const COMPASS_DY = [-1, 0, 1, 0] as const;
export const COMPASS_LETTER = ['N', 'E', 'S', 'W'] as const;

/** Steps in the stranger's path. */
export const DESERT_CODE_LEN = 8;

/** Tile rows of the edge opening onto the sand. */
const GATE_ROWS = 4;

/** How far into the map, in tiles, the sand creeps around the gate. */
const SAND_REACH = 5;

/** Only plain ground turns to sand: never a road, a door, a node or a POI. */
const SANDABLE: ReadonlySet<number> = new Set([
  Tile.Grass,
  Tile.Dirt,
  Tile.Sand,
  Tile.TallGrass,
  Tile.Gravel,
  Tile.StoneGround,
  Tile.Crop,
]);

export interface DesertGate {
  /** +1: off the east edge. -1: off the west edge. */
  side: 1 | -1;
  /** Inclusive tile rows of the opening on that edge. */
  y0: number;
  y1: number;
  /** The way back to the world map: the direction opposite `side`. */
  back: Compass;
  /** The stranger's path: eight steps, none of them `back`. */
  code: Compass[];
}

export interface Desert {
  gate: DesertGate;
  /** Nine identical panels of sand. */
  sand: TileMap;
  /** The same, but the centre panel is the oasis. */
  oasis: TileMap;
  /** The oasis's prize, in centre-panel tile coordinates of `oasis`. */
  heart: { x: number; y: number };
}

/** The centre panel's top-left tile, in a 3x3 desert map. */
export const DESERT_CENTRE = { x: PANEL_W, y: PANEL_H } as const;

/**
 * Find a gate in the far south, paint the sand around it, and build the two
 * desert maps. Returns null if neither edge has a stretch of plain walkable
 * ground low enough to be "the far south"; the egg is simply absent then.
 *
 * Only plain ground is repainted, and sand is as walkable as what it
 * replaces, so connectivity and solvability are untouched.
 */
export function placeDesert(
  seed: number,
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
): Desert | null {
  const rng = stageRng(seed, 'desert');
  const preferred: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const gate =
    findGate(tiles, w, h, preferred) ?? findGate(tiles, w, h, preferred === 1 ? -1 : 1);
  if (!gate) return null;

  paintSand(tiles, elev, w, h, gate);

  const back = gate.side === 1 ? Compass.West : Compass.East;
  const ways = [Compass.North, Compass.East, Compass.South, Compass.West].filter((c) => c !== back);
  const code: Compass[] = [];
  for (let i = 0; i < DESERT_CODE_LEN; i++) code.push(ways[Math.floor(rng() * ways.length)]);

  const sand = buildSand();
  const { oasis, heart } = buildOasis();
  return { gate: { ...gate, back, code }, sand, oasis, heart };
}

/**
 * The map is walled by a column of rock. The gate is the southernmost run of
 * `GATE_ROWS` rows, within the bottom two panel rows, where that wall has
 * plain walkable ground right behind it — so the opening is only ever a
 * gap in the wall, never a new way round a cliff.
 */
function findGate(
  tiles: Uint8Array,
  w: number,
  h: number,
  side: 1 | -1,
): { side: 1 | -1; y0: number; y1: number } | null {
  const wall = side === 1 ? w - 1 : 0;
  const inner = wall - side;
  const top = Math.max(0, h - PANEL_H * 2);
  let run = 0;
  for (let y = h - 2; y >= top; y--) {
    const t = tiles[y * w + wall];
    const open = (t === Tile.Rock || SANDABLE.has(t)) && SANDABLE.has(tiles[y * w + inner]);
    run = open ? run + 1 : 0;
    if (run === GATE_ROWS) return { side, y0: y, y1: y + GATE_ROWS - 1 };
  }
  return null;
}

/**
 * Open the wall at the gate, at the height of the ground behind it so the
 * flood takes the two together, then lick a tongue of sand in from it,
 * thinning with distance.
 */
function paintSand(
  tiles: Uint8Array,
  elev: Uint8Array,
  w: number,
  h: number,
  gate: { side: 1 | -1; y0: number; y1: number },
): void {
  const wall = gate.side === 1 ? w - 1 : 0;
  for (let y = gate.y0; y <= gate.y1; y++) {
    tiles[y * w + wall] = Tile.Sand;
    elev[y * w + wall] = elev[y * w + wall - gate.side];
  }
  for (let d = 1; d < SAND_REACH; d++) {
    const x = gate.side === 1 ? w - 1 - d : d;
    const spread = SAND_REACH - d;
    for (let y = gate.y0 - spread; y <= gate.y1 + spread; y++) {
      if (y < 0 || y >= h) continue;
      const i = y * w + x;
      if (SANDABLE.has(tiles[i])) tiles[i] = Tile.Sand;
    }
  }
}

/**
 * Landmarks in the same place on every panel, so the loop is legible: you
 * pass the same bleached rock and the same dead bush again, and again. All
 * kept off the panel edges, so they never block a crossing.
 */
const LANDMARKS: readonly { x: number; y: number; tile: Tile }[] = [
  { x: 4, y: 3, tile: Tile.Rock },
  { x: 11, y: 7, tile: Tile.Shrub },
  { x: 12, y: 7, tile: Tile.Rock },
  { x: 6, y: 8, tile: Tile.Gravel },
  { x: 7, y: 8, tile: Tile.Gravel },
  { x: 9, y: 2, tile: Tile.Gravel },
];

function blankDesert(): TileMap {
  const w = PANEL_W * 3;
  const h = PANEL_H * 3;
  return {
    w,
    h,
    ...blankPlanes(w, h, { tile: Tile.Sand, elev: 255, biome: Biome.Valley }),
    floods: false,
  };
}

function stampLandmarks(map: TileMap, px: number, py: number): void {
  for (const m of LANDMARKS) {
    map.tiles[(py * PANEL_H + m.y) * map.w + px * PANEL_W + m.x] = m.tile;
  }
}

function buildSand(): TileMap {
  const map = blankDesert();
  for (let py = 0; py < 3; py++) for (let px = 0; px < 3; px++) stampLandmarks(map, px, py);
  return map;
}

/**
 * The oasis: a pool ringed with grass and palms, a heart container on the
 * near bank. Its neighbours are ordinary sand, so you slide into it from the
 * dunes like any other screen.
 */
function buildOasis(): { oasis: TileMap; heart: { x: number; y: number } } {
  const map = blankDesert();
  for (let py = 0; py < 3; py++) {
    for (let px = 0; px < 3; px++) if (px !== 1 || py !== 1) stampLandmarks(map, px, py);
  }

  const ox = DESERT_CENTRE.x;
  const oy = DESERT_CENTRE.y;
  const set = (x: number, y: number, tile: Tile) => {
    map.tiles[(oy + y) * map.w + ox + x] = tile;
  };

  // Grass bank.
  for (let y = 2; y <= 8; y++) for (let x = 4; x <= 11; x++) set(x, y, Tile.Grass);
  // The pool.
  for (let y = 3; y <= 5; y++) for (let x = 6; x <= 9; x++) set(x, y, Tile.Water);
  set(5, 4, Tile.Water);
  set(10, 4, Tile.Water);
  // Palms.
  set(4, 2, Tile.Tree);
  set(11, 2, Tile.Tree);
  set(4, 7, Tile.Tree);
  set(11, 8, Tile.Tree);
  set(10, 6, Tile.Shrub);
  // The prize, on the near bank.
  const heart = { x: ox + 8, y: oy + 7 };
  map.tiles[heart.y * map.w + heart.x] = Tile.HeartContainer;

  return { oasis: map, heart };
}

/** The path as the stranger says it: "N, E, E, S, ...". */
export function spellCode(code: readonly Compass[]): string {
  return code.map((c) => COMPASS_LETTER[c]).join(', ');
}
