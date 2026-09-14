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
  private readonly target: EventTarget;
  private readonly onKeyDown: (e: Event) => void;
  private readonly onKeyUp: (e: Event) => void;
  private readonly onBlur: () => void;

  constructor(target: EventTarget = window) {
    this.target = target;

    this.onKeyDown = (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      if (isGameKey(ev.code)) ev.preventDefault();
      if (!this.down.has(ev.code)) this.pressed.add(ev.code);
      this.down.add(ev.code);
    };

    this.onKeyUp = (e) => {
      this.down.delete((e as KeyboardEvent).code);
    };

    // Releasing focus mid-hold would otherwise leave the player walking.
    this.onBlur = () => this.down.clear();

    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
  }

  /** Drop listeners so an HMR swap cannot leave a ghost Input walking the player. */
  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.onBlur);
    this.down.clear();
    this.pressed.clear();
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
