/**
 * Input.
 *
 * An intent layer rather than a key-code layer: the rest of the game asks for
 * `moveX`/`attack`, never for "is KeyZ down". Touch controls can be added later
 * by feeding the same intents without any change to the game code.
 */

export interface Intents {
  moveX: number;
  moveY: number;
  attack: boolean;
  /** True only on the frame the key went down. */
  attackPressed: boolean;
  interactPressed: boolean;
  restartPressed: boolean;
  fastForward: boolean;
}

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  attack: ['Space', 'KeyZ', 'KeyJ'],
  interact: ['KeyE', 'KeyX', 'Enter'],
  restart: ['KeyR'],
  fast: ['ShiftLeft', 'ShiftRight'],
} as const;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      if (isGameKey(ev.code)) ev.preventDefault();
      if (!this.down.has(ev.code)) this.pressed.add(ev.code);
      this.down.add(ev.code);
    });

    target.addEventListener('keyup', (e) => {
      this.down.delete((e as KeyboardEvent).code);
    });

    // Releasing focus mid-hold would otherwise leave the player walking.
    window.addEventListener('blur', () => this.down.clear());
  }

  read(): Intents {
    const held = (codes: readonly string[]): boolean => codes.some((c) => this.down.has(c));
    const hit = (codes: readonly string[]): boolean => codes.some((c) => this.pressed.has(c));

    return {
      moveX: (held(KEYS.right) ? 1 : 0) - (held(KEYS.left) ? 1 : 0),
      moveY: (held(KEYS.down) ? 1 : 0) - (held(KEYS.up) ? 1 : 0),
      attack: held(KEYS.attack),
      attackPressed: hit(KEYS.attack),
      interactPressed: hit(KEYS.interact),
      restartPressed: hit(KEYS.restart),
      fastForward: held(KEYS.fast),
    };
  }

  /** Call once per frame, after reading, to clear edge-triggered state. */
  endFrame(): void {
    this.pressed.clear();
  }
}

function isGameKey(code: string): boolean {
  for (const codes of Object.values(KEYS)) {
    if ((codes as readonly string[]).includes(code)) return true;
  }
  return false;
}
