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
  bestiaryPressed: boolean;
  fastForward: boolean;
  /** Toggles the frame-time overlay. */
  perfPressed: boolean;
}

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  attack: ['Space', 'KeyZ', 'KeyJ'],
  interact: ['KeyE', 'KeyX', 'Enter'],
  restart: ['KeyR'],
  bestiary: ['KeyB'],
  fast: ['ShiftLeft', 'ShiftRight'],
  perf: ['F3'],
} as const;

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private readonly intents: Intents = {
    moveX: 0,
    moveY: 0,
    attack: false,
    attackPressed: false,
    interactPressed: false,
    restartPressed: false,
    bestiaryPressed: false,
    fastForward: false,
    perfPressed: false,
  };
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

  /**
   * The frame's intents.
   *
   * Written into one long-lived object rather than allocated fresh: this is
   * called every frame, and the object plus the two closures it used to build
   * were pure garbage by the next one. Callers read the result within the
   * frame; nobody should hold on to it across frames.
   */
  read(): Intents {
    const i = this.intents;
    i.moveX = (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0);
    i.moveY = (this.held(KEYS.down) ? 1 : 0) - (this.held(KEYS.up) ? 1 : 0);
    i.attack = this.held(KEYS.attack);
    i.attackPressed = this.hit(KEYS.attack);
    i.interactPressed = this.hit(KEYS.interact);
    i.restartPressed = this.hit(KEYS.restart);
    i.bestiaryPressed = this.hit(KEYS.bestiary);
    i.fastForward = this.held(KEYS.fast);
    i.perfPressed = this.hit(KEYS.perf);
    return i;
  }

  private held(codes: readonly string[]): boolean {
    for (let n = 0; n < codes.length; n++) {
      if (this.down.has(codes[n])) return true;
    }
    return false;
  }

  private hit(codes: readonly string[]): boolean {
    for (let n = 0; n < codes.length; n++) {
      if (this.pressed.has(codes[n])) return true;
    }
    return false;
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
