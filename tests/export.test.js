import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from '../extension/vendor/pdf-lib.esm.min.js';
import { stampPdf, buildFlattenedPdf, encodable } from '../extension/lib/export.js';
import { trimSignature, signatureCommands, commandsBounds } from '../extension/lib/ink.js';
import { TEXT_BASELINE } from '../extension/lib/geometry.js';
import { FONTS } from '../extension/lib/fonts.js';
import fontkit from '../extension/vendor/fontkit.mjs';
import { CASES, buildCase } from './fixtures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'smoke-out', 'geometry');
mkdirSync(out, { recursive: true });

const SIG = trimSignature({
  id: 'test', kind: 'signature', pen: 'ballpoint', sizeScale: 1, color: '#e00000',
  strokes: [{ sim: true, pts: [[10, 10], [60, 10], [110, 10], [110, 50], [60, 50], [10, 50], [10, 12]].map(([x, y]) => [x, y, 0.5]) }]
});
const INK = commandsBounds(signatureCommands(SIG));
const TOL = 0.012;

async function viewports(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const vps = [];
  for (let i = 1; i <= doc.numPages; i++) vps.push((await doc.getPage(i)).getViewport({ scale: 1 }));
  await doc.loadingTask.destroy();
  return vps;
}

function measure(file) {
  return JSON.parse(execFileSync('python', [join(root, 'scripts', 'measure_ink.py'), file], { encoding: 'utf8' }));
}

function items(vp) {
  const w = vp.width * 0.3;
  const sig = { id: 's', kind: 'sig', page: 0, x: vp.width * 0.55, y: vp.height * 0.7, w, h: (w * SIG.h) / SIG.w, sig: SIG, color: '#e00000' };
  const text = { id: 't', kind: 'text', page: 0, x: vp.width * 0.1, y: vp.height * 0.15, w: 0, h: 0, size: 18, text: 'Signed 10/16/2026', color: '#00a000' };
  return { sig, text };
}

function expectedSig(vp, sig) {
  const k = sig.w / SIG.w;
  return [(sig.x + INK.x0 * k) / vp.width, (sig.y + INK.y0 * k) / vp.height, (sig.x + INK.x1 * k) / vp.width, (sig.y + INK.y1 * k) / vp.height];
}

const near = (a, b) => Math.abs(a - b) <= TOL;

for (const c of CASES) {
  test(`ink and text land where they were placed: ${c.name}`, async () => {
    const bytes = await buildCase(c);
    const [vp] = await viewports(bytes);
    const { sig, text } = items(vp);
    const signed = await stampPdf(bytes, [vp.transform], [sig, text]);
    const file = join(out, `${c.name}.pdf`);
    writeFileSync(file, signed);

    const m = measure(file);
    assert.ok(m.red, 'signature ink not found');
    const want = expectedSig(vp, sig);
    m.red.forEach((v, i) => assert.ok(near(v, want[i]), `sig edge ${i}: got ${v.toFixed(4)} want ${want[i].toFixed(4)}`));

    assert.ok(m.green, 'text not found');
    const baseline = (text.y + text.size * TEXT_BASELINE) / vp.height;
    assert.ok(near(m.green[0], text.x / vp.width), `text left: got ${m.green[0]} want ${text.x / vp.width}`);
    assert.ok(m.green[1] < baseline && m.green[3] > baseline - 0.01, `text straddles baseline ${baseline}: ${m.green}`);
    assert.ok(m.green[2] - m.green[0] > m.green[3] - m.green[1], 'text runs left to right, not rotated');
  });
}

test('flattened copy keeps the page size and the ink position', async () => {
  const bytes = await buildCase(CASES[0]);
  const [vp] = await viewports(bytes);
  const { sig } = items(vp);
  // A 1x1 white JPEG stretched over the page stands in for the rendered page.
  const jpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64'));
  const flat = await buildFlattenedPdf([{ bytes: jpeg, width: vp.width, height: vp.height }], [sig]);
  const file = join(out, 'flattened.pdf');
  writeFileSync(file, flat);
  const doc = await PDFDocument.load(flat);
  assert.deepEqual(doc.getPage(0).getSize(), { width: vp.width, height: vp.height });
  const m = measure(file);
  const want = expectedSig(vp, sig);
  m.red.forEach((v, i) => assert.ok(near(v, want[i]), `edge ${i}: got ${v} want ${want[i]}`));
});

const loadFont = (file) => readFileSync(join(root, 'extension', 'vendor', 'fonts', file));

for (const font of FONTS) {
  test(`text in ${font.label} (${font.id}) embeds and reads back as typed`, async () => {
    const bytes = await buildCase(CASES[1]);
    const [vp] = await viewports(bytes);
    const typed = 'Pat Example 10/16/2026';
    const item = { id: 't', kind: 'text', page: 0, x: vp.width * 0.1, y: vp.height * 0.3, w: 0, h: 0, size: 20, text: typed, color: '#00a000', font: font.id, baseline: 0.9 };
    const file = join(out, `font-${font.id}.pdf`);
    writeFileSync(file, await stampPdf(bytes, [vp.transform], [item], { loadFont }));
    const m = measure(file);
    assert.ok(m.text.includes(typed), `extracted: ${JSON.stringify(m.text)}`);
    assert.ok(near(m.green[0], item.x / vp.width), `left edge ${m.green[0]}`);
    const baseline = (item.y + item.size * 0.9) / vp.height;
    assert.ok(m.green[1] < baseline && m.green[3] > baseline - 0.01, `straddles baseline: ${m.green}`);
  });
}

test('characters a handwriting font lacks become ?', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(loadFont('Caveat.ttf'));
  assert.equal(encodable(font, 'Zoë 東京'), 'Zoë ??');
});

test('text Helvetica cannot encode becomes ? instead of failing the save', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assert.equal(encodable(font, 'Zoë 東京'), 'Zoë ??');
});

test('pages without items keep their original content', async () => {
  const src = await PDFDocument.create();
  for (let i = 0; i < 2; i++) src.addPage([612, 792]).drawText(`page ${i + 1}`);
  const two = await src.save();
  const vps = await viewports(two);
  const { sig } = items(vps[1]);
  const before = (await PDFDocument.load(two)).getPage(0).node.Contents().toString();
  const signed = await PDFDocument.load(await stampPdf(two, vps.map((v) => v.transform), [{ ...sig, page: 1 }]));
  assert.equal(signed.getPageCount(), 2);
  assert.equal(signed.getPage(0).node.Contents().toString(), before);
  assert.notEqual(signed.getPage(1).node.Contents().toString(), (await PDFDocument.load(two)).getPage(1).node.Contents().toString());
});
