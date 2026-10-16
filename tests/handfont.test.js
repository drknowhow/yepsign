import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '../extension/vendor/fontkit.mjs';
import { PDFDocument, rgb } from '../extension/vendor/pdf-lib.esm.min.js';
import { CELL, glyphFromCell, layoutHand, learnStyle, coverage, components, pickGlyph } from '../extension/lib/handfont.js';
import { buildOtf } from '../extension/lib/handotf.js';
import { stampPdf } from '../extension/lib/export.js';
import { signatureCommands, commandsBounds } from '../extension/lib/ink.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CASES, buildCase } from './fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'smoke-out', 'hand');
mkdirSync(out, { recursive: true });

// Synthetic letters: a zig-zag box whose height follows the letter's shape
// (x-height, ascender, descender, capital), drawn in capture-cell pixels.
function cellStrokes(ch) {
  const tall = /[bdfhklt]/.test(ch) || /[A-Z0-9]/.test(ch);
  const desc = /[gjpqy]/.test(ch);
  const top = tall ? -0.7 : -0.45;
  const bottom = desc ? 0.25 : 0;
  const w = /[A-Z]/.test(ch) ? 0.5 : 0.36;
  const px = ([x, y]) => [x * CELL.em, y * CELL.em + CELL.baseline, 0.5];
  return [{ sim: true, pts: [[0, bottom], [0, top], [w, top], [w * 0.5, (top + bottom) / 2], [w, bottom]].map(px) }];
}

function makeFont(chars, style = {}) {
  const glyphs = {};
  for (const ch of chars) glyphs[ch] = [glyphFromCell(cellStrokes(ch))];
  return { id: 'test', name: 'Test hand', pen: 'ballpoint', sizeScale: 1, emPx: CELL.em, glyphs, style };
}

const ALL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

test('glyphs come out in em units with the baseline at zero', () => {
  const g = glyphFromCell(cellStrokes('p'));
  assert.ok(Math.abs(g.y0 + 0.45) < 1e-9 && Math.abs(g.y1 - 0.25) < 1e-9);
  assert.equal(glyphFromCell([]), null);
});

test('layout is the same for the same seed and varies with another', () => {
  const font = makeFont(ALL);
  const a = layoutHand(font, 'Pat Example', 18, 7).sig;
  const b = layoutHand(font, 'Pat Example', 18, 7).sig;
  const c = layoutHand(font, 'Pat Example', 18, 8).sig;
  assert.deepEqual(a.strokes, b.strokes);
  assert.notDeepEqual(a.strokes, c.strokes);
  assert.ok(a.baseline > 0 && a.baseline < a.h);
});

test('missing letters are reported and the other case stands in when it exists', () => {
  const font = makeFont('abc');
  const { missing } = layoutHand(font, 'Cab x', 18, 1);
  assert.deepEqual(missing, ['x']);
  assert.equal(pickGlyph(font, 'C', () => 0).scale, 1.3);
  assert.deepEqual(coverage(font).sort(), ['A', 'B', 'C', 'a', 'b', 'c']);
});

test('wider letter spacing makes wider text', () => {
  const tight = layoutHand(makeFont(ALL, { letterSpacing: 0.02 }), 'handwriting', 18, 3).sig;
  const loose = layoutHand(makeFont(ALL, { letterSpacing: 0.3 }), 'handwriting', 18, 3).sig;
  assert.ok(loose.w > tight.w * 1.3, `${loose.w} vs ${tight.w}`);
});

test('an i and its dot merge into one component', () => {
  const comps = components([{ pts: [[10, 20], [10, 40]] }, { pts: [[10.5, 10], [10.5, 11]] }, { pts: [[30, 20], [34, 40]] }]);
  assert.equal(comps.length, 2);
});

test('spacing written in sentences is learned back', () => {
  const known = { letterSpacing: 0.18, wordSpacing: 0.55, sizeJitter: 0, baselineJitter: 0, rotateJitter: 0 };
  const writer = makeFont(ALL, known);
  const samples = ['The quick brown fox jumps over the lazy dog', 'Sphinx of black quartz judge my vow'].map((text, i) => ({
    text, strokes: layoutHand(writer, text, 40 + i * 6, 11).sig.strokes
  }));
  const { style, stats } = learnStyle(makeFont(ALL), samples);
  assert.equal(stats.measured, 16);
  assert.ok(Math.abs(style.letterSpacing - known.letterSpacing) < 0.03, `letterSpacing ${style.letterSpacing}`);
  assert.ok(Math.abs(style.wordSpacing - known.wordSpacing) < 0.06, `wordSpacing ${style.wordSpacing}`);
  assert.ok(style.sizeJitter < 0.12);
});

test('sentences that cannot be split into words leave the defaults', () => {
  const { style, stats } = learnStyle(makeFont(ALL), [{ text: 'two words', strokes: [{ pts: [[0, 0], [100, 10]] }] }]);
  assert.equal(stats.measured, 0);
  assert.equal(style.letterSpacing, 0.06);
});

test('handwritten text exports as ink where it was placed, on a rotated page', async () => {
  const bytes = await buildCase(CASES[1]);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), verbosity: 0 }).promise;
  const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
  await doc.loadingTask.destroy();
  const { sig } = layoutHand(makeFont(ALL), 'Pat Example', 24, 5);
  const item = { id: 'h', kind: 'text', font: 'hand:test', text: 'Pat Example', size: 24, seed: 5, sig, page: 0, x: vp.width * 0.2, y: vp.height * 0.4, w: sig.w, h: sig.h, color: '#e00000' };
  const file = join(out, 'hand-rot90.pdf');
  writeFileSync(file, await stampPdf(bytes, [vp.transform], [item]));
  const m = JSON.parse(execFileSync('python', [join(root, 'scripts', 'measure_ink.py'), file], { encoding: 'utf8' }));
  const ink = commandsBounds(signatureCommands(sig));
  const want = [(item.x + ink.x0) / vp.width, (item.y + ink.y0) / vp.height, (item.x + ink.x1) / vp.width, (item.y + ink.y1) / vp.height];
  m.red.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 0.012, `edge ${i}: got ${v} want ${want[i]}`));
});

test('the downloadable font parses, has the letters, and works in a PDF', async () => {
  const hand = makeFont('PatExml0123456789/');
  const otf = Buffer.from(buildOtf(hand));
  const parsed = fontkit.create(otf);
  assert.ok(parsed.hasGlyphForCodePoint('a'.codePointAt(0)));
  assert.ok(parsed.glyphForCodePoint('a'.codePointAt(0)).path.commands.length > 4);
  assert.ok(parsed.glyphForCodePoint('a'.codePointAt(0)).advanceWidth > 0);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(otf, { subset: false });
  doc.addPage([400, 200]).drawText('Pat Example 10/16/2026', { x: 20, y: 100, size: 24, font, color: rgb(0, 0.63, 0) });
  const file = join(out, 'otf-in-pdf.pdf');
  writeFileSync(file, await doc.save());
  const m = JSON.parse(execFileSync('python', [join(root, 'scripts', 'measure_ink.py'), file], { encoding: 'utf8' }));
  assert.ok(m.green, 'no ink rendered from the generated font');
  assert.ok(m.text.includes('Pat'), JSON.stringify(m.text));
});
