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
  /** Exodus 7:12 — the rod that became a serpent. One more tile of reach. */
  SerpentRod = 2,
}

export const REWARD_NAMES: Record<RewardKind, string> = {
  [RewardKind.HeartContainer]: 'Heart Container',
  [RewardKind.BuddingRod]: 'The Budding Rod',
  [RewardKind.SerpentRod]: 'The Serpent Rod',
};

/**
 * Fixed per biome so every run offers the whole set and tests stay
 * deterministic. The Budding Rod sits in the forest on purpose: it doubles
 * harvest yield, so it wants to land mid-run while doubling still pays.
 */
export const BIOME_REWARD: Record<number, RewardKind> = {
  0: RewardKind.HeartContainer,
  1: RewardKind.BuddingRod,
  2: RewardKind.HeartContainer,
  3: RewardKind.SerpentRod,
};

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

  // Solid rock, carved into rooms below. Maximum elevation so the flood can
  // never reach underground even if `floods` were ignored.
  const planes = blankPlanes(w, h, { tile: Tile.DungeonWall, elev: 255, biome });

  const rooms: RoomMeta[] = [];
  for (let ry = 0; ry < roomsY; ry++) {
    for (let rx = 0; rx < roomsX; rx++) {
      rooms.push({ rx, ry, kind: 'plain', distance: 0, links: [-1, -1, -1, -1] });
    }
  }

  const roomIndex = (rx: number, ry: number): number => ry * roomsX + rx;

  // The entrance sits on the bottom row: you descend from the overworld.
  const entranceRoom = roomIndex(randInt(rng, 0, roomsX - 1), roomsY - 1);
  rooms[entranceRoom].kind = 'entrance';

  carveSpanningTree(rng, rooms, roomsX, roomsY, entranceRoom);

  // Loops first, so they make it feel like a place rather than a corridor.
  // Distances are then measured on the graph the player actually walks — pick
  // the treasure before adding loops and a shortcut can quietly bypass the very
  // edges the obstacles were placed to gate.
  addLoopEdges(rng, rooms, roomsX, roomsY);

  const distance = treeDistances(rooms, entranceRoom);
  for (let r = 0; r < rooms.length; r++) rooms[r].distance = distance[r];

  // Furthest room from the entrance holds the prize.
  let treasureRoom = entranceRoom;
  for (let r = 0; r < rooms.length; r++) {
    if (distance[r] > distance[treasureRoom]) treasureRoom = r;
  }
  rooms[treasureRoom].kind = 'treasure';

  // Seal the treasure down to a single approach, so the lock is a real gate
  // rather than one of several ways in.
  isolateTreasure(rooms, entranceRoom, treasureRoom);

  const parents = treeParents(rooms, entranceRoom);
  const pathEdges = pathToRoom(parents, treasureRoom);

  const obstacles: Dungeon['obstacles'] = [];

  // The lock goes on the final edge into the treasure room.
  if (pathEdges.length > 0) {
    const last = pathEdges[pathEdges.length - 1];
    setDoorTile(planes.tiles, w, rooms, last.from, last.dir, Tile.DoorLocked);
    obstacles.push({ tile: Tile.DoorLocked, between: [last.from, last.to] });
  }

  // Obstacles on the remaining approach, capped so a raid costs 4-6 units
  // rather than a whole hull.
  const approach = pathEdges.slice(0, -1);
  const chosen = shuffle(rng, approach.slice()).slice(0, MAX_OBSTACLES);
  for (const edge of chosen) {
    const tile = rng() < 0.5 ? Tile.Chasm : Tile.Ledge;
    setDoorTile(planes.tiles, w, rooms, edge.from, edge.dir, tile);
    obstacles.push({ tile, between: [edge.from, edge.to] });
  }

  // The key must sit somewhere reachable without the door it opens, and behind
  // no more than MAX_OBSTACLES_TO_KEY of them.
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
    reward: BIOME_REWARD[biome] ?? RewardKind.HeartContainer,
    obstacles,
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

/** A handful of extra connections, so the layout has loops rather than one spine. */
function addLoopEdges(rng: Rng, rooms: RoomMeta[], roomsX: number, roomsY: number): void {
  const candidates: { a: number; b: number; dir: Dir4 }[] = [];

  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let d = 0; d < 2; d++) {
      // Only East and South, so each pair is considered once.
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

/**
 * Cut every approach to the treasure but one.
 *
 * The lock only means something if there is a single way in. The surviving
 * edge is the treasure's parent on the shortest route from the entrance, so
 * the room stays reachable and the door stays on the path you would walk.
 */
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

/** Breadth-first distances over the room graph. */
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

/** BFS parent per room, plus the direction travelled to reach it. */
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

/** Edges from the entrance to a room, in order. */
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

/**
 * A room that is reachable without opening the locked door, and behind no more
 * than MAX_OBSTACLES_TO_KEY obstacles. Prefers the furthest such room, so the
 * key is still worth walking for.
 */
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
    // Crossing the lock would put the key behind the door it opens.
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

// ---------------------------------------------------------------- painting

/** Top-left tile of a room. */
function roomOrigin(room: RoomMeta): Point {
  return { x: room.rx * PANEL_W, y: room.ry * PANEL_H };
}

function roomCentre(room: RoomMeta): Point {
  const o = roomOrigin(room);
  return { x: o.x + (PANEL_W >> 1), y: o.y + (PANEL_H >> 1) };
}

/**
 * Tiles forming the doorway between a room and its neighbour in `dir`.
 * The gap spans both sides of the shared boundary, so an obstacle placed here
 * is a single band rather than two the player has to pay for twice.
 */
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

/**
 * Pits in room interiors: the hazard that makes a dungeon dangerous rather
 * than merely expensive.
 *
 * Kept well clear of walls and doorways so a pit can always be walked around —
 * a pit that seals a corridor would be an obstacle, and obstacles are supposed
 * to be things you pay to cross, not things you blunder into. The entrance room
 * gets none, so arriving is never an ambush.
 */
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
      // Inset by 3 keeps pits off the walls and out of every doorway lane.
      const x = o.x + randInt(rng, 3, PANEL_W - 4);
      const y = o.y + randInt(rng, 3, PANEL_H - 4);
      const i = y * w + x;
      if (tiles[i] === Tile.DungeonFloor) tiles[i] = Tile.Pit;
    }
  }
}

/**
 * Hollow out each room, then re-open its doorways.
 *
 * Obstacles were written into the doorways first, so this preserves anything
 * already sitting there rather than paving over it.
 */
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
