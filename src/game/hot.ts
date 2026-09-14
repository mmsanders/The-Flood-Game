/**
 * Visible signals for the play-and-hotfix loop.
 *
 * Vite does the module swap. This file only tells the player a patch landed
 * without taking the window away from the game.
 */

const TOAST_MS = 1600;
const COALESCE_MS = 40;

let hideTimer = 0;
let coalesceTimer = 0;
const pending: string[] = [];

/** Turn on the LIVE badge. Call once the HMR socket is actually connected. */
export function markLive(): void {
  const badge = document.getElementById('live-badge');
  if (badge) badge.hidden = false;
}

/**
 * Flash a toast, coalescing bursts so a rules+look patch is one message
 * rather than two stacked ones.
 */
export function flashHotfix(label: string): void {
  pending.push(label);
  window.clearTimeout(coalesceTimer);
  coalesceTimer = window.setTimeout(flush, COALESCE_MS);
}

function flush(): void {
  const labels = [...new Set(pending)];
  pending.length = 0;

  const node = document.getElementById('hotfix');
  if (!node) return;

  const text = `hotfix · ${labels.join(' · ')}`;
  node.textContent = text;
  node.classList.remove('show');
  // Force a reflow so re-adding `.show` restarts the fade even on a rapid pair.
  void node.offsetWidth;
  node.classList.add('show');

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (node.textContent === text) node.classList.remove('show');
  }, TOAST_MS);

  console.info(`[flood] ${text}`);
}
