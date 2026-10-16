import { strokeOutline, outlineCommands, commandsToSvg, finishStroke, trimSignature } from './ink.js';

/**
 * Drawing surface for a signature. Records pointer samples (with pressure and
 * coalesced events, so fast pen strokes stay smooth) in CSS pixels and renders
 * them with the same outline code the PDF export uses.
 */
export class SignaturePad {
  constructor(canvas, { onChange, onPen } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.onPen = onPen || (() => {});
    this.strokes = [];
    this.paths = [];
    this.current = null;
    this.ink = { color: '#1f3a93', pen: 'ballpoint', sizeScale: 1 };
    this.frame = 0;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('lostpointercapture', (e) => this.up(e));
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  setInk(ink) {
    this.ink = { ...this.ink, ...ink };
    this.paths = this.strokes.map((s) => this.pathFor(s, true));
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.draw();
  }

  clear() {
    this.strokes = [];
    this.paths = [];
    this.current = null;
    this.draw();
    this.onChange();
  }

  undo() {
    this.strokes.pop();
    this.paths.pop();
    this.draw();
    this.onChange();
  }

  /**
   * The drawing as a trimmed signature object, or null if nothing is drawn.
   * `baseline` is the y of the pad's signing line, kept so placement can put
   * the signature on a document's line the way it was drawn on the pad's.
   */
  toSignature(kind, baseline) {
    const sig = trimSignature({
      id: crypto.randomUUID(),
      kind,
      created: Date.now(),
      color: this.ink.color,
      pen: this.ink.pen,
      sizeScale: this.ink.sizeScale,
      baseline,
      strokes: this.strokes.map((s) => ({ sim: s.sim, pts: s.pts.map(([x, y, p]) => [round(x), round(y), round(p)]) }))
    });
    return sig;
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, pressureOf(e)];
  }

  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.current) return;
    e.preventDefault();
    capture(this.canvas, e.pointerId);
    this.current = { id: e.pointerId, type: e.pointerType, pts: [this.point(e)] };
    this.schedule();
  }

  move(e) {
    if (!this.current || e.pointerId !== this.current.id) return;
    for (const ev of samplesOf(e)) this.current.pts.push(this.point(ev));
    this.schedule();
  }

  up(e) {
    if (!this.current || e.pointerId !== this.current.id) return;
    const { pts, type } = this.current;
    this.current = null;
    const stroke = finishStroke(pts, type);
    this.strokes.push(stroke);
    this.paths.push(this.pathFor(stroke, true));
    if (type === 'pen') this.onPen(!stroke.sim);
    this.draw();
    this.onChange();
  }

  pathFor(stroke, last) {
    const outline = strokeOutline(stroke, this.ink.pen, this.ink.sizeScale, last);
    return new Path2D(commandsToSvg(outlineCommands(outline)));
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.ink.color;
    for (const p of this.paths) ctx.fill(p);
    if (this.current) ctx.fill(this.pathFor(finishStroke(this.current.pts, this.current.type), false));
  }
}

const round = (v) => Math.round(v * 100) / 100;

/** Pen and touch pressure, floored so a light touch-down still leaves ink; mice get a constant. */
export const pressureOf = (e) => (e.pointerType === 'mouse' ? 0.5 : Math.max(0.05, e.pressure || 0.5));

/** Pointer samples since the last event; synthetic and some pen events report none. */
export const samplesOf = (e) => {
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  return list.length ? list : [e];
};

/** Capture keeps a stroke going when it leaves the canvas; drawing still works without it. */
export function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already released or not capturable (some pen drivers).
  }
}
