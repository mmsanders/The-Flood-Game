/**
 * The endless sand, as the player meets it: walking off the edge, the loop
 * that folds every screen back onto itself, the stranger's path, and the
 * oasis at the end of it. The maps themselves are built in `core/desert.ts`.
 */

import { PANEL_H, PANEL_PX_H, PANEL_PX_W, PANEL_W, TILE_PX } from '../core/config.js';
import {
  Compass,
  DESERT_CENTRE,
  DESERT_CODE_LEN,
  spellCode,
} from '../core/desert.js';
import { placeOn } from './camera.js';
import { depthAt, say, waterLevel } from './queries.js';
import { Dir, type GameState, PLAYER_H, PLAYER_W } from './types.js';

/** What the sand says when you walk into it. Round-one note 5, verbatim. */
export const SAND_LINE = 'Endless sand stretches in every direction...';

/** Seconds the stranger's path stays on screen. Long enough to copy down. */
export const PATH_BANNER_TIME = 9;

/**
 * Can the hitbox stand on this out-of-bounds tile? Only through the gate:
 * the edge columns beside the sand, on foot, while the gate itself is dry.
 */
export function desertOpening(state: GameState, tx: number, ty: number): boolean {
  const desert = state.world.desert;
  if (!desert || state.location.kind !== 'overworld') return false;
  if (state.inBoat || state.haulingBoat) return false;
  const { gate } = desert;
  const edge = gate.side === 1 ? state.world.w - 1 : 0;
  if (tx !== edge + gate.side) return false;
  if (ty < gate.y0 || ty > gate.y1) return false;
  return depthAt(state, edge, ty) === 0;
}

/** Called after movement: has Noah walked off the edge into the sand? */
export function tryEnterDesert(state: GameState): void {
  const desert = state.world.desert;
  if (!desert || state.location.kind !== 'overworld') return;
  const cx = state.player.x + PLAYER_W / 2;
  const { gate } = desert;
  const out = gate.side === 1 ? cx >= state.world.w * TILE_PX : cx < 0;
  if (!out) return;

  const ty = Math.floor((state.player.y + PLAYER_H / 2) / TILE_PX);
  const edge = gate.side === 1 ? state.world.w - 1 : 0;
  state.location = {
    kind: 'desert',
    dungeonId: -1,
    interiorId: -1,
    returnTo: { x: edge, y: Math.min(gate.y1, Math.max(gate.y0, ty)) },
  };
  state.safeSpot = null;
  state.inOasis = false;
  state.desertSteps = 0;
  // In on the side you walked in from, at the middle of the centre panel.
  const x = gate.side === 1 ? DESERT_CENTRE.x : DESERT_CENTRE.x + PANEL_W - 1;
  placeOn(state, { x, y: DESERT_CENTRE.y + Math.floor(PANEL_H / 2) });
  say(state, SAND_LINE);
}

/**
 * Called after the camera has noticed a panel crossing. In the sand, fold
 * the crossing back: move player and camera one panel the other way, so the
 * slide that has just begun ends on the centre panel — which is identical to
 * the one being left. Every step but back is counted against the path.
 */
export function wrapDesert(state: GameState): void {
  if (state.location.kind !== 'desert') return;
  const desert = state.world.desert;
  const cam = state.camera;
  const dx = cam.panelX - 1;
  const dy = cam.panelY - 1;
  if (!desert || (dx === 0 && dy === 0)) return;

  const way = compassOf(dx, dy);
  if (state.inOasis || way === desert.gate.back || way === null) {
    leaveDesert(state);
    return;
  }

  const p = state.player;
  p.x -= dx * PANEL_PX_W;
  p.y -= dy * PANEL_PX_H;
  p.prevX -= dx * PANEL_PX_W;
  p.prevY -= dy * PANEL_PX_H;
  cam.fromX = 1 - dx;
  cam.fromY = 1 - dy;
  cam.panelX = 1;
  cam.panelY = 1;

  const { code } = desert.gate;
  if (code[state.desertSteps] === way) state.desertSteps++;
  else state.desertSteps = code[0] === way ? 1 : 0;

  if (state.desertSteps >= DESERT_CODE_LEN) {
    state.inOasis = true;
    state.mapRevision++;
    say(state, 'Water. Palms. Footprints that are not yours.');
  }
}

function compassOf(dx: number, dy: number): Compass | null {
  if (dx === 1 && dy === 0) return Compass.East;
  if (dx === -1 && dy === 0) return Compass.West;
  if (dx === 0 && dy === -1) return Compass.North;
  if (dx === 0 && dy === 1) return Compass.South;
  return null;
}

/** Back onto the world map, at the gate, facing in. */
export function leaveDesert(state: GameState): void {
  const back = state.location.returnTo;
  const desert = state.world.desert;
  if (state.location.kind !== 'desert' || !back || !desert) return;
  const wasOasis = state.inOasis;
  state.location = { kind: 'overworld', dungeonId: -1, interiorId: -1, returnTo: null };
  state.inOasis = false;
  state.desertSteps = 0;
  placeOn(state, back);
  state.player.dir = desert.gate.side === 1 ? Dir.Left : Dir.Right;
  say(
    state,
    wasOasis ? 'And out again, as if the sand had let you go.' : 'Solid ground. The sand keeps its own counsel.',
  );
}

/** The carpenter's mat: stand beside the stranger and press E. */
export function strangerPrompt(): { label: string; affordable: boolean } {
  return { label: 'Talk to the stranger', affordable: true };
}

export function talkToStranger(state: GameState): void {
  const desert = state.world.desert;
  if (!desert) {
    say(state, '"I came out of the far sand once. The sea will have it now."');
    return;
  }
  const { gate } = desert;
  const edge = gate.side === 1 ? state.world.w - 1 : 0;
  const side = gate.side === 1 ? 'east' : 'west';
  // Asked indoors, so read the sea against the gate directly, not the room.
  if (state.world.elev[gate.y1 * state.world.w + edge] < waterLevel(state)) {
    say(state, `"The ${side} sand is under the sea now. A pity. There was water in it."`);
    return;
  }
  state.banner = {
    title: spellCode(gate.code),
    line: `"Walk off the far south-${side} edge, into the sand. Go so, and find water."`,
    time: PATH_BANNER_TIME,
  };
  state.bannerTimer = PATH_BANNER_TIME;
}
