import { expect, test } from '@playwright/test';

/**
 * The frame budget, as a build gate.
 *
 * "It never stutters" is only true for as long as something checks. This plays
 * a real session — walking, swinging, scrolling between panels, with the HUD
 * map growing the whole time — and fails if any frame ran long enough to have
 * missed a vsync.
 *
 * It is deliberately generous about the *threshold* and strict about the
 * *count*: a headless CI runner is a noisy place to measure absolute frame
 * times, but a renderer that does bounded work per frame should not produce a
 * 100ms frame however loaded the machine is.
 */

const SEED = '20260830';

/** Frames allowed to overrun before the run counts as stuttering. */
const ALLOWED_LONG_FRAMES = 2;

/** A frame this long is a visible hitch at any refresh rate. */
const LONG_FRAME_MS = 100;

interface FrameTrace {
  frames: number;
  longest: number;
  long: number[];
  p99: number;
  missesTotal: number;
}

/** Instrument rAF from inside the page and collect every frame gap. */
async function trace(page: import('@playwright/test').Page, ms: number): Promise<FrameTrace> {
  await page.evaluate(() => {
    const store: number[] = [];
    (window as unknown as { __frames: number[] }).__frames = store;
    let last = performance.now();
    const tick = (now: number): void => {
      store.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.waitForTimeout(ms);

  return page.evaluate((longMs: number) => {
    const raw = (window as unknown as { __frames: number[] }).__frames;
    // Drop the first few: the very first gaps cover page setup, not gameplay.
    const frames = raw.slice(5);
    const sorted = [...frames].sort((a, b) => a - b);
    const perf = (window as unknown as { flood: { perf: { missesTotal: number } } }).flood.perf;
    return {
      frames: frames.length,
      longest: sorted.length ? sorted[sorted.length - 1] : 0,
      long: frames.filter((f) => f > longMs),
      p99: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0,
      missesTotal: perf.missesTotal,
    };
  }, LONG_FRAME_MS);
}

test.describe('frame budget', () => {
  test('holds a steady frame time through a played session', async ({ page }, info) => {
    if (info.project.name !== 'desktop') test.skip();

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(400);

    const collecting = trace(page, 6000);

    // Walk a real route: panel transitions, swings, and a growing HUD map.
    for (let lap = 0; lap < 3; lap++) {
      for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
        await page.keyboard.down(key);
        await page.waitForTimeout(240);
        await page.keyboard.up(key);
        await page.keyboard.press('Space');
        await page.waitForTimeout(60);
      }
    }

    const result = await collecting;

    expect(result.frames, 'the page produced frames').toBeGreaterThan(60);
    expect(
      result.long.length,
      `frames over ${LONG_FRAME_MS}ms: ${result.long.map((f) => f.toFixed(1)).join(', ')}`,
    ).toBeLessThanOrEqual(ALLOWED_LONG_FRAMES);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a fast-forwarded flood cannot blow the frame budget', async ({ page }, info) => {
    if (info.project.name !== 'desktop') test.skip();

    // The old loop ran every simulation step it owed inside one frame, so a
    // high `speed` — or a single slow frame — produced a hundreds-of-ms hitch.
    // The wall-clock step budget is what this is really testing.
    await page.goto(`/?seed=${SEED}&speed=120`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(400);

    const result = await trace(page, 5000);

    expect(result.frames).toBeGreaterThan(60);
    expect(
      result.long.length,
      `frames over ${LONG_FRAME_MS}ms: ${result.long.map((f) => f.toFixed(1)).join(', ')}`,
    ).toBeLessThanOrEqual(ALLOWED_LONG_FRAMES);

    // And the clock still moved, so the budget is slipping time rather than
    // freezing the run.
    const day = await page.evaluate(() => {
      const w = window as unknown as { flood: { state: { elapsed: number } } };
      return w.flood.state.elapsed / 180;
    });
    expect(day).toBeGreaterThan(1);
  });

  test('the overlay reports the frame budget', async ({ page }, info) => {
    if (info.project.name !== 'desktop') test.skip();

    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(600);

    await page.keyboard.press('F3');

    // Driving the page over CDP stalls its main thread — a keypress or an
    // evaluate round trip shows up as a real long frame. Let the window (180
    // frames, about three seconds) fill with frames nobody interfered with,
    // then judge the game on those.
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/game-perf-overlay.png' });

    const perf = await page.evaluate(() => {
      const w = window as unknown as {
        flood: {
          perf: {
            fps: number;
            interval: number;
            samples: number;
            missesInWindow: number;
            p99: number;
          };
        };
      };
      return w.flood.perf;
    });

    expect(perf.samples).toBeGreaterThan(100);
    expect(perf.fps).toBeGreaterThan(20);
    expect(perf.interval).toBeGreaterThan(0);

    // Left alone, the loop should miss nothing — and does, on real hardware.
    // A shared CI runner can steal a frame from anything, so the gate is that
    // misses are incidental rather than systematic: a regression that puts
    // real work back on the per-frame path shows up as dozens, not one.
    expect(
      perf.missesInWindow,
      `missed ${perf.missesInWindow} of ${perf.samples} frames; p99 ${perf.p99.toFixed(1)}ms`,
    ).toBeLessThan(perf.samples * 0.05);
  });
});
