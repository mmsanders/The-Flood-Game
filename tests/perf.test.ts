import { describe, expect, it } from 'vitest';
import { MISS_RATIO, PERF_WINDOW, PerfMonitor } from '../src/game/perf.js';

/**
 * Feed `n` frames of `ms` each, past the warm-up frame the monitor drops.
 */
function feed(monitor: PerfMonitor, ms: number, n: number): void {
  for (let i = 0; i < n + 1; i++) monitor.record(ms, 1);
}

describe('perf monitor', () => {
  it('reports nothing before the first frame', () => {
    const p = new PerfMonitor().read();
    expect(p.samples).toBe(0);
    expect(p.fps).toBe(0);
    expect(p.missesTotal).toBe(0);
  });

  it('derives fps and percentiles from the window', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 120);
    const p = m.read();
    expect(p.samples).toBe(120);
    expect(p.fps).toBeCloseTo(60, 0);
    expect(p.p50).toBeCloseTo(16.667, 2);
    expect(p.worst).toBeCloseTo(16.667, 2);
  });

  it('keeps only the most recent window', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, PERF_WINDOW * 2);
    expect(m.read().samples).toBe(PERF_WINDOW);
  });

  it('one freakishly short frame does not redefine the display rate', () => {
    // A coalesced pair of callbacks used to set the floor permanently, after
    // which every ordinary frame on a 60Hz panel counted as a dropped one.
    const m = new PerfMonitor();
    feed(m, 16.667, 120);
    m.record(12, 1);
    feed(m, 16.667, 60);

    expect(1000 / m.read().interval).toBeCloseTo(60, 0);
    expect(m.read().missesTotal).toBe(0);
  });

  it('infers the display rate from the frames it is actually presenting', () => {
    const sixty = new PerfMonitor();
    feed(sixty, 16.667, 30);
    expect(1000 / sixty.read().interval).toBeCloseTo(60, 0);

    const fast = new PerfMonitor();
    feed(fast, 6.944, 30);
    expect(1000 / fast.read().interval).toBeCloseTo(144, 0);
  });

  it('counts a frame that overran the display interval as a miss', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 60);
    expect(m.read().missesTotal).toBe(0);

    // A frame that ran past 1.5 vsyncs has certainly missed one.
    m.record(16.667 * MISS_RATIO + 1, 1);
    const p = m.read();
    expect(p.missesTotal).toBe(1);
    expect(p.missesInWindow).toBe(1);
    expect(p.worst).toBeGreaterThan(p.p50);
  });

  it('does not count a frame that ran slightly long', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 60);
    m.record(16.667 * 1.2, 1);
    expect(m.read().missesTotal).toBe(0);
  });

  it('ignores the huge gap a backgrounded tab returns', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 60);
    m.record(4000, 1);
    const p = m.read();
    expect(p.missesTotal).toBe(0);
    expect(p.worst).toBeCloseTo(16.667, 2);
  });

  it('a miss at 144Hz would not have been one at 60Hz', () => {
    // The budget is the display's, not a fixed 16ms: this is the whole reason
    // the monitor measures the interval rather than assuming it.
    const fast = new PerfMonitor();
    feed(fast, 6.944, 60);
    fast.record(12, 1);
    expect(fast.read().missesTotal).toBe(1);

    const slow = new PerfMonitor();
    feed(slow, 16.667, 60);
    slow.record(12, 1);
    expect(slow.read().missesTotal).toBe(0);
  });

  it('ignores the first frame, which covers page start-up rather than play', () => {
    const m = new PerfMonitor();
    m.record(400, 1); // the gap that spans the rest of boot
    expect(m.read().samples).toBe(0);
    expect(m.read().missesTotal).toBe(0);

    m.record(16.667, 1);
    expect(m.read().samples).toBe(1);
  });

  it('never reports fewer total misses than it is showing in the window', () => {
    // The display interval is inferred from the fastest frame seen, so a long
    // frame arriving before it converges used to be judged against itself and
    // ruled clean — the overlay then read "1 in window / 0 total".
    const m = new PerfMonitor();
    m.record(16.667, 1); // warm-up, dropped
    m.record(116.7, 1); // arrives while the interval is still unknown
    feed(m, 16.667, 60); // ...and now the interval settles at 60Hz

    const p = m.read();
    expect(p.missesInWindow).toBe(1);
    expect(p.missesTotal).toBeGreaterThanOrEqual(p.missesInWindow);
  });

  it('keeps counting misses after they scroll out of the window', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 30);
    m.record(200, 1);
    expect(m.read().missesTotal).toBe(1);
    expect(m.read().missesInWindow).toBe(1);

    // Push the long frame out the back of the ring; the tally must survive.
    feed(m, 16.667, PERF_WINDOW + 10);
    const p = m.read();
    expect(p.missesInWindow).toBe(0);
    expect(p.missesTotal).toBe(1);
  });

  it('resets on a new run', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 60);
    m.record(200, 1);
    expect(m.read().missesTotal).toBe(1);

    m.reset();
    expect(m.read().samples).toBe(0);
    expect(m.read().missesTotal).toBe(0);
  });

  it('reuses one snapshot object, so reading costs nothing', () => {
    const m = new PerfMonitor();
    feed(m, 16.667, 10);
    expect(m.read()).toBe(m.read());
  });
});
