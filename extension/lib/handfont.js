import { trimSignature } from './ink.js';

// A handwriting font is the user's own letters, drawn once per character on
// guide lines, plus a spacing style learned from sample sentences. Text set in
// it is laid out as ink strokes (pen pressure and all), with small seeded
// variations so repeated letters don't look stamped.

/** Capture box in CSS px: em size and where the guide lines sit. */
export const CELL = { w: 72, h: 100, baseline: 70, em: 72 };
export const GUIDES = { ascender: 0.72, xHeight: 0.45, descender: 0.25 };

export const CHARSETS = [
  { id: 'lower', label: 'Lowercase', chars: 'abcdefghijklmnopqrstuvwxyz' },
  { id: 'upper', label: 'Capitals', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { id: 'marks', label: 'Numbers and marks', chars: '0123456789.,\'"-/:;?!&@()#$%' }
];

export const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'Sphinx of black quartz, judge my vow.'
];

/** In em units. Used where no sentences were written, and as the floor for learned values. */
export const DEFAULT_STYLE = { letterSpacing: 0.06, wordSpacing: 0.32, sizeJitter: 0.04, baselineJitter: 0.015, rotateJitter: 0.02 };

// Stroke width relative to letter size; 1 sets text exactly as heavy as it was drawn.
export const HAND_WEIGHT = 1;
// The letter boxes use a finer pen than the signature pad: letters there are
// small, and a signature-weight line makes them look like marker.
export const CELL_PEN = 0.75;
export const DEFAULT_HAND_SIZE = 18;

const DESCENDERS = /[gjpqy,;]/;

// Glyph metrics use the stroke centre lines, not the inked outline: sentence
// samples are measured the same way, so pen width doesn't bias what is learned.
function skeletonBounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * A glyph from strokes drawn in a capture cell (CSS px), in em units with the
 * baseline at y = 0 and y pointing down. Null when the cell is empty.
 */
export function glyphFromCell(strokes) {
  if (!strokes?.length) return null;
  const s = strokes.map((st) => ({ sim: st.sim, pts: st.pts.map(([x, y, p]) => [x / CELL.em, (y - CELL.baseline) / CELL.em, p]) }));
  const b = skeletonBounds(s);
  return b && { strokes: s, ...b };
}

/** Deterministic PRNG, so an item looks the same every time it is drawn. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jitter = (rnd) => rnd() * 2 - 1;

/** The glyph to draw for `ch`: its own, else the other case resized, else null. */
export function pickGlyph(font, ch, rnd = Math.random) {
  const from = (c) => {
    const list = font.glyphs[c];
    return list?.length ? list[Math.floor(rnd() * list.length)] : null;
  };
  let g = from(ch);
  if (g) return { glyph: g, scale: 1 };
  const lower = ch.toLowerCase();
  const upper = ch.toUpperCase();
  if (ch !== lower && (g = from(lower))) return { glyph: g, scale: 1.3 };
  if (ch !== upper && (g = from(upper))) return { glyph: g, scale: 0.75 };
  return null;
}

/**
 * Lay `text` out in the handwriting font at `size` points (1 em = size pt).
 * Returns { sig, missing }: sig is a signature-shaped object (strokes in pt,
 * trimmed, with `baseline`), or null for no ink; missing lists characters the
 * font has no glyph for (they leave a gap).
 */
export function layoutHand(font, text, size, seed = 1) {
  const rnd = mulberry32(seed);
  const st = { ...DEFAULT_STYLE, ...font.style };
  const strokes = [];
  const missing = new Set();
  let x = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      x += st.wordSpacing * (1 + jitter(rnd) * 0.15);
      continue;
    }
    const pick = pickGlyph(font, ch, rnd);
    if (!pick) {
      missing.add(ch);
      x += 0.35;
      continue;
    }
    const { glyph, scale } = pick;
    const s = scale * (1 + jitter(rnd) * st.sizeJitter);
    const dy = jitter(rnd) * st.baselineJitter;
    const a = jitter(rnd) * st.rotateJitter;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (const stroke of glyph.strokes) {
      strokes.push({
        sim: stroke.sim,
        pts: stroke.pts.map(([gx, gy, p]) => {
          const lx = (gx - glyph.x0) * s;
          const ly = gy * s;
          return [(x + lx * cos - ly * sin) * size, (dy + lx * sin + ly * cos) * size, p];
        })
      });
    }
    x += (glyph.x1 - glyph.x0) * s + st.letterSpacing * (1 + jitter(rnd) * 0.3);
  }
  if (!strokes.length) return { sig: null, missing: [...missing] };
  const raw = {
    id: `hand:${font.id}:${seed}:${size}:${text}`,
    kind: 'hand',
    pen: font.pen,
    sizeScale: (font.sizeScale * HAND_WEIGHT * size) / font.emPx,
    strokes,
    baseline: 0
  };
  return { sig: trimSignature(raw, size * 0.08), missing: [...missing] };
}

/* ---------- learning from sentences ---------- */

/** Stroke boxes merged where they overlap horizontally (an i and its dot, a t and its bar). */
export function components(strokes) {
  const boxes = strokes.filter((s) => s.pts.length).map((s) => skeletonBounds([s])).sort((a, b) => a.x0 - b.x0);
  const out = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    if (last && b.x0 <= last.x1 + 1) {
      last.x1 = Math.max(last.x1, b.x1);
      last.y0 = Math.min(last.y0, b.y0);
      last.y1 = Math.max(last.y1, b.y1);
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/** The ink width, height range and letter count a word would have in the font, in em, with no spacing. */
function expectedWord(font, word) {
  let width = 0, y0 = Infinity, y1 = -Infinity, n = 0;
  for (const ch of word) {
    const pick = pickGlyph(font, ch, () => 0);
    if (!pick) return null;
    const { glyph, scale } = pick;
    width += (glyph.x1 - glyph.x0) * scale;
    y0 = Math.min(y0, glyph.y0 * scale);
    y1 = Math.max(y1, glyph.y1 * scale);
    n++;
  }
  return n ? { width, y0, y1, n } : null;
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Learn spacing and variation from sentences the user wrote, knowing what they
 * were asked to write. Words are found as the largest horizontal gaps; each
 * word is compared with the same word built from the user's own letters.
 * Returns { style, stats: { words, measured } }; style falls back to
 * DEFAULT_STYLE where nothing could be measured.
 */
export function learnStyle(font, samples) {
  const scales = [], spacings = [], gaps = [], bases = [];
  let words = 0;
  for (const { text, strokes } of samples) {
    const targets = text.split(/\s+/).filter(Boolean);
    const comps = components(strokes || []);
    if (targets.length < 2 || comps.length < targets.length) continue;
    const cuts = comps.slice(1)
      .map((c, i) => ({ at: i + 1, gap: c.x0 - comps[i].x1 }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, targets.length - 1)
      .map((c) => c.at)
      .sort((a, b) => a - b);
    const boxes = [];
    let start = 0;
    for (const end of [...cuts, comps.length]) {
      const part = comps.slice(start, end);
      boxes.push({
        x0: Math.min(...part.map((c) => c.x0)), x1: Math.max(...part.map((c) => c.x1)),
        y0: Math.min(...part.map((c) => c.y0)), y1: Math.max(...part.map((c) => c.y1))
      });
      start = end;
    }
    words += targets.length;
    const local = [];
    boxes.forEach((box, i) => {
      const exp = expectedWord(font, targets[i]);
      if (!exp || exp.y1 - exp.y0 <= 0) return;
      const s = (box.y1 - box.y0) / (exp.y1 - exp.y0);
      if (!(s > 0)) return;
      scales.push(s);
      local.push(s);
      if (exp.n > 1) spacings.push(((box.x1 - box.x0) / s - exp.width) / (exp.n - 1));
      if (!DESCENDERS.test(targets[i])) bases.push({ x: (box.x0 + box.x1) / 2, y: box.y1 - exp.y1 * s });
    });
    if (local.length) {
      const sm = median(local);
      for (let i = 1; i < boxes.length; i++) gaps.push((boxes[i].x0 - boxes[i - 1].x1) / sm);
    }
  }
  const style = { ...DEFAULT_STYLE };
  if (scales.length) {
    const sMed = median(scales);
    const mean = scales.reduce((a, b) => a + b, 0) / scales.length;
    const sd = Math.sqrt(scales.reduce((a, b) => a + (b - mean) ** 2, 0) / scales.length);
    style.sizeJitter = clamp(sd / mean, 0.01, 0.12);
    if (spacings.length) style.letterSpacing = clamp(median(spacings), -0.05, 0.4);
    // Layout adds letter spacing after every letter, so a space only adds the rest of the gap.
    if (gaps.length) style.wordSpacing = clamp(median(gaps) - style.letterSpacing, 0.15, 1.2);
    if (bases.length >= 3) {
      const n = bases.length;
      const mx = bases.reduce((a, b) => a + b.x, 0) / n;
      const my = bases.reduce((a, b) => a + b.y, 0) / n;
      const sxx = bases.reduce((a, b) => a + (b.x - mx) ** 2, 0) || 1;
      const slope = bases.reduce((a, b) => a + (b.x - mx) * (b.y - my), 0) / sxx;
      const res = bases.map((b) => b.y - (my + slope * (b.x - mx)));
      const rsd = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n);
      style.baselineJitter = clamp(rsd / sMed, 0.005, 0.08);
    }
  }
  return { style, stats: { words, measured: scales.length } };
}

/** Characters the font can write (its own glyphs or the other case). */
export function coverage(font) {
  return CHARSETS.flatMap((c) => [...c.chars]).filter((ch) => pickGlyph(font, ch, () => 0));
}
