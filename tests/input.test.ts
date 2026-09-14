import { describe, expect, it } from 'vitest';
import { Input } from '../src/game/input.js';

function key(type: string, code: string): Event {
  const ev = new Event(type);
  Object.assign(ev, {
    code,
    repeat: false,
    preventDefault() {},
  });
  return ev;
}

describe('input', () => {
  it('reports held movement and edge-triggered attacks', () => {
    const target = new EventTarget();
    const input = new Input(target);

    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(key('keydown', 'Space'));

    const first = input.read();
    expect(first.moveX).toBe(1);
    expect(first.attackPressed).toBe(true);

    input.endFrame();
    const held = input.read();
    expect(held.moveX).toBe(1);
    expect(held.attackPressed).toBe(false);

    input.dispose();
  });

  it('stops receiving keys after dispose, so an HMR swap cannot double-bind', () => {
    const target = new EventTarget();
    const input = new Input(target);

    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(key('keydown', 'Space'));

    const intents = input.read();
    expect(intents.moveX).toBe(0);
    expect(intents.attackPressed).toBe(false);
  });
});
