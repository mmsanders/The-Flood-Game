import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SEED = '20260830';
const OUT = 'screenshots';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

async function expectInsideViewport(page: import('@playwright/test').Page, selectors: string[]): Promise<void> {
  const result = await page.evaluate((items) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    return items.map((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return { selector, exists: false, inside: false };
      const r = el.getBoundingClientRect();
      return {
        selector,
        exists: true,
        inside: r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1,
      };
    });
  }, selectors);

  expect(result, JSON.stringify(result)).toEqual(
    selectors.map((selector) => ({ selector, exists: true, inside: true })),
  );
}

test.describe('mobile game controls', () => {
  test('fit a small portrait phone and require confirmation before restart', async ({ page }, info) => {
    if (info.project.name !== 'phone') test.skip();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/?seed=${SEED}&touch=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(250);

    await expect(page.locator('#dpad')).toBeVisible();
    await expect(page.locator('#action-a')).toBeVisible();
    await expect(page.locator('#action-b')).toBeVisible();
    await expect(page.locator('#flock-button')).toBeVisible();
    await expect(page.locator('#restart-button')).toBeVisible();

    await expectInsideViewport(page, [
      '#screen',
      '#dpad',
      '#action-cluster',
      '#flock-button',
      '#restart-button',
    ]);

    await page.screenshot({ path: `${OUT}/game-mobile-portrait-small.png` });

    const originalSeed = new URL(page.url()).searchParams.get('seed');
    await page.locator('#restart-button').click();
    await expect(page.locator('#restart-dialog')).toBeVisible();
    await expect(page.locator('#restart-confirm')).toHaveText('YES, REALLY RESTART');
    await page.screenshot({ path: `${OUT}/game-mobile-restart-confirm.png` });

    await page.locator('#restart-cancel').click();
    await expect(page.locator('#restart-dialog')).toBeHidden();
    expect(new URL(page.url()).searchParams.get('seed')).toBe(originalSeed);

    await page.locator('#restart-button').click();
    await page.locator('#restart-confirm').click();
    await expect(page.locator('#restart-dialog')).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('seed')).not.toBe(originalSeed);
  });

  test('moves controls beside the screen in small-phone landscape', async ({ page }, info) => {
    if (info.project.name !== 'phone') test.skip();

    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto(`/?seed=${SEED}&touch=1`);
    await page.waitForFunction(() => 'flood' in window);
    await page.waitForTimeout(250);

    await expectInsideViewport(page, ['#screen', '#dpad', '#action-cluster', '#restart-button']);

    const layout = await page.evaluate(() => {
      const screen = document.querySelector('#screen')!.getBoundingClientRect();
      const dpad = document.querySelector('#dpad')!.getBoundingClientRect();
      const actions = document.querySelector('#action-cluster')!.getBoundingClientRect();
      return {
        dpadBeforeScreen: dpad.right <= screen.left + 3,
        actionsAfterScreen: actions.left >= screen.right - 3,
      };
    });

    expect(layout.dpadBeforeScreen).toBe(true);
    expect(layout.actionsAfterScreen).toBe(true);
    await page.screenshot({ path: `${OUT}/game-mobile-landscape-small.png` });
  });
});
