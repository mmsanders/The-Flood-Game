/**
 * Flock high score. localStorage, keyed per-browser — not a win condition,
 * just the number you try to beat next run.
 */

import type { FlockScore } from '../core/animals.js';

const KEY = 'the-flood-flock-best-v1';

export interface BestFlock {
  pairs: number;
  rescued: number;
}

export function loadBestFlock(): BestFlock {
  if (typeof localStorage === 'undefined') return { pairs: 0, rescued: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { pairs: 0, rescued: 0 };
    const parsed = JSON.parse(raw) as Partial<BestFlock>;
    return {
      pairs: Math.max(0, Number(parsed.pairs) || 0),
      rescued: Math.max(0, Number(parsed.rescued) || 0),
    };
  } catch {
    return { pairs: 0, rescued: 0 };
  }
}

export function considerBestFlock(score: FlockScore, current: BestFlock): BestFlock {
  const next: BestFlock = { pairs: score.pairs, rescued: score.rescued };
  const better =
    next.pairs > current.pairs ||
    (next.pairs === current.pairs && next.rescued > current.rescued);
  if (!better) return current;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }
  return next;
}
