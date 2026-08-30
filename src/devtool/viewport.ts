/**
 * Pan/zoom canvas viewport, driven by pointer events so touch and mouse take
 * the same path. Built for a phone first: one finger pans, two fingers pinch,
 * and a tap that doesn't drift is reported as a tap rather than a pan.
 */

export interface ViewportOptions {
  /** Content size in world units (here: tiles). */
  contentW: number;
  contentH: number;
  minScale: number;
  maxScale: number;
  /** Draw one frame. The transform is already applied to the context. */
  onDraw: (ctx: CanvasRenderingContext2D, scale: number) => void;
  /** Fired for a press that didn't turn into a drag. Coordinates are world units. */
  onTap?: (x: number, y: number) => void;
  onScaleChange?: (scale: number) => void;
}

interface Pointer {
  x: number;
  y: number;
}

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 400;

export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: ViewportOptions;

  private pointers = new Map<number, Pointer>();
  private lastCentre: Pointer | null = null;
  private lastSpread = 0;
  private pressStart: { x: number; y: number; t: number } | null = null;
  private moved = false;
  private frame = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, opts: ViewportOptions) {
    this.canvas = canvas;
    this.opts = opts;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  /** Match the backing store to the CSS box and device pixel ratio. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.requestDraw();
  }

  get viewW(): number {
    return this.canvas.width / this.dpr;
  }

  get viewH(): number {
    return this.canvas.height / this.dpr;
  }

  /** Scale and centre so the whole world is visible. */
  fit(padding = 12): void {
    const sx = (this.viewW - padding * 2) / this.opts.contentW;
    const sy = (this.viewH - padding * 2) / this.opts.contentH;
    this.setScale(Math.min(sx, sy));
    this.tx = (this.viewW - this.opts.contentW * this.scale) / 2;
    this.ty = (this.viewH - this.opts.contentH * this.scale) / 2;
    this.clamp();
    this.requestDraw();
  }

  /** Centre on a world point without changing zoom. */
  centreOn(x: number, y: number): void {
    this.tx = this.viewW / 2 - x * this.scale;
    this.ty = this.viewH / 2 - y * this.scale;
    this.clamp();
    this.requestDraw();
  }

  zoomBy(factor: number, originX?: number, originY?: number): void {
    const ox = originX ?? this.viewW / 2;
    const oy = originY ?? this.viewH / 2;
    const before = this.scale;
    this.setScale(this.scale * factor);
    const ratio = this.scale / before;
    // Keep the point under the origin fixed on screen.
    this.tx = ox - (ox - this.tx) * ratio;
    this.ty = oy - (oy - this.ty) * ratio;
    this.clamp();
    this.requestDraw();
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.tx) / this.scale,
      y: (clientY - rect.top - this.ty) / this.scale,
    };
  }

  requestDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = false;
    this.opts.onDraw(ctx, this.scale);
    ctx.restore();
  }

  private setScale(next: number): void {
    const clamped = Math.max(this.opts.minScale, Math.min(this.opts.maxScale, next));
    if (clamped !== this.scale) {
      this.scale = clamped;
      this.opts.onScaleChange?.(clamped);
    }
  }

  /** Keep at least part of the world on screen, whatever the gesture did. */
  private clamp(): void {
    const w = this.opts.contentW * this.scale;
    const h = this.opts.contentH * this.scale;
    const marginX = Math.min(this.viewW * 0.5, w * 0.5);
    const marginY = Math.min(this.viewH * 0.5, h * 0.5);
    this.tx = Math.min(this.viewW - marginX, Math.max(marginX - w, this.tx));
    this.ty = Math.min(this.viewH - marginY, Math.max(marginY - h, this.ty));
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      this.pressStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.moved = false;
    }
    this.lastCentre = this.centre();
    this.lastSpread = this.spread();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const centre = this.centre();
    const spread = this.spread();
    if (!centre || !this.lastCentre) return;

    const rect = this.canvas.getBoundingClientRect();

    // Pinch first, so a two-finger gesture doesn't also register as a pan of
    // the midpoint drift.
    if (this.pointers.size >= 2 && this.lastSpread > 0 && spread > 0) {
      this.zoomBy(
        spread / this.lastSpread,
        centre.x - rect.left,
        centre.y - rect.top,
      );
    }

    this.tx += centre.x - this.lastCentre.x;
    this.ty += centre.y - this.lastCentre.y;

    if (this.pressStart) {
      const dx = e.clientX - this.pressStart.x;
      const dy = e.clientY - this.pressStart.y;
      if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) this.moved = true;
    }

    this.lastCentre = centre;
    this.lastSpread = spread;
    this.clamp();
    this.requestDraw();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);

    if (wasSingle && this.pressStart && !this.moved) {
      const held = performance.now() - this.pressStart.t;
      if (held <= TAP_MAX_MS) {
        const p = this.screenToWorld(e.clientX, e.clientY);
        this.opts.onTap?.(p.x, p.y);
      }
    }

    if (this.pointers.size === 0) this.pressStart = null;
    this.lastCentre = this.centre();
    this.lastSpread = this.spread();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const factor = Math.pow(0.999, e.deltaY);
    this.zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  /** Midpoint of all active pointers, in client coordinates. */
  private centre(): Pointer | null {
    if (this.pointers.size === 0) return null;
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    return { x: x / this.pointers.size, y: y / this.pointers.size };
  }

  /** Mean distance from the midpoint — 0 with fewer than two pointers. */
  private spread(): number {
    if (this.pointers.size < 2) return 0;
    const c = this.centre();
    if (!c) return 0;
    let sum = 0;
    for (const p of this.pointers.values()) {
      sum += Math.hypot(p.x - c.x, p.y - c.y);
    }
    return sum / this.pointers.size;
  }
}
