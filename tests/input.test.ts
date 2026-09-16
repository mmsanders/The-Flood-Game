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

  it('feeds touch controls through the same intents and does not lose quick taps', () => {
    const target = new EventTarget();
    const input = new Input(target);

    input.setVirtual('right', true);
    input.setVirtual('up', true);
    input.setVirtual('attack', true);
    input.setVirtual('attack', false); // finger was quicker than one animation frame

    const first = input.read();
    expect(first.moveX).toBe(1);
    expect(first.moveY).toBe(-1);
    expect(first.attack).toBe(false);
    expect(first.attackPressed).toBe(true);

    input.endFrame();
    expect(input.read().attackPressed).toBe(false);

    input.setVirtual('right', false);
    input.setVirtual('up', false);
    expect(input.read().moveX).toBe(0);
    expect(input.read().moveY).toBe(0);

    input.dispose();
  });

  it('releaseAll clears keyboard and virtual holds before a modal closes', () => {
    const target = new EventTarget();
    const input = new Input(target);

    target.dispatchEvent(key('keydown', 'KeyD'));
    input.setVirtual('down', true);
    input.setVirtual('interact', true);
    input.releaseAll();

    const intents = input.read();
    expect(intents.moveX).toBe(0);
    expect(intents.moveY).toBe(0);
    expect(intents.interactPressed).toBe(false);

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
