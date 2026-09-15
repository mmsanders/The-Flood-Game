/**
 * Game boot and main loop.
 *
 * Fixed 60Hz simulation with a decoupled render, so physics and the flood
 * advance at the same rate regardless of display refresh.
 *
 * The loop always calls through `live` bindings. Vite HMR replaces those
 * bindings without dropping the run, so a hotfix lands on the next frame
 * while you are still walking. Worldgen is the exception: it only runs when
 * a world is created, so those edits apply the next time you press R.
 */

import { DEFAULT_PARAMS, type WorldParams } from '../core/config.js';
import { parseSeed, randomSeed } from '../core/rng.js';
import { generateValidWorld } from '../core/worldgen/index.js';
import { flashHotfix, markLive } from './hot.js';
import { Input } from './input.js';
import { considerBestFlock, loadBestFlock, type BestFlock } from './persist.js';
import { SCREEN_H, SCREEN_W, render } from './render.js';
import { adoptHotState, createGame, flockScore, type GameState, say, step } from './state.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D canvas context unavailable');

const url = new URL(window.location.href);

/**
 * `?speed=N` runs the clock N times faster. Forty days is two hours at
 * normal pace, which is far too slow to check flood behaviour by hand.
 */
const timeScale = Math.max(0.1, Math.min(200, Number(url.searchParams.get('speed') ?? 1)));

/**
 * Mutable handles the RAF loop reads every frame. HMR callbacks rewrite these
 * in place; they must not be `const` imports, which would keep the old module.
 */
const live = {
  params: DEFAULT_PARAMS,
  parseSeed,
  randomSeed,
  generateValidWorld,
  Input,
  SCREEN_W,
  SCREEN_H,
  render,
  createGame,
  say,
  step,
  adoptHotState,
  flockScore,
  considerBestFlock,
};

function applyCanvasSize(): void {
  canvas.width = live.SCREEN_W;
  canvas.height = live.SCREEN_H;
}

applyCanvasSize();

let input = new live.Input();
let bestiary = Boolean(import.meta.hot?.data.bestiary);
let best: BestFlock = loadBestFlock();
let state = bootState();

function bootState(): GameState {
  const carried = import.meta.hot?.data.state as GameState | undefined;
  if (carried) return live.adoptHotState(carried);
  return newRun(live.parseSeed(url.searchParams.get('seed')));
}

function newRun(seed: number): GameState {
  const { world } = live.generateValidWorld(seed, live.params);
  const next = live.createGame(world);
  live.say(next, 'BUILD IT, NOAH. Forty days. Two of every kind.');
  bestiary = false;

  const params = new URL(window.location.href);
  params.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', params);

  return next;
}

/** Integer-scale the back buffer to fill the window without blurring. */
function fitCanvas(): void {
  const scale = Math.max(
    1,
    Math.floor(Math.min(window.innerWidth / live.SCREEN_W, window.innerHeight / live.SCREEN_H)),
  );
  canvas.style.width = `${live.SCREEN_W * scale}px`;
  canvas.style.height = `${live.SCREEN_H * scale}px`;
}

window.addEventListener('resize', fitCanvas);
fitCanvas();

let last = performance.now();
let accumulator = (import.meta.hot?.data.accumulator as number | undefined) ?? 0;
let raf = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  const intents = input.read();

  if (intents.restartPressed) {
    state = newRun(live.randomSeed());
    accumulator = 0;
  }

  if (intents.bestiaryPressed) bestiary = !bestiary;

  if (!bestiary) {
    const scale = timeScale * (intents.fastForward ? 8 : 1);
    accumulator += elapsed * scale;

    let steps = 0;
    while (accumulator >= STEP && steps < 240) {
      live.step(
        state,
        {
          moveX: intents.moveX,
          moveY: intents.moveY,
          // Edge-triggered intents fire on the first substep only, so one key
          // press cannot swing or pay several times in a single frame.
          attackPressed: intents.attackPressed && steps === 0,
          interactPressed: intents.interactPressed && steps === 0,
        },
        STEP,
      );
      accumulator -= STEP;
      steps++;
    }
  } else {
    accumulator = 0;
  }

  const nextBest = live.considerBestFlock(live.flockScore(state), best);
  if (nextBest !== best) best = nextBest;

  input.endFrame();
  try {
    live.render(ctx as CanvasRenderingContext2D, state, { bestiary, best });
  } catch (err) {
    console.error('[flood] render failed', err);
  }
  raf = requestAnimationFrame(frame);
}

raf = requestAnimationFrame(frame);

// Expose state for debugging and for the screenshot harness.
Object.assign(window as unknown as Record<string, unknown>, {
  flood: {
    get state() {
      return state;
    },
    get best() {
      return best;
    },
    newRun: (seed: number) => {
      state = newRun(seed);
    },
    render: () => live.render(ctx as CanvasRenderingContext2D, state, { bestiary, best }),
  },
});

function patchWorldParams(params: WorldParams): void {
  live.params = params;
  // Terrain is already generated; only runtime-visible knobs can take effect
  // on this run. Press R to rebuild the world from the rest.
  state.world.params = {
    ...state.world.params,
    secondsPerDay: params.secondsPerDay,
  };
}

if (import.meta.hot) {
  markLive();

  import.meta.hot.accept('./state.js', (mod) => {
    if (!mod) return;
    live.step = mod.step;
    live.createGame = mod.createGame;
    live.say = mod.say;
    live.adoptHotState = mod.adoptHotState;
    live.flockScore = mod.flockScore;
    state = live.adoptHotState(state);
    flashHotfix('rules');
  });

  import.meta.hot.accept('./render.js', (mod) => {
    if (!mod) return;
    live.render = mod.render;
    live.SCREEN_W = mod.SCREEN_W;
    live.SCREEN_H = mod.SCREEN_H;
    applyCanvasSize();
    fitCanvas();
    flashHotfix('look');
  });

  import.meta.hot.accept('./input.js', (mod) => {
    if (!mod) return;
    live.Input = mod.Input;
    input.dispose();
    input = new live.Input();
    flashHotfix('controls');
  });

  import.meta.hot.accept('./persist.js', (mod) => {
    if (!mod) return;
    live.considerBestFlock = mod.considerBestFlock;
  });

  import.meta.hot.accept('./hot.js', (mod) => {
    if (!mod) return;
    mod.markLive();
  });

  import.meta.hot.accept('../core/config.js', (mod) => {
    if (!mod) return;
    patchWorldParams(mod.DEFAULT_PARAMS);
    flashHotfix('params · press R for a new world');
  });

  import.meta.hot.accept('../core/worldgen/index.js', (mod) => {
    if (!mod) return;
    live.generateValidWorld = mod.generateValidWorld;
    flashHotfix('worldgen · press R for a new world');
  });

  import.meta.hot.accept('../core/rng.js', (mod) => {
    if (!mod) return;
    live.parseSeed = mod.parseSeed;
    live.randomSeed = mod.randomSeed;
  });

  import.meta.hot.dispose((data) => {
    data.state = state;
    data.accumulator = accumulator;
    data.bestiary = bestiary;
    cancelAnimationFrame(raf);
    input.dispose();
    window.removeEventListener('resize', fitCanvas);
  });

  // Self-accept so edits to this file re-bind the loop without a full reload.
  import.meta.hot.accept();
}
