/**
 * Game boot and main loop.
 *
 * Fixed 60Hz simulation with a decoupled render, so physics and the flood
 * advance at the same rate regardless of display refresh.
 */

import { DEFAULT_PARAMS } from '../core/config.js';
import { parseSeed, randomSeed } from '../core/rng.js';
import { generateValidWorld } from '../core/worldgen/index.js';
import { Input } from './input.js';
import { SCREEN_H, SCREEN_W, render } from './render.js';
import { createGame, type GameState, say, step } from './state.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = SCREEN_W;
canvas.height = SCREEN_H;

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas context unavailable');

const url = new URL(window.location.href);

/**
 * `?speed=N` runs the clock N times faster. Forty days is an hour at normal
 * pace, which is far too slow to check flood behaviour by hand.
 */
const timeScale = Math.max(0.1, Math.min(200, Number(url.searchParams.get('speed') ?? 1)));

const input = new Input();
let state = newRun(parseSeed(url.searchParams.get('seed')));

function newRun(seed: number): GameState {
  const { world } = generateValidWorld(seed, DEFAULT_PARAMS);
  const next = createGame(world);
  say(next, 'BUILD IT, NOAH. Forty days. Do not disappoint Us.');

  const params = new URL(window.location.href);
  params.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', params);

  return next;
}

/** Integer-scale the back buffer to fill the window without blurring. */
function fitCanvas(): void {
  const scale = Math.max(
    1,
    Math.floor(Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H)),
  );
  canvas.style.width = `${SCREEN_W * scale}px`;
  canvas.style.height = `${SCREEN_H * scale}px`;
}

window.addEventListener('resize', fitCanvas);
fitCanvas();

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  const intents = input.read();

  if (intents.restartPressed) {
    state = newRun(randomSeed());
    accumulator = 0;
  }

  const scale = timeScale * (intents.fastForward ? 8 : 1);
  accumulator += elapsed * scale;

  let steps = 0;
  while (accumulator >= STEP && steps < 240) {
    step(
      state,
      { moveX: intents.moveX, moveY: intents.moveY, attackPressed: intents.attackPressed && steps === 0 },
      STEP,
    );
    accumulator -= STEP;
    steps++;
  }

  input.endFrame();
  render(ctx as CanvasRenderingContext2D, state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Expose state for debugging and for the screenshot harness.
Object.assign(window as unknown as Record<string, unknown>, {
  flood: {
    get state() {
      return state;
    },
    newRun: (seed: number) => {
      state = newRun(seed);
    },
    render: () => render(ctx as CanvasRenderingContext2D, state),
  },
});
