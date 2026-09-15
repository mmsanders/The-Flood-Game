import { describe, expect, it } from 'vitest';
import { dayFraction, isDaylight, todAt } from '../src/game/tod.js';

describe('time of day', () => {
  it('wraps the fractional day into [0, 1)', () => {
    expect(dayFraction(0)).toBe(0);
    expect(dayFraction(12.2)).toBeCloseTo(0.2);
    expect(dayFraction(39.99)).toBeCloseTo(0.99);
  });

  it('is night at midnight, wrapping from dusk', () => {
    const midnight = todAt(0);
    const late = todAt(0.99);
    expect(midnight.mulB).toBeGreaterThan(midnight.mulR);
    expect(isDaylight(midnight)).toBe(false);
    expect(late.mulB).toBeGreaterThan(late.mulG);
    expect(isDaylight(late)).toBe(false);
  });

  it('is orange dawn before 5%, with a west-cast shadow', () => {
    const m = todAt(0.025);
    expect(m.mulR).toBeGreaterThan(m.mulB);
    expect(m.mulG).toBeLessThan(m.mulR);
    expect(m.shadowDx).toBeLessThan(0);
  });

  it('is unfiltered day from 5% through 95%', () => {
    for (const t of [0.05, 0.5, 0.94]) {
      const d = todAt(t);
      expect(isDaylight(d), `t=${t}`).toBe(true);
    }
  });

  it('casts a west shadow at sunrise that vanishes at noon and grows east by sunset', () => {
    const sunrise = todAt(0.05);
    const morning = todAt(0.2);
    const noon = todAt(0.5);
    const afternoon = todAt(0.8);
    const sunset = todAt(0.95);
    expect(sunrise.shadowDx).toBeLessThan(0);
    expect(morning.shadowDx).toBeLessThan(0);
    expect(Math.abs(morning.shadowDx)).toBeLessThan(Math.abs(sunrise.shadowDx));
    expect(noon.shadowDx).toBeCloseTo(0);
    expect(afternoon.shadowDx).toBeGreaterThan(0);
    expect(sunset.shadowDx).toBeGreaterThan(afternoon.shadowDx);
    expect(todAt(0).shadowAlpha).toBe(0);
    expect(todAt(0.025).shadowDx).toBeLessThan(0);
    expect(todAt(0.975).shadowDx).toBeGreaterThan(0);
  });

  it('keeps max throw at the night wrap and only fades opacity', () => {
    const dawn = todAt(0.01);
    expect(dawn.shadowDx).toBe(todAt(0.025).shadowDx);
    expect(dawn.shadowAlpha).toBeGreaterThan(0);
    expect(dawn.shadowAlpha).toBeLessThan(1);

    const dusk = todAt(0.99);
    expect(dusk.shadowDx).toBeCloseTo(todAt(0.975).shadowDx);
    expect(dusk.shadowAlpha).toBeGreaterThan(0);
    expect(dusk.shadowAlpha).toBeLessThan(todAt(0.975).shadowAlpha);
  });
});
