/**
 * Dungeon generation.
 *
 * A dungeon is a grid of rooms where **each room is exactly one panel**
 * (16x11), so it shares the overworld's byte format, its renderer, and the
 * inspector's panel view without a line of new drawing code.
 *
 * The structural guarantee mirrors the overworld's connectivity pass: a
 * randomised spanning tree from the entrance means every room is reachable,
 * and the key is placed strictly before the door it opens. Neither is left to
 * chance — both are asserted in tests across many seeds.
 *
 * What a dungeon costs you is the point. Obstacles are cleared with gopher
 * wood and fiber drawn from the same stock the ark needs, so a raid is a bet
 * against the hull.
 */

import { PANEL_H, PANEL_W } from './config.js';
import { type Rng, randInt, shuffle, stageRng } from './rng.js';
import { type TileMap, blankPlanes } from './tilemap.js';
import { type Biome, Resource, Tile } from './tiles.js';
import type { Point } from './world.js';

/** Rooms per side. 4x4 = 16 rooms = 64x44 tiles. */
export const DUNGEON_ROOMS = 4;

/** At most this many obstacles gate the route to the treasure. */
const MAX_OBSTACLES = 3;
/** ...and at most this many stand between the entrance and the key. */
const MAX_OBSTACLES_TO_KEY = 2;

export const enum Dir4 {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

const DIR_DX = [0, 1, 0, -1];
const DIR_DY = [-1, 0, 1, 0];
const OPPOSITE = [Dir4.South, Dir4.West, Dir4.North, Dir4.East];

export const enum RewardKind {
  HeartContainer = 0,
  /** Numbers 17 — the staff that budded. Harvest two per swing. */
  BuddingRod = 1,
  /** Exodus 7:12 — a serpent. One more tile of reach, and dredges two floods. */
  SerpentRod = 2,
  /** Colours the minimap. */
  Chart = 3,
  /** Wade depth 1. */
  Galoshes = 4,
}

export const REWARD_NAMES: Record<RewardKind, string> = {
  [RewardKind.HeartContainer]: 'Heart Container',
  [RewardKind.BuddingRod]: 'The Budding Rod',
  [RewardKind.SerpentRod]: 'The Serpent Rod',
  [RewardKind.Chart]: 'Chart',
  [RewardKind.Galoshes]: 'Galoshes',
};

/**
 * Fixed rod placements; Chart and Galoshes swap between forest and valley
 * per seed so both still appear every run.
 *
 * Mountain holds the Budding Rod behind pitch — it was free on day one when
 * it sat in the forest. The Serpent Rod dropped one biome to the scrub,
 * behind stone. The two major instruments share the lower pair.
 */
export const BIOME_REWARD: Record<number, RewardKind> = {
  0: RewardKind.Galoshes,
  1: RewardKind.Chart,
  2: RewardKind.SerpentRod,
  3: RewardKind.BuddingRod,
};

/** Resource the Rod must know to part that biome's vault seal. */
export const BIOME_SEAL_RESOURCE: Record<number, Resource> = {
  0: Resource.Fiber,
  1: Resource.Wood,
  2: Resource.Stone,
  3: Resource.Pitch,
};

export const SEAL_TILE: Record<number, Tile> = {
  [Resource.Fiber]: Tile.ReedSeal,
  [Resource.Wood]: Tile.WoodSeal,
  [Resource.Stone]: Tile.StoneSeal,
  [Resource.Pitch]: Tile.PitchSeal,
};

/**
 * Rod tier that parts the vault for this reward. Chart/Galoshes follow the
 * biome they actually landed in — use `BIOME_SEAL_RESOURCE` when you have
 * the dungeon, this table when you only have the kind.
 */
export const REWARD_SEAL: Record<RewardKind, number | null> = {
  [RewardKind.HeartContainer]: null,
  [RewardKind.BuddingRod]: Resource.Pitch,
  [RewardKind.SerpentRod]: Resource.Stone,
  [RewardKind.Chart]: Resource.Wood,
  [RewardKind.Galoshes]: Resource.Fiber,
};

/** Seed-stable assignment so forest and valley split Chart / Galoshes. */
export function pickDungeonReward(seed: number, biome: Biome): RewardKind {
  const rng = stageRng(seed, 'dungeon-rewards');
  const pair = shuffle(rng, [RewardKind.Chart, RewardKind.Galoshes]);
  switch (biome) {
    case 3:
      return RewardKind.BuddingRod;
    case 2:
      return RewardKind.SerpentRod;
    case 1:
      return pair[0];
    default:
      return pair[1];
  }
}

/** What clearing an obstacle costs. Pitch is never spendable. */
export const OBSTACLE_COST: Record<number, { resource: Resource; amount: number }> = {
  [Tile.Chasm]: { resource: Resource.Wood, amount: 2 },
  [Tile.Ledge]: { resource: Resource.Fiber, amount: 2 },
};

/** What an obstacle becomes once paid for. */
export const OBSTACLE_CLEARS_TO: Record<number, Tile> = {
  [Tile.Chasm]: Tile.Bridge,
  [Tile.Ledge]: Tile.Rope,
  [Tile.DoorLocked]: Tile.DoorOpen,
};

export type RoomKind = 'entrance' | 'plain' | 'key' | 'treasure';

export interface RoomMeta {
  rx: number;
  ry: number;
  kind: RoomKind;
  /** Tree distance from the entrance room, in rooms. */
  distance: number;
  /** Connected neighbour room index per direction, or -1. */
  links: [number, number, number, number];
}

export interface Dungeon extends TileMap {
  id: number;
  /** Which biome this dungeon sits in. Distinct from `biome`, the byte plane. */
  biomeKind: Biome;
  roomsX: number;
  roomsY: number;
  rooms: RoomMeta[];
  /** Stairs back to the overworld, in dungeon tile coordinates. */
  stairs: Point;
  /** Where this dungeon opens onto the overworld. */
  overworldEntrance: Point;
  chest: Point;
  key: Point;
  reward: RewardKind;
  /** Obstacles placed at generation time, for tests and the survey script. */
  obstacles: { tile: Tile; between: [number, number] }[];
}

export function generateDungeon(
  seed: number,
  id: number,
  biome: Biome,
  overworldEntrance: Point,
  roomsPerSide = DUNGEON_ROOMS,
): Dungeon {
  const rng = stageRng(seed, `dungeon:${id}`);
  const roomsX = roomsPerSide;
  const roomsY = roomsPerSide;
  const w = roomsX * PANEL_W;
  const h = roomsY * PANEL_H;

  const planes = blankPlanes(w, h, { tile: Tile.DungeonWall, elev: 255, biome });

  const rooms: RoomMeta[] = [];
  for (let ry = 0; ry < roomsY; ry++) {
    for (let rx = 0; rx < roomsX; rx++) {
      rooms.push({ rx, ry, kind: 'plain', distance: 0, links: [-1, -1, -1, -1] });
    }
  }

  const roomIndex = (rx: number, ry: number): number => ry * roomsX + rx;

  const entranceRoom = roomIndex(randInt(rng, 0, roomsX - 1), roomsY - 1);
  rooms[entranceRoom].kind = 'entrance';

  carveSpanningTree(rng, rooms, roomsX, roomsY, entranceRoom);
  addLoopEdges(rng, rooms, roomsX, roomsY);

  const distance = treeDistances(rooms, entranceRoom);
  for (let r = 0; r < rooms.length; r++) rooms[r].distance = distance[r];

  let treasureRoom = entranceRoom;
  for (let r = 0; r < rooms.length; r++) {
    if (distance[r] > distance[treasureRoom]) treasureRoom = r;
  }
  rooms[treasureRoom].kind = 'treasure';

  isolateTreasure(rooms, entranceRoom, treasureRoom);

  const parents = treeParents(rooms, entranceRoom);
  const pathEdges = pathToRoom(parents, treasureRoom);

  const obstacles: Dungeon['obstacles'] = [];

  if (pathEdges.length > 0) {
    const last = pathEdges[pathEdges.length - 1];
    setDoorTile(planes.tiles, w, rooms, last.from, last.dir, Tile.DoorLocked);
    obstacles.push({ tile: Tile.DoorLocked, between: [last.from, last.to] });
  }

  const approach = pathEdges.slice(0, -1);
  const chosen = shuffle(rng, approach.slice()).slice(0, MAX_OBSTACLES);
  for (const edge of chosen) {
    const tile = rng() < 0.5 ? Tile.Chasm : Tile.Ledge;
    setDoorTile(planes.tiles, w, rooms, edge.from, edge.dir, tile);
    obstacles.push({ tile, between: [edge.from, edge.to] });
  }

  const keyRoom = pickKeyRoom(rooms, parents, entranceRoom, treasureRoom, obstacles);
  rooms[keyRoom].kind = 'key';

  paintRooms(planes.tiles, w, rooms);
  scatterPits(rng, planes.tiles, w, rooms, entranceRoom);

  const stairs = roomCentre(rooms[entranceRoom]);
  const chest = roomCentre(rooms[treasureRoom]);
  const key = roomCentre(rooms[keyRoom]);

  planes.tiles[stairs.y * w + stairs.x] = Tile.Stairs;
  planes.tiles[chest.y * w + chest.x] = Tile.Chest;
  planes.tiles[key.y * w + key.x] = Tile.Key;

  return {
    id,
    biomeKind: biome,
    w,
    h,
    ...planes,
    floods: false,
    roomsX,
    roomsY,
    rooms,
    stairs,
    overworldEntrance,
    chest,
    key,
    reward: pickDungeonReward(seed, biome),
    obstacles,
  };
}

/** Row the seal spans in a one-room dungeon: between the chest and the key. */
const SEAL_ROW = 4;

/**
 * One panel, walls, a chest, and stairs. The overworld mouth warps here;
 * walking onto the stairs warps back. Enough cave to feel like a place
 * without a 16-room raid.
 */
export function generateDungeonRoom(
  _seed: number,
  id: number,
  biome: Biome,
  overworldEntrance: Point,
): Dungeon {
  const w = PANEL_W;
  const h = PANEL_H;
  const planes = blankPlanes(w, h, { tile: Tile.DungeonWall, elev: 255, biome });

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      planes.tiles[y * w + x] = Tile.DungeonFloor;
    }
  }

  const stairs = { x: (w / 2) | 0, y: h - 2 };
  const chest = { x: (w / 2) | 0, y: 2 };
  const key = { x: 3, y: 5 };
  planes.tiles[stairs.y * w + stairs.x] = Tile.Stairs;
  planes.tiles[chest.y * w + chest.x] = Tile.Chest;
  planes.tiles[key.y * w + key.x] = Tile.Key;

  const reward = pickDungeonReward(_seed, biome);
  const sealRes = BIOME_SEAL_RESOURCE[biome];
  const sealTile = SEAL_TILE[sealRes];
  if (sealTile !== undefined) {
    for (let x = 1; x < w - 1; x++) planes.tiles[SEAL_ROW * w + x] = sealTile;
  }

  return {
    id,
    biomeKind: biome,
    w,
    h,
    ...planes,
    floods: false,
    roomsX: 1,
    roomsY: 1,
    rooms: [{ rx: 0, ry: 0, kind: 'entrance', distance: 0, links: [-1, -1, -1, -1] }],
    stairs,
    overworldEntrance,
    chest,
    key,
    reward,
    obstacles: [],
  };
}

// ---------------------------------------------------------------- room graph

/** Randomised depth-first carve: every room reachable, no isolated pockets. */
function carveSpanningTree(
  rng: Rng,
  rooms: RoomMeta[],
  roomsX: number,
  roomsY: number,
  start: number,
): void {
  const visited = new Uint8Array(rooms.length);
  const stack: number[] = [start];
  visited[start] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const room = rooms[current];

    const options: Dir4[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = room.rx + DIR_DX[d];
      const ny = room.ry + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= roomsX || ny >= roomsY) continue;
      if (visited[ny * roomsX + nx]) continue;
      options.push(d as Dir4);
    }

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const dir = options[Math.floor(rng() * options.length)];
    const next = (room.ry + DIR_DY[dir]) * roomsX + (room.rx + DIR_DX[dir]);
    link(rooms, current, next, dir);
    visited[next] = 1;
    stack.push(next);
  }
}

function link(rooms: RoomMeta[], a: number, b: number, dir: Dir4): void {
  rooms[a].links[dir] = b;
  rooms[b].links[OPPOSITE[dir]] = a;
}

function addLoopEdges(rng: Rng, rooms: RoomMeta[], roomsX: number, roomsY: number): void {
  const candidates: { a: number; b: number; dir: Dir4 }[] = [];

  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let d = 0; d < 2; d++) {
      const dir = (d === 0 ? Dir4.East : Dir4.South) as Dir4;
      const nx = room.rx + DIR_DX[dir];
      const ny = room.ry + DIR_DY[dir];
      if (nx < 0 || ny < 0 || nx >= roomsX || ny >= roomsY) continue;
      if (room.links[dir] !== -1) continue;
      candidates.push({ a: r, b: ny * roomsX + nx, dir });
    }
  }

  const extra = Math.min(candidates.length, Math.max(1, Math.floor(rooms.length / 6)));
  for (const edge of shuffle(rng, candidates).slice(0, extra)) {
    link(rooms, edge.a, edge.b, edge.dir);
  }
}

function isolateTreasure(rooms: RoomMeta[], entranceRoom: number, treasureRoom: number): void {
  const keep = treeParents(rooms, entranceRoom)[treasureRoom];
  if (keep.from === -1) return;

  for (let d = 0; d < 4; d++) {
    const other = rooms[treasureRoom].links[d];
    if (other === -1 || other === keep.from) continue;
    rooms[treasureRoom].links[d] = -1;
    rooms[other].links[OPPOSITE[d]] = -1;
  }
}

function treeDistances(rooms: RoomMeta[], start: number): number[] {
  const dist = new Array<number>(rooms.length).fill(-1);
  const queue = [start];
  dist[start] = 0;

  for (let head = 0; head < queue.length; head++) {
    const r = queue[head];
    for (const next of rooms[r].links) {
      if (next === -1 || dist[next] !== -1) continue;
      dist[next] = dist[r] + 1;
      queue.push(next);
    }
  }

  return dist;
}

function treeParents(rooms: RoomMeta[], start: number): { from: number; dir: Dir4 }[] {
  const parents: { from: number; dir: Dir4 }[] = rooms.map(() => ({
    from: -1,
    dir: Dir4.North,
  }));
  const seen = new Uint8Array(rooms.length);
  const queue = [start];
  seen[start] = 1;

  for (let head = 0; head < queue.length; head++) {
    const r = queue[head];
    for (let d = 0; d < 4; d++) {
      const next = rooms[r].links[d];
      if (next === -1 || seen[next]) continue;
      seen[next] = 1;
      parents[next] = { from: r, dir: d as Dir4 };
      queue.push(next);
    }
  }

  return parents;
}

function pathToRoom(
  parents: { from: number; dir: Dir4 }[],
  target: number,
): { from: number; to: number; dir: Dir4 }[] {
  const edges: { from: number; to: number; dir: Dir4 }[] = [];
  let current = target;
  let guard = parents.length + 1;

  while (parents[current].from !== -1 && guard-- > 0) {
    const { from, dir } = parents[current];
    edges.push({ from, to: current, dir });
    current = from;
  }

  return edges.reverse();
}

function pickKeyRoom(
  rooms: RoomMeta[],
  parents: { from: number; dir: Dir4 }[],
  entranceRoom: number,
  treasureRoom: number,
  obstacles: Dungeon['obstacles'],
): number {
  const blocked = new Set(obstacles.map((o) => `${o.between[0]}-${o.between[1]}`));

  let best = entranceRoom;
  let bestDistance = -1;

  for (let r = 0; r < rooms.length; r++) {
    if (r === treasureRoom || r === entranceRoom) continue;

    const edges = pathToRoom(parents, r);
    const crossesLock = edges.some((e) => {
      const o = obstacles.find((ob) => ob.between[0] === e.from && ob.between[1] === e.to);
      return o?.tile === Tile.DoorLocked;
    });
    if (crossesLock) continue;

    const cost = edges.filter((e) => blocked.has(`${e.from}-${e.to}`)).length;
    if (cost > MAX_OBSTACLES_TO_KEY) continue;

    if (rooms[r].distance > bestDistance) {
      bestDistance = rooms[r].distance;
      best = r;
    }
  }

  return best;
}

function roomOrigin(room: RoomMeta): Point {
  return { x: room.rx * PANEL_W, y: room.ry * PANEL_H };
}

function roomCentre(room: RoomMeta): Point {
  const o = roomOrigin(room);
  return { x: o.x + (PANEL_W >> 1), y: o.y + (PANEL_H >> 1) };
}

export function doorTiles(room: RoomMeta, dir: Dir4): Point[] {
  const o = roomOrigin(room);
  const out: Point[] = [];

  if (dir === Dir4.East || dir === Dir4.West) {
    const x = dir === Dir4.East ? o.x + PANEL_W - 1 : o.x;
    const step = dir === Dir4.East ? 1 : -1;
    for (let dy = -1; dy <= 1; dy++) {
      out.push({ x, y: o.y + (PANEL_H >> 1) + dy });
      out.push({ x: x + step, y: o.y + (PANEL_H >> 1) + dy });
    }
  } else {
    const y = dir === Dir4.South ? o.y + PANEL_H - 1 : o.y;
    const step = dir === Dir4.South ? 1 : -1;
    for (let dx = 0; dx <= 1; dx++) {
      out.push({ x: o.x + (PANEL_W >> 1) - 1 + dx, y });
      out.push({ x: o.x + (PANEL_W >> 1) - 1 + dx, y: y + step });
    }
  }

  return out;
}

function setDoorTile(
  tiles: Uint8Array,
  w: number,
  rooms: RoomMeta[],
  roomIdx: number,
  dir: Dir4,
  tile: Tile,
): void {
  for (const p of doorTiles(rooms[roomIdx], dir)) {
    if (p.x < 0 || p.y < 0) continue;
    tiles[p.y * w + p.x] = tile;
  }
}

function scatterPits(
  rng: Rng,
  tiles: Uint8Array,
  w: number,
  rooms: RoomMeta[],
  entranceRoom: number,
): void {
  for (let r = 0; r < rooms.length; r++) {
    if (r === entranceRoom) continue;
    if (rng() > 0.55) continue;

    const o = roomOrigin(rooms[r]);
    const count = randInt(rng, 1, 3);

    for (let n = 0; n < count; n++) {
      const x = o.x + randInt(rng, 3, PANEL_W - 4);
      const y = o.y + randInt(rng, 3, PANEL_H - 4);
      const i = y * w + x;
      if (tiles[i] === Tile.DungeonFloor) tiles[i] = Tile.Pit;
    }
  }
}

function paintRooms(tiles: Uint8Array, w: number, rooms: RoomMeta[]): void {
  for (const room of rooms) {
    const o = roomOrigin(room);
    for (let ty = 1; ty < PANEL_H - 1; ty++) {
      for (let tx = 1; tx < PANEL_W - 1; tx++) {
        const i = (o.y + ty) * w + (o.x + tx);
        if (tiles[i] === Tile.DungeonWall) tiles[i] = Tile.DungeonFloor;
      }
    }
  }

  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let d = 0; d < 4; d++) {
      if (room.links[d] === -1) continue;
      for (const p of doorTiles(room, d as Dir4)) {
        const i = p.y * w + p.x;
        if (tiles[i] === Tile.DungeonWall) tiles[i] = Tile.DungeonFloor;
      }
    }
  }
}
