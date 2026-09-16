import type { Input, VirtualAction } from './input.js';

const TOUCH_QUERY = 'touch';

/**
 * Prefer capabilities over user-agent sniffing. `?touch=1` and `?touch=0`
 * exist for screenshot tests and for odd browser/device combinations.
 */
export function wantsTouchControls(): boolean {
  const forced = new URL(window.location.href).searchParams.get(TOUCH_QUERY);
  if (forced === '1') return true;
  if (forced === '0') return false;

  const touchPoints = navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrowScreen = Math.min(window.screen.width, window.screen.height) <= 900;
  return touchPoints && (coarse || narrowScreen);
}

export interface TouchMeasurements {
  bottomHeight: number;
  leftWidth: number;
  rightWidth: number;
}

type InputGetter = () => Input;
type Cleanup = () => void;

/**
 * Phone controls deliberately live outside the simulation. They only turn
 * fingers into virtual input intents, preserving the same game behaviour as
 * the keyboard.
 */
export class TouchControls {
  readonly enabled: boolean;

  private readonly getInput: InputGetter;
  private readonly cleanups: Cleanup[] = [];
  private readonly dpad: HTMLElement | null;
  private readonly actions: HTMLElement | null;
  private readonly utility: HTMLElement | null;
  private dpadPointer: number | null = null;
  private dpadState = { up: false, down: false, left: false, right: false };

  constructor(getInput: InputGetter) {
    this.getInput = getInput;
    this.enabled = wantsTouchControls();
    this.dpad = document.getElementById('dpad');
    this.actions = document.getElementById('action-cluster');
    this.utility = document.getElementById('utility-controls');

    if (!this.enabled) return;

    document.documentElement.classList.add('touch-ui');
    this.bindDPad();

    const buttons = document.querySelectorAll<HTMLElement>('[data-virtual-action]');
    for (const button of buttons) {
      const action = button.dataset.virtualAction as VirtualAction | undefined;
      if (action) this.bindButton(button, action);
    }

    const preventContextMenu = (ev: Event) => ev.preventDefault();
    document.addEventListener('contextmenu', preventContextMenu);
    this.cleanups.push(() => document.removeEventListener('contextmenu', preventContextMenu));
  }

  /** Space that the physical controls need around the game screen. */
  measure(): TouchMeasurements {
    if (!this.enabled) return { bottomHeight: 0, leftWidth: 0, rightWidth: 0 };

    const dpad = this.dpad?.getBoundingClientRect();
    const actions = this.actions?.getBoundingClientRect();
    const utility = this.utility?.getBoundingClientRect();

    return {
      bottomHeight: Math.max(dpad?.height ?? 0, actions?.height ?? 0, utility?.height ?? 0) + 30,
      leftWidth: Math.max(dpad?.width ?? 0, utility?.width ?? 0) + 24,
      rightWidth: (actions?.width ?? 0) + 24,
    };
  }

  release(): void {
    this.setDPad(false, false, false, false);
    this.dpadPointer = null;
    this.getInput().releaseAll();
    document.querySelectorAll('.touch-button.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
  }

  dispose(): void {
    this.release();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    document.documentElement.classList.remove('touch-ui');
  }

  private bindButton(button: HTMLElement, action: VirtualAction): void {
    const active = new Set<number>();

    const down = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      active.add(ev.pointerId);
      button.classList.add('is-pressed');
      this.getInput().setVirtual(action, true);
      try {
        button.setPointerCapture(ev.pointerId);
      } catch {
        // Synthetic test events are not always capturable; the input still works.
      }
    };

    const up = (ev: PointerEvent) => {
      if (!active.delete(ev.pointerId)) return;
      ev.preventDefault();
      if (active.size === 0) {
        button.classList.remove('is-pressed');
        this.getInput().setVirtual(action, false);
      }
    };

    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);

    this.cleanups.push(() => {
      button.removeEventListener('pointerdown', down);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      button.removeEventListener('lostpointercapture', up);
    });
  }

  /**
   * The whole cross is one touch target. Sliding a thumb from up to right (or
   * through a diagonal) changes direction without forcing a lift/re-tap.
   */
  private bindDPad(): void {
    if (!this.dpad) return;

    const down = (ev: PointerEvent) => {
      if (this.dpadPointer !== null) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      this.dpadPointer = ev.pointerId;
      try {
        this.dpad?.setPointerCapture(ev.pointerId);
      } catch {
        // See the note in bindButton about synthetic events.
      }
      this.updateDPad(ev.clientX, ev.clientY);
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== this.dpadPointer) return;
      ev.preventDefault();
      this.updateDPad(ev.clientX, ev.clientY);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== this.dpadPointer) return;
      ev.preventDefault();
      this.dpadPointer = null;
      this.setDPad(false, false, false, false);
    };

    this.dpad.addEventListener('pointerdown', down);
    this.dpad.addEventListener('pointermove', move);
    this.dpad.addEventListener('pointerup', up);
    this.dpad.addEventListener('pointercancel', up);
    this.dpad.addEventListener('lostpointercapture', up);

    this.cleanups.push(() => {
      this.dpad?.removeEventListener('pointerdown', down);
      this.dpad?.removeEventListener('pointermove', move);
      this.dpad?.removeEventListener('pointerup', up);
      this.dpad?.removeEventListener('pointercancel', up);
      this.dpad?.removeEventListener('lostpointercapture', up);
    });
  }

  private updateDPad(clientX: number, clientY: number): void {
    if (!this.dpad) return;
    const box = this.dpad.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;

    const dx = (clientX - (box.left + box.width / 2)) / (box.width / 2);
    const dy = (clientY - (box.top + box.height / 2)) / (box.height / 2);
    const radius = Math.hypot(dx, dy);

    // A small neutral centre makes it easy to stop without lifting your thumb.
    if (radius < 0.24) {
      this.setDPad(false, false, false, false);
      return;
    }

    // Eight-way sectors, with cardinal directions centred on the four arms.
    const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    let up = false;
    let down = false;
    let left = false;
    let right = false;

    switch (octant) {
      case 0:
        right = true;
        break;
      case 1:
        right = true;
        down = true;
        break;
      case 2:
        down = true;
        break;
      case 3:
        down = true;
        left = true;
        break;
      case 4:
      case -4:
        left = true;
        break;
      case -3:
        left = true;
        up = true;
        break;
      case -2:
        up = true;
        break;
      case -1:
        up = true;
        right = true;
        break;
    }

    this.setDPad(up, down, left, right);
  }

  private setDPad(up: boolean, down: boolean, left: boolean, right: boolean): void {
    const next = { up, down, left, right };
    const input = this.getInput();

    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (this.dpadState[dir] !== next[dir]) input.setVirtual(dir, next[dir]);
      const key = this.dpad?.querySelector<HTMLElement>(`[data-dir="${dir}"]`);
      key?.classList.toggle('is-active', next[dir]);
    }

    this.dpadState = next;
  }
}

/** Small in-game confirmation instead of a destructive restart button beside A/B. */
export class RestartDialog {
  private readonly root: HTMLElement;
  private readonly restartButton: HTMLButtonElement | null;
  private readonly confirmButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly onConfirm: () => void;
  private readonly onVisibilityChange: () => void;
  private readonly onRestartClick: (ev: Event) => void;
  private readonly onConfirmClick: (ev: Event) => void;
  private readonly onCancelClick: (ev: Event) => void;
  private readonly onRootClick: (ev: Event) => void;
  private readonly onKeyDown: (ev: KeyboardEvent) => void;

  constructor(onConfirm: () => void, onVisibilityChange: () => void) {
    const root = document.getElementById('restart-dialog');
    const confirm = document.getElementById('restart-confirm');
    const cancel = document.getElementById('restart-cancel');
    if (!root || !(confirm instanceof HTMLButtonElement) || !(cancel instanceof HTMLButtonElement)) {
      throw new Error('Restart dialog markup is missing');
    }

    this.root = root;
    this.restartButton = document.getElementById('restart-button') as HTMLButtonElement | null;
    this.confirmButton = confirm;
    this.cancelButton = cancel;
    this.onConfirm = onConfirm;
    this.onVisibilityChange = onVisibilityChange;

    this.onRestartClick = (ev) => {
      ev.preventDefault();
      this.open();
    };
    this.onConfirmClick = (ev) => {
      ev.preventDefault();
      this.onConfirm();
      this.close();
    };
    this.onCancelClick = (ev) => {
      ev.preventDefault();
      this.close();
    };
    this.onRootClick = (ev) => {
      if (ev.target === this.root) this.close();
    };
    this.onKeyDown = (ev) => {
      if (ev.key === 'Escape' && this.isOpen) {
        ev.preventDefault();
        this.close();
      }
    };

    this.restartButton?.addEventListener('click', this.onRestartClick);
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    this.cancelButton.addEventListener('click', this.onCancelClick);
    this.root.addEventListener('click', this.onRootClick);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.onVisibilityChange();
    this.root.hidden = false;
    document.documentElement.classList.add('restart-open');
    requestAnimationFrame(() => this.cancelButton.focus({ preventScroll: true }));
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.documentElement.classList.remove('restart-open');
    this.onVisibilityChange();
    this.restartButton?.focus({ preventScroll: true });
  }

  dispose(): void {
    this.restartButton?.removeEventListener('click', this.onRestartClick);
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.cancelButton.removeEventListener('click', this.onCancelClick);
    this.root.removeEventListener('click', this.onRootClick);
    window.removeEventListener('keydown', this.onKeyDown);
    document.documentElement.classList.remove('restart-open');
  }
}
