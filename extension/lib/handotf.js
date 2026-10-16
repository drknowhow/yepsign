import { Font, Glyph, Path } from '../vendor/opentype.module.js';
import { strokeOutline, outlineCommands } from './ink.js';
import { DEFAULT_STYLE, HAND_WEIGHT } from './handfont.js';

const UPM = 1000;

/**
 * An OpenType font file (CFF outlines) built from a handwriting font's first
 * variant of each letter, for use in other apps. Returns an ArrayBuffer.
 */
export function buildOtf(hand) {
  const st = { ...DEFAULT_STYLE, ...hand.style };
  const sizeScale = (hand.sizeScale * HAND_WEIGHT * UPM) / hand.emPx;
  const glyphs = [
    new Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(0.5 * UPM), path: new Path() }),
    new Glyph({ name: 'space', unicode: 32, advanceWidth: Math.round(st.wordSpacing * UPM), path: new Path() })
  ];
  for (const [ch, variants] of Object.entries(hand.glyphs)) {
    const g = variants?.[0];
    if (!g) continue;
    const shift = st.letterSpacing / 2 - g.x0;
    const path = new Path();
    for (const stroke of g.strokes) {
      const pts = stroke.pts.map(([x, y, p]) => [(x + shift) * UPM, -y * UPM, p]);
      const cmds = outlineCommands(strokeOutline({ sim: stroke.sim, pts }, hand.pen, sizeScale));
      for (const c of cmds) {
        if (c[0] === 'M') path.moveTo(c[1], c[2]);
        else path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      }
      if (cmds.length) path.close();
    }
    const cp = ch.codePointAt(0);
    glyphs.push(new Glyph({
      name: `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      unicode: cp,
      advanceWidth: Math.round((g.x1 - g.x0 + st.letterSpacing) * UPM),
      path
    }));
  }
  const family = hand.name || 'My handwriting';
  return new Font({
    familyName: family,
    styleName: 'Regular',
    unitsPerEm: UPM,
    ascender: 800,
    descender: -250,
    designer: 'Made with YepSign',
    glyphs
  }).toArrayBuffer();
}
