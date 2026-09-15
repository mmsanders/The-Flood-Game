/**
 * Frame-time measurement.
 *
 * "It never stutters" has to be something you can look at, or it is a vibe
 * that quietly stops being true three features later. This keeps a ring buffer
 * of recent frame times, works out the display's actual refresh interval, and
 * counts the frames that missed it.
 *
 * Deliberately allocation-free after construction: a monitor that produces
 * garbage is measuring itself.
 */

/** Frames kept for the percentile readout — a couple of seconds at 60Hz. */
export const PERF_WINDOW = 180;

/**
 * How far over the vsync interval a frame may run before it counts as a miss.
 *
 * Browsers deliver rAF timestamps with real jitter, and a frame that lands
 * 20% late still presents on the same vsync. Past 1.5x it has certainly missed
 * one, which is the point at which a person sees a hitch.
 */
export const MISS_RATIO = 1.5;

/** Frames between refreshes of the display-interval estimate. */
const ESTIMATE_EVERY = 30;

export interface PerfSnapshot {
  /** Frames per second over the window. */
  fps: number;
  /** Median frame time, ms. */
  p50: number;
  /** 99th percentile frame time, ms. */
  p99: number;
  /** Worst frame in the window, ms. */
  worst: number;
  /** Estimated display interval, ms — 16.67 at 60Hz, 6.94 at 144Hz. */
  interval: number;
  /** Frames in the window that ran past `interval * MISS_RATIO`. */
  missesInWindow: number;
  /** Frames that have missed since the run started. */
  missesTotal: number;
  /** Simulation substeps run on the last frame. */
  steps: number;
  /** Frames recorded so far, capped at the window size. */
  samples: number;
}

export class PerfMonitor {
  private readonly times = new Float64Array(PERF_WINDOW);
  private readonly sorted = new Float64Array(PERF_WINDOW);
  private cursor = 0;
  private filled = 0;
  private warmed = false;
  /** Misses among samples that have already scrolled out of the window. */
  private missesEvicted = 0;
  private lastSteps = 0;
  /** Running estimate of the display interval, in ms. See `interval`. */
  private estimate = 0;
  private sinceEstimate = 0;
  private readonly snapshot: PerfSnapshot = {
    fps: 0,
    p50: 0,
    p99: 0,
    worst: 0,
    interval: 16.667,
    missesInWindow: 0,
    missesTotal: 0,
    steps: 0,
    samples: 0,
  };

  /** Record one presented frame. `ms` is the gap since the previous frame. */
  record(ms: number, steps: number): void {
    // A tab that was backgrounded returns one enormous gap that is not a
    // dropped frame and would poison the floor estimate for the whole run.
    if (ms > 500) return;

    // The first gap spans the rest of module initialisation, not a frame of
    // gameplay. Counting it would make `missesTotal` mean "the page loaded",
    // which is the one number here that has to stay trustworthy.
    if (!this.warmed) {
      this.warmed = true;
      return;
    }

    // A sample leaving the window is judged on its way out, not on its way in.
    // The display interval is inferred from the fastest frame seen, so it is
    // still converging during the first frames of a run — an early long frame
    // judged at record time compares itself against *itself* and is ruled
    // clean, which is how the overlay came to show more misses in the window
    // than it had ever counted in total.
    if (this.filled === PERF_WINDOW) {
      if (this.times[this.cursor] > this.interval() * MISS_RATIO) this.missesEvicted++;
    }

    this.times[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % PERF_WINDOW;
    if (this.filled < PERF_WINDOW) this.filled++;
    this.lastSteps = steps;

    this.trackInterval();
  }

  /**
   * Re-estimate the display interval from the window: its 20th percentile.
   *
   * This started out as "the fastest frame seen", which is wrong in a way that
   * matters. Browsers occasionally coalesce two callbacks into one short gap,
   * and a single 12ms frame on a 60Hz display would redefine the display as
   * 90Hz forever — after which every ordinary 16.7ms frame reads as a dropped
   * one. A minimum is not a robust statistic.
   *
   * A low percentile is: it ignores the short outliers below it and every
   * dropped frame above it, and it lands exactly on the cadence the display is
   * actually presenting at. Recomputed periodically rather than per frame,
   * since the display rate changes about as often as the user changes monitor.
   */
  private trackInterval(): void {
    const n = this.filled;
    if (n === 0) return;
    if (this.sinceEstimate++ < ESTIMATE_EVERY && this.estimate !== 0) return;
    this.sinceEstimate = 0;

    const sorted = this.sorted;
    for (let i = 0; i < n; i++) sorted[i] = this.times[i];
    insertionSort(sorted, n);
    this.estimate = sorted[Math.min(n - 1, (n * 0.2) | 0)];
  }

  /**
   * The display's frame interval, in ms.
   *
   * Measured rather than asked for — browsers do not expose the refresh rate —
   * and snapped to the common rates, so the readout says "60Hz" instead of
   * "59.94Hz" and the miss threshold sits on a round number.
   */
  interval(): number {
    if (this.estimate === 0) return 16.667;
    const rates = [16.667, 11.111, 10, 8.333, 6.944, 4.167];
    let best = rates[0];
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rates.length; i++) {
      const diff = Math.abs(this.estimate - rates[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = rates[i];
      }
    }
    // Something exotic (or a throttled tab): trust the measurement instead.
    return bestDiff > 2 ? this.estimate : best;
  }

  /** Current statistics. The returned object is reused between calls. */
  read(): PerfSnapshot {
    const s = this.snapshot;
    const n = this.filled;
    s.samples = n;
    s.steps = this.lastSteps;
    s.interval = this.interval();

    if (n === 0) {
      s.fps = 0;
      s.p50 = 0;
      s.p99 = 0;
      s.worst = 0;
      s.missesInWindow = 0;
      s.missesTotal = this.missesEvicted;
      return s;
    }

    const sorted = this.sorted;
    let total = 0;
    let misses = 0;
    const threshold = s.interval * MISS_RATIO;
    for (let i = 0; i < n; i++) {
      const t = this.times[i];
      sorted[i] = t;
      total += t;
      if (t > threshold) misses++;
    }
    insertionSort(sorted, n);

    s.fps = total > 0 ? (n * 1000) / total : 0;
    s.p50 = sorted[(n * 0.5) | 0];
    s.p99 = sorted[Math.min(n - 1, (n * 0.99) | 0)];
    s.worst = sorted[n - 1];
    s.missesInWindow = misses;
    // Both halves are measured against the interval as it is now, so the total
    // can never be smaller than the part of it currently on screen.
    s.missesTotal = this.missesEvicted + misses;
    return s;
  }

  reset(): void {
    this.cursor = 0;
    this.filled = 0;
    this.missesEvicted = 0;
    this.warmed = false;
    this.estimate = 0;
    this.sinceEstimate = 0;
  }
}

/**
 * Sorts in place over the first `n` entries. Insertion sort because the window
 * is small and almost always nearly sorted, and because `Array.prototype.sort`
 * on a typed array would want a comparator closure every frame.
 */
function insertionSort(a: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = v;
  }
}
