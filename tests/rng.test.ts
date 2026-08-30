import { describe, expect, it } from 'vitest';
import { deriveSeed, hashSeed, mulberry32, parseSeed, shuffle, stageRng } from '../src/core/rng.js';

describe('rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let sameCount = 0;
    for (let i = 0; i < 50; i++) if (a() === b()) sameCount++;
    expect(sameCount).toBe(0);
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('derives stable, distinct sub-seeds per stage label', () => {
    expect(deriveSeed(42, 'elevation')).toBe(deriveSeed(42, 'elevation'));
    expect(deriveSeed(42, 'elevation')).not.toBe(deriveSeed(42, 'paint'));
    // Adjacent labels must not correlate — this is what lets us re-tune one
    // generation stage without disturbing the others.
    expect(deriveSeed(42, 'pois:a')).not.toBe(deriveSeed(42, 'pois:b'));
  });

  it('gives independent streams per stage', () => {
    const a = stageRng(7, 'terrain');
    const b = stageRng(7, 'dungeons');
    expect(a()).not.toBe(b());
  });

  it('parses numeric and text seeds, and rolls one when empty', () => {
    expect(parseSeed('12345')).toBe(12345);
    expect(parseSeed('noah')).toBe(hashSeed('noah'));
    expect(parseSeed('  noah  ')).toBe(hashSeed('noah'));
    expect(parseSeed('')).toBeTypeOf('number');
  });

  it('shuffles deterministically and keeps every element', () => {
    const source = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle(mulberry32(5), source.slice());
    const b = shuffle(mulberry32(5), source.slice());
    expect(a).toEqual(b);
    expect(a.slice().sort((x, y) => x - y)).toEqual(source);
  });
});
