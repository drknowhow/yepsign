import { getStroke } from '../vendor/perfect-freehand.mjs';

const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);

// Pen models for perfect-freehand. `thinning` is how much the line narrows as
// the hand speeds up (or pressure drops), which is what makes a stroke read as ink.
export const PENS = {
  ballpoint: {
    label: 'Ballpoint',
    size: 4.2, thinning: 0.58, smoothing: 0.62, streamline: 0.4, easing: easeOutSine,
    start: { taper: 0, cap: true }, end: { taper: 5, cap: true }
  },
  fountain: {
    label: 'Fountain pen',
    size: 5.6, thinning: 0.8, smoothing: 0.6, streamline: 0.38, easing: easeOutSine,
    start: { taper: 3, cap: true }, end: { taper: 16, cap: true }
  },
  marker: {
    label: 'Felt marker',
    size: 7, thinning: 0.18, smoothing: 0.55, streamline: 0.5,
    start: { taper: 0, cap: true }, end: { taper: 0, cap: true }
  }
};

export const INKS = [
  { name: 'Blue ink', color: '#1f3a93' },
  { name: 'Black ink', color: '#17181c' },
  { name: 'Royal blue', color: '#2747c4' },
  { name: 'Green ink', color: '#1d5c3a' }
];

export function strokeOptions(pen, sizeScale = 1) {
  const base = PENS[pen] || PENS.ballpoint;
  const { label, ...opts } = base;
  return { ...opts, size: base.size * sizeScale };
}

/** Outline polygon of one stroke: [[x, y], ...] in the stroke's own units. */
export function strokeOutline(stroke, pen, sizeScale, last = true) {
  return getStroke(stroke.pts, { ...strokeOptions(pen, sizeScale), simulatePressure: stroke.sim, last });
}

/**
 * Closed smooth path through an outline polygon: start at the midpoint of the
 * last edge, then a quadratic per vertex ending at the next edge midpoint.
 * Returns commands [['M', x, y], ['Q', cx, cy, x, y], ...] (closed implicitly).
 */
export function outlineCommands(outline) {
  const n = outline.length;
  if (n < 3) return [];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(outline[n - 1], outline[0]);
  const cmds = [['M', start[0], start[1]]];
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    const m = mid(p, outline[(i + 1) % n]);
    cmds.push(['Q', p[0], p[1], m[0], m[1]]);
  }
  return cmds;
}

/** All strokes of a signature as one list of closed subpaths. */
export function signatureCommands(sig) {
  const out = [];
  for (const stroke of sig.strokes) {
    const cmds = outlineCommands(strokeOutline(stroke, sig.pen, sig.sizeScale));
    for (const c of cmds) out.push(c);
  }
  return out;
}

const f = (v) => (Math.round(v * 100) / 100).toString();

export function commandsToSvg(cmds) {
  let d = '';
  for (const c of cmds) {
    if (c[0] === 'M') d += `${d ? 'Z' : ''}M${f(c[1])} ${f(c[2])}`;
    else d += `Q${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])}`;
  }
  return d ? d + 'Z' : '';
}

/**
 * Same path as cubic Béziers (PDF has no quadratic operator). Calls
 * `move(x, y)`, `curve(c1x, c1y, c2x, c2y, x, y)` and `close()`.
 */
export function walkCubic(cmds, { move, curve, close }) {
  let cx = 0, cy = 0, open = false;
  for (const c of cmds) {
    if (c[0] === 'M') {
      if (open) close();
      move(c[1], c[2]);
      [cx, cy] = [c[1], c[2]];
      open = true;
    } else {
      const [, qx, qy, x, y] = c;
      curve(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy),
        x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      [cx, cy] = [x, y];
    }
  }
  if (open) close();
}

export function commandsBounds(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) {
    for (let i = 1; i < c.length; i += 2) {
      x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]);
      y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * Shift the strokes (and the baseline, if set) so the ink starts `pad` units
 * from the top-left, and set w/h to the inked area plus padding. Returns a new
 * signature object.
 */
export function trimSignature(sig, pad = 4) {
  const b = commandsBounds(signatureCommands(sig));
  if (!b) return null;
  const dx = pad - b.x0, dy = pad - b.y0;
  return {
    ...sig,
    strokes: sig.strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y, p]) => [x + dx, y + dy, p]) })),
    ...(sig.baseline != null && { baseline: sig.baseline + dy }),
    w: b.x1 - b.x0 + 2 * pad,
    h: b.y1 - b.y0 + 2 * pad
  };
}

/**
 * A stroke uses real pressure only when the device reported a range of it.
 * Mice report a constant 0.5 and many touchscreens a constant 1, which would
 * otherwise draw a uniform line with no ink character.
 */
export function finishStroke(pts, pointerType) {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
  const real = pointerType !== 'mouse' && hi - lo > 0.05;
  return { pts: real ? pts : pts.map(([x, y]) => [x, y, 0.5]), sim: !real };
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x17181c;
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
