/**
 * Characterization of the E key.
 *
 * Captured on the code as it stood before `state.ts` was split, and committed
 * as snapshots. The refactor must leave every one of these byte-identical:
 * the HUD prompt, and what one press of E then does.
 *
 * Two scenarios pin places where the prompt and the key disagree — see
 * "divergences" below. They are recorded as-is on purpose, so that any
 * change to them is a deliberate, reviewed change rather than a side effect.
 * (A third, E releasing the dove underground, was a bug and is now fixed.)
 */

import { describe, expect, it } from 'vitest';
import { Biome, Resource, Tile } from '../src/core/tiles.js';
import { InteriorKind, generateInterior } from '../src/core/interior.js';
import { AnimalKind, AnimalStatus } from '../src/core/animals.js';
import { Dir, step, type GameState } from '../src/game/state.js';
import {
  newGame,
  placeAt,
  pressE,
  promptOf,
  setTile,
  stage,
} from './support/scenario.js';

function overworldAt(biome: Biome, tile: Tile, setup?: (s: GameState) => void) {
  const s = newGame();
  const at = stage(s);
  setTile(s, at.x, at.y, tile, biome);
  setup?.(s);
  return s;
}

function inInterior(kind: InteriorKind, onFocus = true) {
  const s = newGame();
  // Small test worlds don't always site every kind (no mountain town means no
  // hermitage), so build one with the game's own generator when it's missing.
  let room = s.world.interiors.find((r) => r.kind === kind);
  if (!room) {
    const biome = kind === InteriorKind.Hermit ? Biome.Mountain : Biome.Valley;
    room = generateInterior(kind, s.world.interiors.length, biome, { x: 5, y: 5 });
    s.world.interiors.push(room);
    s.exploredInteriors.push(new Uint8Array(1));
  }
  s.location = { kind: 'interior', dungeonId: -1, interiorId: room.id, returnTo: room.overworldEntrance };
  const spot = onFocus ? room.focus : { x: room.focus.x - 3, y: room.focus.y + 3 };
  placeAt(s, spot.x, spot.y);
  return s;
}

/** Stand in cave 0, one tile south of `tile`, facing it. */
function facingInCave(tile: Tile | null, setup?: (s: GameState) => void) {
  const s = newGame();
  const cave = s.world.dungeons[0];
  s.location = { kind: 'dungeon', dungeonId: 0, interiorId: -1, returnTo: cave.overworldEntrance };
  const x = cave.chest.x;
  const y = 6;
  if (tile !== null) cave.tiles[(y - 1) * cave.w + x] = tile;
  placeAt(s, x, y);
  s.player.dir = Dir.Up;
  setup?.(s);
  return s;
}

describe('E: shrines', () => {
  it('imbues the Rod when affordable', () => {
    const s = overworldAt(Biome.Valley, Tile.Shrine, (g) => (g.carried[Resource.Fiber] = 40));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('asks for more when short', () => {
    const s = overworldAt(Biome.Valley, Tile.Shrine, (g) => (g.carried[Resource.Fiber] = 3));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('is silent above the Rod', () => {
    expect(pressE(overworldAt(Biome.Scrub, Tile.Shrine))).toMatchSnapshot();
  });
  it('is spent below the Rod', () => {
    const s = overworldAt(Biome.Valley, Tile.Shrine, (g) => (g.rodTier = 2));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('crowns the Rod at the mountain', () => {
    const s = overworldAt(Biome.Mountain, Tile.Shrine, (g) => {
      g.rodTier = 3;
      g.carried[Resource.Pitch] = 30;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
});

describe('E: settlements without an interior behind them', () => {
  it('offers the first market item, unaffordable', () => {
    expect(pressE(overworldAt(Biome.Forest, Tile.TownDoor))).toMatchSnapshot();
  });
  it('buys the first market item when affordable', () => {
    const s = overworldAt(Biome.Forest, Tile.TownDoor, (g) => g.carried.fill(99));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('has nothing left once everything is owned', () => {
    const s = overworldAt(Biome.Forest, Tile.TownDoor, (g) => {
      g.hasAxe = true;
      g.axeDurability = 5;
      g.hasSoundingLine = true;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
  it('lets the hermit ask for a sheep you do not have', () => {
    expect(pressE(overworldAt(Biome.Mountain, Tile.TownDoor))).toMatchSnapshot();
  });
  it('trades a rescued sheep for a heart', () => {
    const s = overworldAt(Biome.Mountain, Tile.TownDoor, (g) => {
      const sheep = g.world.animals.find((a) => a.kind === AnimalKind.Sheep);
      if (sheep) sheep.status = AnimalStatus.Boarded;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
});

describe('E: interiors', () => {
  it('walks into a real town door', () => {
    const s = newGame();
    const room = s.world.interiors.find((r) => r.kind === InteriorKind.Shop);
    if (!room) throw new Error('no shop');
    placeAt(s, room.overworldEntrance.x, room.overworldEntrance.y);
    expect(pressE(s)).toMatchSnapshot();
  });
  it('trades at a shop counter', () => {
    const s = inInterior(InteriorKind.Shop);
    s.carried.fill(99);
    expect(pressE(s)).toMatchSnapshot();
  });
  it('trades at the hermit counter', () => {
    expect(pressE(inInterior(InteriorKind.Hermit))).toMatchSnapshot();
  });
  it('frames a skiff at the carpenter', () => {
    const s = inInterior(InteriorKind.Carpenter);
    s.carried.fill(99);
    expect(pressE(s)).toMatchSnapshot();
  });
  it('rests in the tent', () => {
    expect(pressE(inInterior(InteriorKind.NoahTent))).toMatchSnapshot();
  });
});

describe('E: the boatyard without an interior', () => {
  it('frames a skiff', () => {
    const s = overworldAt(Biome.Valley, Tile.BoatYard, (g) => g.carried.fill(99));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('asks for timber when short', () => {
    expect(pressE(overworldAt(Biome.Valley, Tile.BoatYard))).toMatchSnapshot();
  });
  it('recaulks a hauled skiff at a high yard', () => {
    const s = overworldAt(Biome.Scrub, Tile.BoatYard, (g) => {
      g.hasBoat = true;
      g.haulingBoat = true;
      g.carried.fill(99);
    });
    expect(pressE(s)).toMatchSnapshot();
  });
});

describe('E: the skiff', () => {
  it('takes hold of a set-down skiff', () => {
    const s = overworldAt(Biome.Valley, Tile.Skiff, (g) => {
      g.hasBoat = true;
      g.boatX = Math.floor(g.world.w / 2);
      g.boatY = Math.floor(g.world.h / 2);
    });
    expect(pressE(s)).toMatchSnapshot();
  });
  it('launches from the shore', () => {
    const s = overworldAt(Biome.Valley, Tile.Grass, (g) => {
      g.hasBoat = true;
      g.haulingBoat = true;
      const x = Math.floor(g.world.w / 2);
      const y = Math.floor(g.world.h / 2);
      setTile(g, x + 1, y, Tile.Water);
    });
    expect(pressE(s)).toMatchSnapshot();
  });
  it('sets the skiff down on dry ground', () => {
    const s = overworldAt(Biome.Valley, Tile.Grass, (g) => {
      g.hasBoat = true;
      g.haulingBoat = true;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
  it('refuses to set the skiff down on a road-less shrine', () => {
    const s = overworldAt(Biome.Valley, Tile.Pedestal, (g) => {
      g.hasBoat = true;
      g.haulingBoat = true;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
});

describe('E: dredging from the skiff (a prompt-only hint)', () => {
  function sailingAt(depthDays: number, withLine: boolean, extra?: (s: GameState) => void) {
    const s = overworldAt(Biome.Valley, Tile.Water, (g) => {
      g.hasBoat = true;
      g.inBoat = true;
      g.hasSoundingLine = withLine;
      const x = Math.floor(g.world.w / 2);
      const y = Math.floor(g.world.h / 2);
      setTile(g, x + 1, y, Tile.Flax);
      g.world.elev[y * g.world.w + x + 1] = 0;
      g.elapsed = g.world.params.secondsPerDay * depthDays;
      g.player.dir = Dir.Right;
      extra?.(g);
    });
    return s;
  }
  it('within reach', () => expect(pressE(sailingAt(2.5, false))).toMatchSnapshot());
  it('beyond reach', () => expect(pressE(sailingAt(4, false))).toMatchSnapshot());
  it('with the sounding line', () => expect(pressE(sailingAt(2.5, true))).toMatchSnapshot());
});

describe('E: cave seals and tolls', () => {
  it('parts a seal the Rod knows', () => {
    const s = facingInCave(Tile.ReedSeal, (g) => (g.rodTier = 1));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('holds a seal the Rod does not know', () => {
    expect(pressE(facingInCave(Tile.PitchSeal))).toMatchSnapshot();
  });
  it('opens a locked door with a key', () => {
    expect(pressE(facingInCave(Tile.DoorLocked, (g) => (g.keysHeld = 1)))).toMatchSnapshot();
  });
  it('refuses a locked door without one', () => {
    expect(pressE(facingInCave(Tile.DoorLocked))).toMatchSnapshot();
  });
  it('bridges a chasm with wood', () => {
    const s = facingInCave(Tile.Chasm, (g) => (g.carried[Resource.Wood] = 5));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('refuses a ledge without fiber', () => {
    expect(pressE(facingInCave(Tile.Ledge))).toMatchSnapshot();
  });
});

describe('E: the dove and nothing at all', () => {
  it('releases the dove outdoors', () => {
    const s = overworldAt(Biome.Valley, Tile.Grass, (g) => (g.hasDove = true));
    expect(pressE(s)).toMatchSnapshot();
  });
  it('does nothing with nothing to do', () => {
    expect(pressE(overworldAt(Biome.Valley, Tile.Grass))).toMatchSnapshot();
  });
  it('underground with the dove: no prompt, and E keeps the dove', () => {
    // Once E released it here too, reading bearings off the overworld at
    // cave coordinates. The dove scouts the open sky only.
    const { prompt, after } = pressE(facingInCave(null, (g) => (g.hasDove = true)));
    expect(prompt).toBeNull();
    expect(after.kit).toContain('dove');
    expect(after.message).toBeNull();
  });
});

describe('E: divergences between the prompt and the key, recorded as-is', () => {
  it('(a) in a room, off the counter: no prompt, but E speaks', () => {
    expect(pressE(inInterior(InteriorKind.Shop, false))).toMatchSnapshot();
  });
  it('(b) sailing with a dredge hint showing: E releases the dove instead', () => {
    const s = overworldAt(Biome.Valley, Tile.Water, (g) => {
      g.hasBoat = true;
      g.inBoat = true;
      g.hasDove = true;
      const x = Math.floor(g.world.w / 2);
      const y = Math.floor(g.world.h / 2);
      setTile(g, x + 1, y, Tile.Flax);
      g.world.elev[y * g.world.w + x + 1] = 0;
      g.elapsed = g.world.params.secondsPerDay * 2.5;
      g.player.dir = Dir.Right;
    });
    expect(pressE(s)).toMatchSnapshot();
  });
});

describe('walking, not E: cave and room mouths', () => {
  it('walks into a cave from the south and back out by the stairs', () => {
    const s = newGame();
    const cave = s.world.dungeons[0];
    const m = cave.overworldEntrance;
    placeAt(s, m.x, m.y + 1);
    const trail: unknown[] = [promptOf(s)];
    for (let n = 0; n < 40 && s.location.kind === 'overworld'; n++) {
      walk(s, -1);
    }
    trail.push({ where: s.location.kind });
    for (let n = 0; n < 200 && s.location.kind !== 'overworld'; n++) {
      walk(s, 1);
    }
    trail.push({ where: s.location.kind, message: s.message });
    expect(trail).toMatchSnapshot();
  });
});

/** One movement step: walking, not E, is what carries a warp. */
function walk(s: GameState, moveY: number): void {
  step(s, { moveX: 0, moveY, attackPressed: false }, 1 / 60);
}
