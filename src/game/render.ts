/**
 * Game rendering.
 *
 * Fixed 256x224 back buffer — a 256x176 Zelda 1 screen with a 48px status bar
 * above it — scaled up by whole numbers with smoothing off. Everything is
 * drawn from the shared tilesheet, so the game and the dev tool's panel
 * inspector cannot drift apart.
 */

import { PANEL_PX_H, PANEL_PX_W, TILE_PX } from '../core/config.js';
import { ANIMAL_DEFS, ANIMAL_H, ANIMAL_W, AnimalDir, AnimalStatus, FLOCK_TOTAL } from '../core/animals.js';
import { ARK_RECIPE } from '../core/resources.js';
import { RESOURCE_COUNT, type Resource } from '../core/tiles.js';
import { PALETTE } from '../render/palette.js';
import { getTilesheet, tileSheetX, tileSheetY } from '../render/tilesheet.js';
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
import type { BestFlock } from './persist.js';

export const HUD_H = 48;
export const SCREEN_W = PANEL_PX_W;
export const SCREEN_H = PANEL_PX_H + HUD_H;

const RESOURCE_COLOR = [PALETTE.flax, PALETTE.gopher, PALETTE.stoneNode, '#6a625c'];
const RESOURCE_INITIAL = ['F', 'W', 'S', 'P'];

export interface RenderUi {
  bestiary?: boolean;
  best?: BestFlock;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, ui?: RenderUi): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HUD_H, SCREEN_W, PANEL_PX_H);
  ctx.clip();
  ctx.translate(0, HUD_H);
  drawWorld(ctx, state);
  drawAnimals(ctx, state);
  drawPlayer(ctx, state);
  ctx.restore();

  drawHud(ctx, state);
  drawObstaclePrompt(ctx, state);
  drawMessage(ctx, state);
  if (state.phase !== 'playing') drawEndCard(ctx, state);
  if (ui?.bestiary) drawBestiary(ctx, state, ui.best ?? { pairs: 0, rescued: 0 });
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

/** Camera origin in world pixels, interpolated during a panel transition. */
export function cameraOrigin(state: GameState): { x: number; y: number } {
  const { camera } = state;
  const toX = camera.panelX * PANEL_PX_W;
  const toY = camera.panelY * PANEL_PX_H;
  const fromX = camera.fromX * PANEL_PX_W;
  const fromY = camera.fromY * PANEL_PX_H;
  const t = camera.scroll;
  return { x: toX + (fromX - toX) * t, y: toY + (fromY - toY) * t };
}

function drawWorld(ctx: CanvasRenderingContext2D, state: GameState): void {
  const map = activeMap(state);
  const cam = cameraOrigin(state);
  const sheet = getTilesheet();
  const level = waterLevel(state);

  const x0 = Math.floor(cam.x / TILE_PX);
  const y0 = Math.floor(cam.y / TILE_PX);
  const x1 = Math.ceil((cam.x + SCREEN_W) / TILE_PX);
  const y1 = Math.ceil((cam.y + PANEL_PX_H) / TILE_PX);

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
      ctx.drawImage(
        sheet as CanvasImageSource,
        tileSheetX(map.tiles[i]),
        tileSheetY(map.tiles[i]),
        TILE_PX,
        TILE_PX,
        sx,
        sy,
        TILE_PX,
        TILE_PX,
      );

      if (map.floods && map.elev[i] < level) {
        const depth = Math.min(1, (level - map.elev[i]) / 60);
        ctx.fillStyle = depth > 0.5 ? 'rgba(18, 58, 118, 0.82)' : PALETTE.floodTint;
        ctx.fillRect(sx, sy, TILE_PX, TILE_PX);
      }
    }
  }
}

function drawAnimals(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.location.kind !== 'overworld') return;
  const cam = cameraOrigin(state);
  for (const a of state.world.animals) {
    if (a.status !== AnimalStatus.Wild) continue;
    const x = Math.round(a.x - cam.x);
    const y = Math.round(a.y - cam.y);
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
  const x = Math.round(p.x - cam.x);
  const y = Math.round(p.y - cam.y);

  // Blink through invulnerability frames.
  if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return;

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

/** The Rod of Aaron: a budded staff, thrust in the facing direction. */
function drawRod(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const p = state.player;
  const cx = x + PLAYER_W / 2;
  const cy = y + PLAYER_H / 2;
  const len = 12;

  ctx.fillStyle = '#c8a06a';
  switch (p.dir) {
    case Dir.Up:
      ctx.fillRect(cx - 1, cy - len, 2, len);
      ctx.fillStyle = '#7fd06a';
      ctx.fillRect(cx - 2, cy - len - 2, 4, 3);
      break;
    case Dir.Down:
      ctx.fillRect(cx - 1, cy, 2, len);
      ctx.fillStyle = '#7fd06a';
      ctx.fillRect(cx - 2, cy + len - 1, 4, 3);
      break;
    case Dir.Left:
      ctx.fillRect(cx - len, cy - 1, len, 2);
      ctx.fillStyle = '#7fd06a';
      ctx.fillRect(cx - len - 2, cy - 2, 3, 4);
      break;
    case Dir.Right:
      ctx.fillRect(cx, cy - 1, len, 2);
      ctx.fillStyle = '#7fd06a';
      ctx.fillRect(cx + len - 1, cy - 2, 3, 4);
      break;
  }
}

// ---------------------------------------------------------------- HUD

function drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, SCREEN_W, HUD_H);
  ctx.fillStyle = '#2a3140';
  ctx.fillRect(0, HUD_H - 1, SCREEN_W, 1);

  drawHearts(ctx, state, 6, 4);
  drawDay(ctx, state, 6, 16);
  drawFlock(ctx, state, 6, 36);
  drawInventory(ctx, state, 96, 4);
  drawArkMeter(ctx, state, 96, 26);
  drawBoatBadge(ctx, state);
  drawDungeonBadge(ctx, state);
}

/**
 * Underground, the day counter still matters but the ark meter is out of
 * reach, so the badge says where you are and what you are carrying that the
 * dungeon might take.
 */
function drawDungeonBadge(ctx: CanvasRenderingContext2D, state: GameState): void {
  const dungeon = currentDungeon(state);
  if (!dungeon) return;

  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.fillStyle = PALETTE.stairs;
  ctx.fillText('UNDERGROUND', 6, 38);

  if (state.keysHeld > 0) {
    ctx.fillStyle = PALETTE.key;
    ctx.fillText(`KEY x${state.keysHeld}`, 66, 38);
  }
}

function drawBoatBadge(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.hasBoat || currentDungeon(state)) return;
  const hx = 6 + state.player.maxHearts * 10 + 4;
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = state.inBoat ? PALETTE.waterShallow : PALETTE.dock;
  ctx.fillText(state.inBoat ? 'SKIFF' : 'BOAT', hx, 5);
}

function drawFlock(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  if (currentDungeon(state)) return;
  const score = flockScore(state);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8d98ab';
  ctx.fillText('FLOCK', x, y);
  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(`${String(score.rescued).padStart(2, '0')}/20`, x + 28, y);
  ctx.fillStyle = PALETTE.ark;
  ctx.fillText(`${score.pairs}p`, x + 58, y);
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

function drawDay(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const day = currentDay(state);
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  ctx.fillStyle = '#8d98ab';
  ctx.fillText('DAY', x, y);
  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(`${Math.floor(day)}`.padStart(2, '0'), x + 20, y);
  ctx.fillStyle = '#5c6879';
  ctx.fillText('/40', x + 32, y);

  // Water-rise bar: how much of the forty days has run.
  const w = 52;
  ctx.fillStyle = '#1c2330';
  ctx.fillRect(x, y + 10, w, 3);
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(x, y + 10, Math.round((day / 40) * w), 3);
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

  for (let r = 0; r < RESOURCE_COUNT; r++) {
    const cx = x + r * 40;
    ctx.fillStyle = RESOURCE_COLOR[r];
    ctx.fillRect(cx, y + 1, 5, 5);
    ctx.fillStyle = '#8d98ab';
    ctx.fillText(RESOURCE_INITIAL[r], cx + 7, y);
    ctx.fillStyle = '#e6e9ef';
    ctx.fillText(String(state.carried[r]), cx + 14, y);

    // Delivered / required, the number that actually ends the run.
    ctx.fillStyle = '#5c6879';
    ctx.fillText(
      `${state.delivered[r]}/${ARK_RECIPE[r as Resource]}`,
      cx + 7,
      y + 9,
    );
  }
}

function drawArkMeter(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
): void {
  const w = SCREEN_W - x - 6;
  const progress = arkProgress(state);

  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#8d98ab';
  ctx.fillText('ARK', x, y);

  ctx.fillStyle = '#1c2330';
  ctx.fillRect(x + 20, y + 1, w - 20, 6);
  ctx.fillStyle = PALETTE.ark;
  ctx.fillRect(x + 20, y + 1, Math.round((w - 20) * progress), 6);
  ctx.fillStyle = '#e6e9ef';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(progress * 100)}%`, SCREEN_W - 8, y);
  ctx.textAlign = 'left';
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
