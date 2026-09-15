/**
 * Game rendering.
 *
 * Fixed 256x224 back buffer — a 256x176 Zelda 1 screen with a 48px status bar
 * above it — scaled up by whole numbers with smoothing off. Everything is
 * drawn from the shared tilesheet, so the game and the dev tool's panel
 * inspector cannot drift apart.
 */

import { PANEL_H, PANEL_PX_H, PANEL_PX_W, PANEL_W, TILE_PX } from '../core/config.js';
import { ANIMAL_DEFS, ANIMAL_H, ANIMAL_W, AnimalDir, AnimalStatus, FLOCK_TOTAL } from '../core/animals.js';
import { floodDepth, floodOverlayFill } from '../core/flood.js';
import { panelsHigh, panelsWide, type TileMap } from '../core/tilemap.js';
import { Biome, RESOURCE_COUNT, Resource, Tile, carveTo } from '../core/tiles.js';
import { PALETTE } from '../render/palette.js';
import { getTilesheet, tileSheetX, tileSheetY } from '../render/tilesheet.js';
import {
  MINIMAP_H,
  MINI_POI_COLOR,
  MINIMAP_W,
  MINIMAP_X,
  MINIMAP_Y,
  type MiniMapLayout,
  MiniPoi,
  cellRect,
  countVisited,
  followMinimapView,
  layoutMiniMap,
  panelPoiIndex,
  sampleMinimapInto,
  visitedCells,
} from './minimap.js';
import {
  Dir,
  type GameState,
  PLAYER_H,
  PLAYER_W,
  actionPrompt,
  activeMap,
  arkProgress,
  currentDay,
  currentDungeon,
  flockScore,
  waterLevel,
} from './state.js';
import { isDaylight, todAt } from './tod.js';
import type { BestFlock } from './persist.js';
import { MISS_RATIO, type PerfSnapshot } from './perf.js';

export const HUD_H = 48;
export const SCREEN_W = PANEL_PX_W;
export const SCREEN_H = PANEL_PX_H + HUD_H;

const RESOURCE_COLOR = [PALETTE.flax, PALETTE.gopher, PALETTE.stoneNode, '#6a625c'];
const RESOURCE_INITIAL = ['F', 'W', 'S', 'P'];
const ROD_SHAFT = ['#c8a06a', '#7a4a1e', '#8b8578', '#4a4038', '#241f1c'];
const ROD_BUD = ['#7fd06a', '#d9d05a', '#c48a48', '#9aa0a6', '#e8c84a'];
const SERPENT_BODY = '#3f8a44';
const SERPENT_BELLY = '#d2dc78';
const SERPENT_TONGUE = '#c83c3c';

export interface RenderUi {
  bestiary?: boolean;
  best?: BestFlock;
  /**
   * How far the display is between the last two simulation steps, 0..1.
   *
   * The simulation is pinned at 60Hz; the display runs at whatever it runs at.
   * Drawing at `previous + (current - previous) * alpha` is what makes a 144Hz
   * screen genuinely smoother rather than just showing each state twice.
   * Defaults to 1 — the current state — for tests and single-shot renders.
   */
  alpha?: number;
  perf?: PerfSnapshot | null;
}

/**
 * The alpha for the frame being drawn.
 *
 * Module-scoped rather than threaded through every draw function: it is a
 * property of the frame, it never outlives one `render` call, and passing it
 * down by hand would put an unused parameter on a dozen signatures.
 */
let renderAlpha = 1;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, ui?: RenderUi): void {
  renderAlpha = ui?.alpha ?? 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HUD_H, SCREEN_W, PANEL_PX_H);
  ctx.clip();
  ctx.translate(0, HUD_H);
  drawWorld(ctx, state);
  drawArkMonument(ctx, state);
  drawAnimals(ctx, state);
  drawPlayer(ctx, state);
  drawTodFilter(ctx, state);
  ctx.restore();

  drawHud(ctx, state);
  drawObstaclePrompt(ctx, state);
  drawMessage(ctx, state);
  if (state.phase !== 'playing') drawEndCard(ctx, state);
  if (ui?.bestiary) drawBestiary(ctx, state, ui.best ?? { pairs: 0, rescued: 0 });
  if (ui?.perf) drawPerf(ctx, ui.perf);
}

/**
 * The price tag, shown while you are standing in front of the thing it buys.
 *
 * Dungeon obstacles are paid for out of the same stock the ark needs, so the
 * cost and your balance belong on screen at the moment of the decision — not
 * discovered afterwards in a shrinking inventory.
 */
function drawObstaclePrompt(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.phase !== 'playing') return;
  const prompt = actionPrompt(state);
  if (!prompt) return;

  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = prompt.affordable ? `${prompt.label}  [E]` : prompt.label;
  const w = Math.min(SCREEN_W - 8, ctx.measureText(text).width + 16);
  const x = (SCREEN_W - w) / 2;
  const y = HUD_H + 8;

  ctx.fillStyle = PALETTE.hudBack;
  ctx.fillRect(x, y, w, 15);
  ctx.strokeStyle = prompt.affordable ? PALETTE.ark : '#6a4a4a';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 14);

  ctx.fillStyle = prompt.affordable ? '#e6e9ef' : '#e0908a';
  ctx.fillText(text, SCREEN_W / 2, y + 8);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/**
 * Camera origin in world pixels, interpolated during a panel transition.
 *
 * Writes into a shared result rather than returning a fresh object: this is
 * called three times a frame, and a steady drip of short-lived objects is
 * what eventually buys you a collection pause in the middle of a swing.
 */
const camScratch = { x: 0, y: 0 };

export function cameraOrigin(state: GameState): { x: number; y: number } {
  const { camera } = state;
  const toX = camera.panelX * PANEL_PX_W;
  const toY = camera.panelY * PANEL_PX_H;
  const fromX = camera.fromX * PANEL_PX_W;
  const fromY = camera.fromY * PANEL_PX_H;
  // The scroll eases from 1 to 0 over a transition, and is *set* to 1 on the
  // frame the panel flips — at the same moment `fromX`/`fromY` change. There
  // is nothing meaningful to interpolate across that jump, so only the
  // easing-out direction is smoothed.
  const t =
    camera.scroll < camera.prevScroll
      ? lerp(camera.prevScroll, camera.scroll, renderAlpha)
      : camera.scroll;
  camScratch.x = toX + (fromX - toX) * t;
  camScratch.y = toY + (fromY - toY) * t;
  return camScratch;
}

function blitTile(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  tile: number,
  dx: number,
  dy: number,
): void {
  ctx.drawImage(
    sheet,
    tileSheetX(tile),
    tileSheetY(tile),
    TILE_PX,
    TILE_PX,
    dx,
    dy,
    TILE_PX,
    TILE_PX,
  );
}

/**
 * Screen position and depth of every flooded tile in view, as (sx, sy, depth)
 * triples. One screenful plus the partial row and column a mid-scroll camera
 * exposes, so it never grows and never reallocates.
 */
const floodScratch = new Int32Array((PANEL_W + 3) * (PANEL_H + 3) * 3);
const shadowScratch = new Int32Array((PANEL_W + 3) * (PANEL_H + 3) * 2);

function drawWorld(ctx: CanvasRenderingContext2D, state: GameState): void {
  const map = activeMap(state);
  const cam = cameraOrigin(state);
  const sheet = getTilesheet();
  const level = waterLevel(state);

  const x0 = Math.floor(cam.x / TILE_PX);
  const y0 = Math.floor(cam.y / TILE_PX);
  const x1 = Math.ceil((cam.x + SCREEN_W) / TILE_PX);
  const y1 = Math.ceil((cam.y + PANEL_PX_H) / TILE_PX);
  let floodLen = 0;
  let shadowLen = 0;

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const sx = Math.round(tx * TILE_PX - cam.x);
      const sy = Math.round(ty * TILE_PX - cam.y);

      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) {
        // Beyond the map edge: the deep above ground, bedrock below it.
        ctx.fillStyle = map.floods ? PALETTE.waterDeep : PALETTE.dungeonWall;
        ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
        continue;
      }

      const i = ty * map.w + tx;
      const tile = map.tiles[i];
      if (tile === Tile.HeartContainer || tile === Tile.Pedestal) {
        blitTile(ctx, sheet, carveTo(map.biome[i] as Biome), sx, sy);
      }
      blitTile(ctx, sheet, tile, sx, sy);

      if (ty + 1 < map.h && shadowLen + 2 <= shadowScratch.length) {
        const south = i + map.w;
        if (map.biome[i] > map.biome[south] || map.elev[i] - map.elev[south] >= 40) {
          shadowScratch[shadowLen] = sx;
          shadowScratch[shadowLen + 1] = sy;
          shadowLen += 2;
        }
      }

      if (map.floods && floodLen + 3 <= floodScratch.length) {
        const d = floodDepth(map.elev[i], level);
        if (d > 0) {
          floodScratch[floodLen] = sx;
          floodScratch[floodLen + 1] = sy;
          floodScratch[floodLen + 2] = d;
          floodLen += 3;
        }
      }
    }
  }

  ctx.fillStyle = 'rgba(12, 10, 8, 0.42)';
  for (let i = 0; i < shadowLen; i += 2) {
    ctx.fillRect(shadowScratch[i], shadowScratch[i + 1] + TILE_PX - 3, TILE_PX, 3);
  }

  // Four fillStyles instead of one per tile — the overlay colours are discrete.
  for (let depth = 1; depth <= 4; depth++) {
    const fill = floodOverlayFill(depth);
    if (!fill) continue;
    ctx.fillStyle = fill;
    for (let i = 0; i < floodLen; i += 3) {
      if (floodScratch[i + 2] === depth || (depth === 4 && floodScratch[i + 2] >= 4)) {
        ctx.fillRect(floodScratch[i], floodScratch[i + 1], TILE_PX, TILE_PX);
      }
    }
  }
}

/**
 * The ark is a monument, not a sprite: keel, ribs, hull, deck, roof, then
 * pitch, grown from whatever has been delivered. Size is a pure function of
 * progress so you can read the meter from the next panel over.
 */
function drawArkMonument(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.location.kind !== 'overworld') return;
  const cam = cameraOrigin(state);
  const cx = Math.round(state.world.ark.x * TILE_PX + TILE_PX / 2 - cam.x);
  const cy = Math.round(state.world.ark.y * TILE_PX + TILE_PX - cam.y);
  const progress = arkProgress(state);
  const hullW = 40 + Math.round(progress * 152);
  const hullH = 18 + Math.round(progress * 92);
  if (cx + hullW < -8 || cx - hullW > SCREEN_W + 8) return;
  if (cy + 16 < -8 || cy - hullH > PANEL_PX_H + 8) return;

  const x = cx - (hullW >> 1);
  const y = cy - hullH + 6;
  const wood = progress < 0.15 ? '#7a4a1e' : PALETTE.ark;
  const shade = '#6a3a14';
  const pitch = state.delivered[Resource.Pitch] > 0;

  // Keel.
  ctx.fillStyle = shade;
  ctx.fillRect(x + 4, y + hullH - 6, hullW - 8, 4);
  ctx.fillStyle = wood;
  ctx.fillRect(x + 6, y + hullH - 7, hullW - 12, 3);

  if (progress < 0.12) return;

  // Ribs.
  ctx.fillStyle = shade;
  const ribs = 3 + Math.round(progress * 5);
  for (let i = 1; i < ribs; i++) {
    const rx = x + Math.round((i * hullW) / ribs);
    ctx.fillRect(rx, y + 8, 2, hullH - 14);
  }

  if (progress < 0.32) return;

  // Hull sides.
  ctx.fillStyle = pitch ? PALETTE.pitch : wood;
  ctx.fillRect(x + 2, y + Math.round(hullH * 0.35), 4, Math.round(hullH * 0.55));
  ctx.fillRect(x + hullW - 6, y + Math.round(hullH * 0.35), 4, Math.round(hullH * 0.55));
  ctx.fillStyle = pitch ? '#1a1612' : shade;
  ctx.fillRect(x + 1, y + Math.round(hullH * 0.7), hullW - 2, 5);

  if (progress < 0.52) return;

  // Deck.
  ctx.fillStyle = pitch ? '#2a241c' : '#c48a48';
  ctx.fillRect(x + 8, y + Math.round(hullH * 0.28), hullW - 16, 5);
  ctx.fillStyle = shade;
  ctx.fillRect(x + 8, y + Math.round(hullH * 0.28) + 5, hullW - 16, 1);

  if (progress < 0.72) return;

  // Roof / cabin.
  const cabinW = Math.round(hullW * 0.42);
  const cabinX = cx - (cabinW >> 1);
  const cabinY = y + 4;
  ctx.fillStyle = pitch ? PALETTE.pitch : '#8a4a20';
  ctx.fillRect(cabinX, cabinY + 8, cabinW, Math.round(hullH * 0.22));
  ctx.fillStyle = pitch ? '#1a1612' : '#6a3a14';
  ctx.fillRect(cabinX - 2, cabinY + 4, cabinW + 4, 5);
  ctx.fillRect(cabinX + 2, cabinY, cabinW - 4, 5);

  if (progress < 0.92) return;

  // Stem and stern posts, the last of the timber.
  ctx.fillStyle = pitch ? PALETTE.pitch : '#7a4a1e';
  ctx.fillRect(x + 4, y + 2, 3, hullH - 8);
  ctx.fillRect(x + hullW - 7, y + 2, 3, hullH - 8);
}

function drawAnimals(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.location.kind !== 'overworld') return;
  const cam = cameraOrigin(state);
  for (const a of state.world.animals) {
    if (a.status !== AnimalStatus.Wild) continue;
    const x = Math.round(lerp(a.prevX, a.x, renderAlpha) - cam.x);
    const y = Math.round(lerp(a.prevY, a.y, renderAlpha) - cam.y);
    if (x < -16 || y < -16 || x > SCREEN_W + 16 || y > PANEL_PX_H + 16) continue;
    const bob = Math.round(Math.sin(a.anim * 8 + a.id) * 0.8);
    drawCreature(ctx, a.kind, x, y + bob, a.dir, a.anim);
  }
}

function drawCreature(
  ctx: CanvasRenderingContext2D,
  kind: number,
  x: number,
  y: number,
  dir: AnimalDir,
  anim: number,
): void {
  const def = ANIMAL_DEFS[kind];
  const step = Math.floor(anim * 6) % 2;
  ctx.fillStyle = def.fill;
  ctx.fillRect(x + 1, y + 2, ANIMAL_W - 2, ANIMAL_H - 3);
  ctx.fillStyle = def.shade;
  ctx.fillRect(x + 1, y + ANIMAL_H - 2, ANIMAL_W - 2, 1);

  // Facing pip + a per-kind silhouette mark, all 16-bit-flat.
  ctx.fillStyle = def.accent;
  switch (kind) {
    case 0: // sheep — black face
      ctx.fillRect(faceX(x, dir), y + 3, 3, 3);
      break;
    case 1: // goat — horns
      ctx.fillRect(x + 2, y, 2, 2);
      ctx.fillRect(x + ANIMAL_W - 4, y, 2, 2);
      ctx.fillRect(faceX(x, dir), y + 3, 2, 2);
      break;
    case 2: // lion — mane
      ctx.fillRect(x, y + 1, ANIMAL_W, 3);
      ctx.fillRect(faceX(x, dir), y + 4, 2, 2);
      break;
    case 3: // bear — bulk
      ctx.fillRect(x, y + 2, ANIMAL_W, ANIMAL_H - 3);
      ctx.fillStyle = def.fill;
      ctx.fillRect(x + 2, y + 3, 3, 2);
      break;
    case 4: // serpent — long
      ctx.fillStyle = def.fill;
      ctx.fillRect(x, y + 4, ANIMAL_W, 2);
      ctx.fillRect(x + (step ? 1 : 2), y + 5, 6, 2);
      ctx.fillStyle = def.accent;
      ctx.fillRect(faceX(x, dir), y + 3, 2, 2);
      break;
    case 5: // dove — wing
      ctx.fillRect(x + 1, y + 1 + step, ANIMAL_W - 2, 3);
      ctx.fillStyle = def.accent;
      ctx.fillRect(faceX(x, dir), y + 4, 2, 1);
      break;
    case 6: // donkey — ears
      ctx.fillRect(x + 2, y, 2, 3);
      ctx.fillRect(x + 5, y, 2, 3);
      break;
    case 7: // camel — hump
      ctx.fillRect(x + 3, y, 4, 3);
      ctx.fillRect(faceX(x, dir), y + 4, 2, 2);
      break;
    case 8: // ox — horns
      ctx.fillRect(x + 1, y + 1, 3, 1);
      ctx.fillRect(x + ANIMAL_W - 4, y + 1, 3, 1);
      ctx.fillRect(faceX(x, dir), y + 3, 2, 2);
      break;
    default: // raven
      ctx.fillRect(x + 1, y + step, ANIMAL_W - 2, 3);
      ctx.fillStyle = '#c8c0a8';
      ctx.fillRect(faceX(x, dir), y + 4, 3, 1);
      break;
  }
}

function faceX(x: number, dir: AnimalDir): number {
  return dir === AnimalDir.Left ? x : x + ANIMAL_W - 3;
}

function drawPlayer(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player;
  const cam = cameraOrigin(state);
  const x = Math.round(lerp(p.prevX, p.x, renderAlpha) - cam.x);
  const y = Math.round(lerp(p.prevY, p.y, renderAlpha) - cam.y);

  // Blink through invulnerability frames.
  if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return;

  drawPlayerShadow(ctx, state, x, y);

  if (state.inBoat) {
    ctx.fillStyle = '#6a3e18';
    ctx.fillRect(x - 3, y + 6, PLAYER_W + 6, 7);
    ctx.fillStyle = '#c48a48';
    ctx.fillRect(x - 2, y + 6, PLAYER_W + 4, 2);
    ctx.fillStyle = '#3a220c';
    ctx.fillRect(x - 3, y + 12, PLAYER_W + 6, 1);
  }

  // Body
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(x + 1, y + 3, PLAYER_W - 2, PLAYER_H - 4);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x + 1, y, PLAYER_W - 2, 4); // hair/head
  ctx.fillStyle = '#3f6fa8';
  ctx.fillRect(x + 1, y + 7, PLAYER_W - 2, 4); // robe

  // Facing pip, so direction is legible at this size.
  ctx.fillStyle = '#1a1a20';
  const px = x + PLAYER_W / 2 - 1;
  const py = y + 4;
  switch (p.dir) {
    case Dir.Up:
      ctx.fillRect(px, y + 1, 2, 2);
      break;
    case Dir.Down:
      ctx.fillRect(px, py + 1, 2, 2);
      break;
    case Dir.Left:
      ctx.fillRect(x + 1, py, 2, 2);
      break;
    case Dir.Right:
      ctx.fillRect(x + PLAYER_W - 3, py, 2, 2);
      break;
  }

  if (p.swing > 0) drawRod(ctx, state, x, y);
}

/**
 * Ground blob thrown by the sun. Long west at dawn, gone at noon, long
 * east at dusk. Night keeps the throw and only fades the opacity.
 */
function drawPlayerShadow(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
): void {
  if (state.location.kind !== 'overworld') return;
  const { shadowDx: dx, shadowAlpha } = todAt(currentDay(state));
  if (shadowAlpha < 0.02 || Math.abs(dx) < 0.5) return;

  const throwX = Math.round(dx);
  const footY = y + PLAYER_H - 2;
  ctx.fillStyle = `rgba(16, 12, 24, ${0.4 * shadowAlpha})`;
  ctx.fillRect(
    x + (throwX < 0 ? throwX : 1),
    footY,
    PLAYER_W - 2 + Math.abs(throwX),
    3,
  );
}

/** Multiply the playfield. Day is white and is skipped. Dungeons have no sky. */
function drawTodFilter(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.location.kind !== 'overworld') return;
  const tod = todAt(currentDay(state));
  if (isDaylight(tod)) return;

  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${tod.mulR | 0},${tod.mulG | 0},${tod.mulB | 0})`;
  ctx.fillRect(0, 0, SCREEN_W, PANEL_PX_H);
  ctx.globalCompositeOperation = 'source-over';
}

/** The Rod of Aaron: a budded staff, or a two-tile serpent once blessed. */
function drawRod(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const p = state.player;
  const cx = x + PLAYER_W / 2;
  const cy = y + PLAYER_H / 2;
  if ((state.rodReach ?? 1) >= 2) {
    drawSerpentRod(ctx, p.dir, cx, cy);
    return;
  }
  const len = 12;
  const tier = Math.min(4, Math.max(0, state.rodTier ?? 0));
  ctx.fillStyle = ROD_SHAFT[tier];
  switch (p.dir) {
    case Dir.Up:
      ctx.fillRect(cx - 1, cy - len, 2, len);
      ctx.fillStyle = ROD_BUD[tier];
      ctx.fillRect(cx - 2, cy - len - 2, 4, 3);
      break;
    case Dir.Down:
      ctx.fillRect(cx - 1, cy, 2, len);
      ctx.fillStyle = ROD_BUD[tier];
      ctx.fillRect(cx - 2, cy + len - 1, 4, 3);
      break;
    case Dir.Left:
      ctx.fillRect(cx - len, cy - 1, len, 2);
      ctx.fillStyle = ROD_BUD[tier];
      ctx.fillRect(cx - len - 2, cy - 2, 3, 4);
      break;
    case Dir.Right:
      ctx.fillRect(cx, cy - 1, len, 2);
      ctx.fillStyle = ROD_BUD[tier];
      ctx.fillRect(cx + len - 1, cy - 2, 3, 4);
      break;
  }
}

/** Wavy snake whose head sits in the second harvest tile. */
function drawSerpentRod(
  ctx: CanvasRenderingContext2D,
  dir: Dir,
  cx: number,
  cy: number,
): void {
  const ax = dir === Dir.Left ? -1 : dir === Dir.Right ? 1 : 0;
  const ay = dir === Dir.Up ? -1 : dir === Dir.Down ? 1 : 0;
  const px = ay !== 0 ? 1 : 0;
  const py = ax !== 0 ? 1 : 0;
  // The head sits on the near edge of the second tile, not its centre. The
  // Rod's reach is what harvests there; the sprite only has to reach far
  // enough to say so, and a full two tiles read as absurdly long.
  const len = TILE_PX + TILE_PX / 2;

  for (let i = 0; i < len; i += 4) {
    const wave = (i >> 2) & 1 ? 1 : -1;
    const sx = Math.round(cx + ax * i + px * wave) - 1;
    const sy = Math.round(cy + ay * i + py * wave) - 1;
    ctx.fillStyle = SERPENT_BODY;
    if (ax !== 0) {
      ctx.fillRect(sx, sy, 5, 3);
      ctx.fillStyle = SERPENT_BELLY;
      ctx.fillRect(sx, sy + 1, 5, 1);
    } else {
      ctx.fillRect(sx, sy, 3, 5);
      ctx.fillStyle = SERPENT_BELLY;
      ctx.fillRect(sx + 1, sy, 1, 5);
    }
  }

  const hx = Math.round(cx + ax * len);
  const hy = Math.round(cy + ay * len);
  ctx.fillStyle = SERPENT_BODY;
  ctx.fillRect(hx - 2, hy - 2, 5, 5);
  ctx.fillStyle = SERPENT_BELLY;
  ctx.fillRect(hx - 1, hy - 1, 3, 3);
  ctx.fillStyle = '#1a1a20';
  if (ax !== 0) {
    ctx.fillRect(hx, hy - 2, 1, 1);
    ctx.fillRect(hx, hy + 1, 1, 1);
  } else {
    ctx.fillRect(hx - 2, hy, 1, 1);
    ctx.fillRect(hx + 1, hy, 1, 1);
  }
  ctx.fillStyle = SERPENT_TONGUE;
  const tx = hx + ax * 3;
  const ty = hy + ay * 3;
  if (ax !== 0) {
    ctx.fillRect(hx + ax * 2, hy, 2, 1);
    ctx.fillRect(tx, ty - 1, 1, 1);
    ctx.fillRect(tx, ty + 1, 1, 1);
  } else {
    ctx.fillRect(hx, hy + ay * 2, 1, 2);
    ctx.fillRect(tx - 1, ty, 1, 1);
    ctx.fillRect(tx + 1, ty, 1, 1);
  }
}

// ---------------------------------------------------------------- HUD

function drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, SCREEN_W, HUD_H);

  drawMiniMap(ctx, state);

  ctx.fillStyle = '#2a3140';
  ctx.fillRect(MINIMAP_W, 0, 1, HUD_H);
  ctx.fillRect(MINIMAP_W, HUD_H - 1, SCREEN_W - MINIMAP_W, 1);

  const midX = MINIMAP_W + 4;
  const cargoX = 160;
  const midW = cargoX - midX - 6;

  drawHearts(ctx, state, midX, 3);
  let badgeX = midX + state.player.maxHearts * 10 + 2;
  badgeX = drawBoatBadge(ctx, state, badgeX, 4);
  drawKeys(ctx, state, badgeX, 4);
  drawDay(ctx, state, midX, 15, midW);
  drawArkMeter(ctx, state, midX, 36, midW);
  drawCargo(ctx, state, cargoX, 2);
}

/**
 * Explored panels only, recentred in the well. Zelda 1's language (tiny
 * rectangles, current room lit) without Zelda 1's full-grid spoiler.
 *
 * Flood is the same scalar the world uses: each cell tints, and when there
 * is room for it the water rises from the bottom of the square.
 */
/**
 * Everything the cached raster was built from.
 *
 * The HUD map used to be rebuilt from scratch every frame — a per-panel scan
 * of all 176 tiles to find a town door, twice, plus a hex-string parse per
 * pixel. It is a 40x48 widget whose contents change a few times a minute, so
 * it is now rebuilt only when one of these inputs actually moves.
 */
interface MiniCache {
  bits: ImageData | null;
  layout: MiniMapLayout | null;
  map: TileMap | null;
  visited: number;
  panelX: number;
  panelY: number;
  filledSouth: boolean;
  viewY: number;
  waterBucket: number;
  mapRevision: number;
}

const mini: MiniCache = {
  bits: null,
  layout: null,
  map: null,
  visited: -1,
  panelX: -1,
  panelY: -1,
  filledSouth: false,
  viewY: -1,
  waterBucket: Number.NaN,
  mapRevision: -1,
};

/** Drop the cached raster. Called when the rules module is hot-swapped. */
export function invalidateMiniMap(): void {
  mini.bits = null;
  mini.layout = null;
  mini.map = null;
  mini.visited = -1;
}

function drawMiniMap(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = '#080a0e';
  ctx.fillRect(MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H);

  const map = activeMap(state);
  const width = panelsWide(map);
  const grid =
    state.location.kind === 'dungeon'
      ? state.exploredDungeons[state.location.dungeonId]
      : state.exploredOverworld;
  if (!grid) return;

  const worldRows = panelsHigh(map);
  if (state.location.kind === 'overworld' && state.camera.panelY >= worldRows - 1) {
    state.minimapFilledSouth = true;
  }

  // Layout depends only on which panels are known and where the player is.
  const visited = countVisited(grid);
  if (
    mini.layout === null ||
    mini.map !== map ||
    mini.visited !== visited ||
    mini.panelX !== state.camera.panelX ||
    mini.panelY !== state.camera.panelY ||
    mini.filledSouth !== state.minimapFilledSouth
  ) {
    mini.layout = layoutMiniMap(
      visitedCells(grid, width),
      MINIMAP_X,
      MINIMAP_Y,
      MINIMAP_W,
      MINIMAP_H,
      width,
      worldRows,
      state.camera.panelY,
      state.minimapFilledSouth,
    );
    mini.map = map;
    mini.visited = visited;
    mini.panelX = state.camera.panelX;
    mini.panelY = state.camera.panelY;
    mini.filledSouth = state.minimapFilledSouth;
    mini.waterBucket = Number.NaN;
  }

  const layout = mini.layout;
  if (!layout) return;

  state.minimapViewY = followMinimapView(
    state.minimapViewY,
    state.camera.panelY,
    layout.viewRows,
    layout.minY,
    layout.rows,
    layout.scrolls,
  );

  const level = waterLevel(state);
  // The map tints in whole flood-depth steps and the water climbs about 0.04
  // elevation units a second, so a one-unit bucket rebuilds the raster roughly
  // twice a minute rather than sixty times a second, with no visible lag.
  const waterBucket = Math.floor(level);

  if (
    mini.bits === null ||
    mini.viewY !== state.minimapViewY ||
    mini.waterBucket !== waterBucket ||
    mini.mapRevision !== state.mapRevision
  ) {
    mini.bits = rasterizeMiniMap(ctx, state, map, grid, width, layout, state.minimapViewY, level);
    mini.viewY = state.minimapViewY;
    mini.waterBucket = waterBucket;
    mini.mapRevision = state.mapRevision;
  }

  ctx.putImageData(mini.bits, MINIMAP_X, MINIMAP_Y);

  // The only thing that changes several times a second is the blink on the
  // panel you are standing in, so that alone stays a live draw.
  drawHereFlash(ctx, state, layout);
}

/** Blink the current panel over the cached raster. */
function drawHereFlash(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: MiniMapLayout,
): void {
  if (Math.floor(state.elapsed * 6) % 2 !== 0) return;

  const cy = state.camera.panelY;
  if (layout.scrolls) {
    const ly = cy - state.minimapViewY;
    if (ly < 0 || ly >= layout.viewRows) return;
  }

  const r = cellRect(layout, state.camera.panelX, cy, state.minimapViewY);
  if (
    r.x < layout.wellX ||
    r.y < layout.wellY ||
    r.x + r.w > layout.wellX + layout.wellW ||
    r.y + r.h > layout.wellY + layout.wellH
  ) {
    return;
  }

  if (Math.min(r.w, r.h) >= 3) {
    ctx.strokeStyle = '#fff6c8';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  } else {
    ctx.fillStyle = 'rgba(240, 224, 160, 0.45)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

function landmarkOnPanel(state: GameState, panelX: number, panelY: number): MiniPoi {
  const dungeon = currentDungeon(state);
  if (dungeon) {
    const inPanel = (p: { x: number; y: number }): boolean =>
      ((p.x / PANEL_W) | 0) === panelX && ((p.y / PANEL_H) | 0) === panelY;
    if (inPanel(dungeon.stairs) || inPanel(dungeon.chest) || inPanel(dungeon.key)) {
      return MiniPoi.Dungeon;
    }
    return MiniPoi.None;
  }

  // Towns and shrines are placed by worldgen and never move, so this is a
  // table lookup rather than the 176-tile panel scan it used to be.
  return panelPoiIndex(state.world)[panelY * panelsWide(state.world) + panelX] as MiniPoi;
}

/** `MINI_POI_COLOR` as bytes, so the rasteriser never parses a hex string. */
const MINI_POI_RGB: [number, number, number][] = (
  Object.keys(MINI_POI_COLOR) as unknown as MiniPoi[]
).reduce<[number, number, number][]>((table, key) => {
  const v = parseInt(MINI_POI_COLOR[key].slice(1), 16);
  table[key] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return table;
}, []);

/**
 * Paint the whole well into one ImageData, for a single putImageData.
 *
 * Only called when `drawMiniMap` decides an input changed — a newly explored
 * panel, the waterline crossing a tint step, a harvested node, a new map.
 */
function rasterizeMiniMap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  map: TileMap,
  grid: Uint8Array,
  width: number,
  layout: MiniMapLayout,
  viewY: number,
  level: number,
): ImageData {
  const bits =
    mini.bits && mini.bits.width === MINIMAP_W && mini.bits.height === MINIMAP_H
      ? mini.bits
      : ctx.createImageData(MINIMAP_W, MINIMAP_H);

  const data = bits.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 8;
    data[i + 1] = 10;
    data[i + 2] = 14;
    data[i + 3] = 255;
  }

  for (let gi = 0; gi < grid.length; gi++) {
    if (!grid[gi]) continue;
    const cellX = gi % width;
    const cellY = (gi / width) | 0;

    if (layout.scrolls) {
      const ly = cellY - viewY;
      if (ly < 0 || ly >= layout.viewRows) continue;
    }

    const r = cellRect(layout, cellX, cellY, viewY);
    const rw = Math.max(1, r.w | 0);
    const rh = Math.max(1, r.h | 0);
    const x0 = r.x | 0;
    const y0 = r.y | 0;
    const poi = landmarkOnPanel(state, cellX, cellY);
    const pin = poi !== MiniPoi.None && rw <= 2 ? MINI_POI_RGB[poi] : null;

    for (let py = 0; py < rh; py++) {
      const y = y0 + py;
      if (y < 0 || y >= MINIMAP_H) continue;
      for (let px = 0; px < rw; px++) {
        const x = x0 + px;
        if (x < 0 || x >= MINIMAP_W) continue;
        const o = (y * MINIMAP_W + x) * 4;
        if (pin) {
          data[o] = pin[0];
          data[o + 1] = pin[1];
          data[o + 2] = pin[2];
          data[o + 3] = 255;
        } else {
          sampleMinimapInto(
            map,
            cellX,
            cellY,
            (px + 0.5) / rw,
            (py + 0.5) / rh,
            level,
            data,
            o,
          );
        }
      }
    }

    if (poi !== MiniPoi.None && rw >= 3 && rh >= 3) {
      paintMiniPoi(data, x0 + (rw >> 1), y0 + (rh >> 1), poi);
    }
  }

  return bits;
}

/** A backed plus-sign landmark pip, written straight into the raster. */
function paintMiniPoi(data: Uint8ClampedArray, cx: number, cy: number, poi: MiniPoi): void {
  const color = MINI_POI_RGB[poi];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      // The plus itself takes the landmark colour; the corners stay dark so
      // the pip reads against whatever terrain is underneath it.
      const arm = dx === 0 || dy === 0;
      putMiniPixel(data, cx + dx, cy + dy, arm ? color : DARK_PIP);
    }
  }
}

const DARK_PIP: [number, number, number] = [0x0a, 0x0c, 0x10];

function putMiniPixel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  rgb: readonly [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= MINIMAP_W || y >= MINIMAP_H) return;
  const o = (y * MINIMAP_W + x) * 4;
  data[o] = rgb[0];
  data[o + 1] = rgb[1];
  data[o + 2] = rgb[2];
  data[o + 3] = 255;
}

/** Keys sit next to the hearts, the way Zelda 1 parked them on the status bar. */
function drawKeys(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  if (!currentDungeon(state) || state.keysHeld <= 0) return;

  ctx.fillStyle = PALETTE.key;
  ctx.fillRect(x, y + 1, 5, 5);
  ctx.fillStyle = PALETTE.dungeonFloor;
  ctx.fillRect(x + 1, y + 2, 2, 2);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.key;
  ctx.fillText(`x${state.keysHeld}`, x + 7, y);
}

function drawBoatBadge(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
): number {
  if (!state.hasBoat || currentDungeon(state)) return x;
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = state.inBoat ? PALETTE.waterShallow : PALETTE.dock;
  ctx.fillText(state.inBoat ? 'SKIFF' : 'BOAT', x, y);
  return x + 28;
}

function drawCargo(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (!currentDungeon(state)) {
    const score = flockScore(state);
    ctx.fillStyle = '#8d98ab';
    ctx.fillText('FLOCK', x, y);
    ctx.fillStyle = '#e6e9ef';
    ctx.fillText(
      `${String(score.rescued).padStart(2, '0')}/${String(FLOCK_TOTAL).padStart(2, '0')}`,
      x + 28,
      y,
    );
    ctx.fillStyle = PALETTE.ark;
    ctx.fillText(`${score.pairs}p`, x + 56, y);
  }

  drawRodHud(ctx, state, SCREEN_W - 14, y);
  drawInventory(ctx, state, x, y + 12);
}

/** Staff plus four resource pips, filled as the Rod is imbued. */
function drawRodHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const tier = Math.min(4, Math.max(0, state.rodTier ?? 0));
  if ((state.rodReach ?? 1) >= 2) {
    ctx.fillStyle = SERPENT_BODY;
    ctx.fillRect(x + 1, y + 4, 2, 3);
    ctx.fillRect(x + 3, y + 7, 2, 3);
    ctx.fillRect(x + 1, y + 10, 2, 5);
    ctx.fillRect(x, y, 5, 5);
    ctx.fillStyle = SERPENT_BELLY;
    ctx.fillRect(x + 1, y + 1, 3, 3);
    ctx.fillStyle = SERPENT_TONGUE;
    ctx.fillRect(x + 1, y - 1, 1, 1);
    ctx.fillRect(x + 3, y - 1, 1, 1);
  } else {
    ctx.fillStyle = ROD_SHAFT[tier];
    ctx.fillRect(x + 2, y + 3, 2, 12);
    ctx.fillStyle = ROD_BUD[tier];
    ctx.fillRect(x + 1, y, 4, 4);
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i <= Math.min(tier, 3) ? RESOURCE_COLOR[i] : '#2a3140';
    ctx.fillRect(x + 6, y + 1 + i * 4, 3, 3);
  }
}

function drawHearts(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const p = state.player;
  for (let i = 0; i < p.maxHearts; i++) {
    const hx = x + i * 10;
    const full = i < p.hearts;
    ctx.fillStyle = full ? PALETTE.heart : '#3a2226';
    // A chunky 7x6 pixel heart.
    ctx.fillRect(hx, y + 1, 3, 3);
    ctx.fillRect(hx + 4, y + 1, 3, 3);
    ctx.fillRect(hx, y + 2, 7, 3);
    ctx.fillRect(hx + 1, y + 5, 5, 1);
    ctx.fillRect(hx + 2, y + 6, 3, 1);
  }
}

function drawDay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  barW: number,
): void {
  const day = currentDay(state);
  // Humans count the first day as 1. The flood clock is still 0..40.
  const shown = Math.min(40, Math.floor(day) + 1);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.fillStyle = '#8d98ab';
  ctx.fillText('DAY', x, y);
  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(`${shown}`.padStart(2, '0'), x + 20, y);
  ctx.fillStyle = '#5c6879';
  ctx.fillText('/40', x + 32, y);

  ctx.fillStyle = '#1c2330';
  ctx.fillRect(x, y + 10, barW, 3);
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(x, y + 10, Math.round((day / 40) * barW), 3);
}

function drawInventory(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
): void {
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const colW = 44;
  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const cx = x + (r % 2) * colW;
    const cy = y + Math.floor(r / 2) * 12;
    ctx.fillStyle = RESOURCE_COLOR[r];
    ctx.fillRect(cx, cy + 2, 3, 3);
    ctx.fillText(RESOURCE_INITIAL[r], cx + 5, cy);
    ctx.fillStyle = '#c8d0dd';
    ctx.fillText(String(state.carried[r]), cx + 14, cy);
  }
}

function drawArkMeter(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  totalW: number,
): void {
  const progress = arkProgress(state);
  const barW = Math.max(8, totalW - 44);

  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#8d98ab';
  ctx.fillText('ARK', x, y);

  ctx.fillStyle = '#1c2330';
  ctx.fillRect(x + 20, y + 1, barW, 6);
  ctx.fillStyle = PALETTE.ark;
  ctx.fillRect(x + 20, y + 1, Math.round(barW * progress), 6);
  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(`${Math.round(progress * 100)}%`, x + 24 + barW, y);
}

function drawMessage(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.message) return;

  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = state.message;
  const w = Math.min(SCREEN_W - 16, ctx.measureText(text).width + 16);
  const x = (SCREEN_W - w) / 2;
  const y = SCREEN_H - 26;

  ctx.fillStyle = PALETTE.hudBack;
  ctx.fillRect(x, y, w, 16);
  ctx.strokeStyle = '#3a4356';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 15);

  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(text, SCREEN_W / 2, y + 8);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

function drawEndCard(ctx: CanvasRenderingContext2D, state: GameState): void {
  const won = state.phase === 'won';

  ctx.fillStyle = won ? 'rgba(20, 40, 20, 0.86)' : 'rgba(10, 20, 45, 0.88)';
  ctx.fillRect(0, HUD_H, SCREEN_W, PANEL_PX_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const midY = HUD_H + PANEL_PX_H / 2;

  ctx.font = 'bold 16px ui-monospace, monospace';
  ctx.fillStyle = won ? '#8fe06a' : '#7fb0e8';
  ctx.fillText(won ? 'THE ARK FLOATS' : 'THE WATERS TOOK YOU', SCREEN_W / 2, midY - 20);

  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = '#c8d0dd';
  ctx.fillText(
    won
      ? 'Well done, my servant. I am ALMOST impressed.'
      : `You lasted ${currentDay(state).toFixed(1)} of forty days.`,
    SCREEN_W / 2,
    midY + 4,
  );

  const flock = flockScore(state);
  ctx.fillStyle = '#e6d9b0';
  ctx.fillText(
    `Flock ${flock.rescued}/20 · ${flock.pairs} pair${flock.pairs === 1 ? '' : 's'}`,
    SCREEN_W / 2,
    midY + 16,
  );

  ctx.fillStyle = '#8d98ab';
  ctx.fillText('press R to begin again', SCREEN_W / 2, midY + 30);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

function drawBestiary(ctx: CanvasRenderingContext2D, state: GameState, best: BestFlock): void {
  ctx.fillStyle = 'rgba(5, 7, 10, 0.9)';
  ctx.fillRect(8, HUD_H + 10, SCREEN_W - 16, PANEL_PX_H - 20);
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 1;
  ctx.strokeRect(8.5, HUD_H + 10.5, SCREEN_W - 17, PANEL_PX_H - 21);

  const score = flockScore(state);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#efe6d2';
  ctx.fillText('THE FLOCK', 16, HUD_H + 16);
  ctx.fillStyle = '#8d98ab';
  ctx.textAlign = 'right';
  ctx.fillText(`${score.rescued}/${FLOCK_TOTAL} · ${score.pairs} pairs`, SCREEN_W - 16, HUD_H + 16);
  ctx.textAlign = 'left';

  const colW = 112;
  const rowH = 11;
  const originY = HUD_H + 32;
  for (let i = 0; i < ANIMAL_DEFS.length; i++) {
    const def = ANIMAL_DEFS[i];
    const col = i < 5 ? 0 : 1;
    const row = i % 5;
    const x = 16 + col * colW;
    const y = originY + row * rowH;
    const have = score.boarded[def.kind] ?? 0;
    ctx.fillStyle = def.fill;
    ctx.fillRect(x, y + 1, 6, 6);
    ctx.fillStyle = have ? '#e6e9ef' : '#5c6879';
    ctx.fillText(def.name, x + 10, y);
    ctx.fillStyle = have >= 2 ? PALETTE.ark : '#8d98ab';
    ctx.fillText(`${have}/2`, x + 78, y);
  }

  ctx.fillStyle = '#5c6879';
  ctx.fillText(
    `Best ${best.rescued}/20 · ${best.pairs} pairs · B to return`,
    16,
    HUD_H + PANEL_PX_H - 24,
  );
}

/**
 * The frame-time overlay (F3).
 *
 * A locked frame rate is a claim, and a claim you cannot see is one that
 * quietly stops being true. `MISS` is the number that matters: frames that ran
 * past the display's own interval by enough to have missed a vsync. It should
 * read 0, always, and if it doesn't the p99 says how badly.
 */
function drawPerf(ctx: CanvasRenderingContext2D, perf: PerfSnapshot): void {
  const w = 112;
  const h = 46;
  const x = SCREEN_W - w - 3;
  const y = HUD_H + 3;

  ctx.fillStyle = 'rgba(6, 8, 12, 0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const budget = perf.interval * MISS_RATIO;
  const col2 = x + 58;

  const label = (text: string, cx: number, cy: number): void => {
    ctx.fillStyle = '#8d98ab';
    ctx.fillText(text, cx, cy);
  };
  const value = (text: string, cx: number, cy: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  };

  label('FPS', x + 4, y + 4);
  value(perf.fps.toFixed(1), x + 26, y + 4, perf.p99 <= budget ? '#8fe06a' : '#e0908a');
  value(`@${(1000 / perf.interval).toFixed(0)}Hz`, col2 + 14, y + 4, '#5c6879');

  label('p50', x + 4, y + 14);
  value(perf.p50.toFixed(1), x + 26, y + 14, '#c8d0dd');
  label('p99', col2, y + 14);
  value(perf.p99.toFixed(1), col2 + 22, y + 14, perf.p99 <= budget ? '#c8d0dd' : '#e0908a');

  label('max', x + 4, y + 24);
  value(perf.worst.toFixed(1), x + 26, y + 24, perf.worst <= budget ? '#c8d0dd' : '#e0908a');
  label('stp', col2, y + 24);
  value(String(perf.steps), col2 + 22, y + 24, '#c8d0dd');

  // The number that matters: frames that ran long enough to have missed a
  // vsync. It should read 0, and it is why the overlay exists at all.
  label('MISS', x + 4, y + 34);
  value(String(perf.missesTotal), x + 30, y + 34, perf.missesTotal === 0 ? '#8fe06a' : '#e0908a');

  // p99 against the budget, so "how close are we" is legible at a glance.
  const barX = col2;
  const barY = y + 34;
  const barW = w - (barX - x) - 4;
  ctx.fillStyle = '#1c2330';
  ctx.fillRect(barX, barY, barW, 7);
  ctx.fillStyle = perf.p99 <= budget ? '#3d8a2a' : '#b5533a';
  ctx.fillRect(barX, barY, Math.round(Math.min(1, perf.p99 / budget) * barW), 7);
}
