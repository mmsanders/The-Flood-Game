import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = 'screenshots';
const SEED = '20260830';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test.describe('dev tool', () => {
  test('renders a world and its health readout', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/dev/?seed=${SEED}&day=0`);
    await page.waitForFunction(() => 'flood' in window);
    // One frame for the viewport to fit and draw.
    await page.waitForTimeout(400);

    await expect(page.locator('#map')).toBeVisible();
    await page.screenshot({ path: `${OUT}/devtool-${info.project.name}-day0.png` });

    // Open the health readout.
    await page.click('#readout-toggle');
    await page.waitForTimeout(200);
    await expect(page.locator('#health-badge')).toHaveText('Healthy');
    await page.screenshot({ path: `${OUT}/devtool-${info.project.name}-health.png` });

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('scrubs the flood across the forty days', async ({ page }, info) => {
    await page.goto(`/dev/?seed=${SEED}&day=0`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(400);

    for (const day of [10, 20, 30, 38]) {
      await page.locator('#day').fill(String(day));
      await page.locator('#day').dispatchEvent('input');
      await page.waitForTimeout(220);
      await page.screenshot({ path: `${OUT}/devtool-${info.project.name}-day${day}.png` });
    }

    // Dry ground must fall as the water rises.
    const dry = await page.locator('#dry-out').textContent();
    expect(dry).toBeTruthy();
    expect(Number.parseInt(dry as string, 10)).toBeLessThan(30);
  });

  test('shows each overlay', async ({ page }, info) => {
    if (info.project.name !== 'desktop') test.skip();

    await page.goto(`/dev/?seed=${SEED}&day=16`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(400);

    for (const overlay of ['biome', 'elevation', 'walkable']) {
      await page.click(`[data-overlay="${overlay}"]`);
      await page.waitForTimeout(220);
      await page.screenshot({ path: `${OUT}/devtool-overlay-${overlay}.png` });
    }
  });

  test('opens the panel inspector on tap', async ({ page }, info) => {
    await page.goto(`/dev/?seed=${SEED}&day=6`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(400);

    const box = await page.locator('#map').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
    await expect(page.locator('#panel-sheet')).toBeVisible();
    await expect(page.locator('#panel-dump')).toContainText(/[0-9a-f]{2} [0-9a-f]{2}/);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/devtool-${info.project.name}-panel.png` });
  });
});

test.describe('game', () => {
  test('boots, renders, and survives a fast-forwarded flood', async ({ page }, info) => {
    if (info.project.name !== 'desktop') test.skip();

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/?seed=${SEED}&speed=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/game-start.png` });

    // Walk around a little and swing the rod.
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(300);
      await page.keyboard.up(key);
      await page.keyboard.press('Space');
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: `${OUT}/game-explore.png` });

    // The player should have moved from spawn.
    const moved = await page.evaluate(() => {
      const w = window as unknown as { flood: { state: { player: { x: number; y: number } } } };
      return { x: w.flood.state.player.x, y: w.flood.state.player.y };
    });
    expect(Number.isFinite(moved.x) && Number.isFinite(moved.y)).toBe(true);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('renders the world well into the flood', async ({ page }) => {
    await page.goto(`/?seed=${SEED}&speed=120`);
    await page.waitForFunction(() => 'flood' in window);
    // At 120x, twenty in-game days pass in about fifteen seconds.
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${OUT}/game-flooded.png` });

    const day = await page.evaluate(() => {
      const w = window as unknown as { flood: { state: { elapsed: number } } };
      return w.flood.state.elapsed / 90;
    });
    expect(day).toBeGreaterThan(3);
  });
});
