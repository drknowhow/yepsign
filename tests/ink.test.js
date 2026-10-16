import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outlineCommands, signatureCommands, commandsToSvg, walkCubic, commandsBounds,
  trimSignature, finishStroke, hexToRgb
} from '../extension/lib/ink.js';

const line = (x0, y0, x1, y1, n = 20) =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0.5]);

const sig = (strokes, extra = {}) => ({ pen: 'ballpoint', sizeScale: 1, color: '#1f3a93', strokes, ...extra });

test('mouse strokes always simulate pressure', () => {
  const s = finishStroke([[0, 0, 0.5], [5, 5, 0.9], [9, 9, 0.1]], 'mouse');
  assert.equal(s.sim, true);
  assert.ok(s.pts.every((p) => p[2] === 0.5));
});

test('pen strokes keep real pressure only when it varies', () => {
  assert.equal(finishStroke([[0, 0, 0.2], [5, 5, 0.7]], 'pen').sim, false);
  assert.equal(finishStroke([[0, 0, 1], [5, 5, 1]], 'touch').sim, true);
});

test('outline commands form one closed subpath per stroke', () => {
  const cmds = signatureCommands(sig([{ pts: line(0, 0, 100, 0), sim: true }, { pts: line(0, 20, 100, 40), sim: true }]));
  assert.equal(cmds.filter((c) => c[0] === 'M').length, 2);
  const d = commandsToSvg(cmds);
  assert.match(d, /^M/);
  assert.equal((d.match(/Z/g) || []).length, 2);
});

test('a single tap still leaves a dot', () => {
  const cmds = signatureCommands(sig([{ pts: [[10, 10, 0.5]], sim: true }]));
  const b = commandsBounds(cmds);
  assert.ok(b && b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1);
});

test('quadratic to cubic conversion lands on the same midpoint', () => {
  const quad = [['M', 0, 0], ['Q', 10, 20, 20, 0]];
  let mid;
  walkCubic(quad, {
    move: () => {},
    curve: (c1x, c1y, c2x, c2y, x, y) => {
      mid = [(0 + 3 * c1x + 3 * c2x + x) / 8, (0 + 3 * c1y + 3 * c2y + y) / 8];
    },
    close: () => {}
  });
  assert.deepEqual(mid.map((v) => +v.toFixed(6)), [10, 10]);
});

test('trimming puts the ink at the padding and sizes the box to it', () => {
  const t = trimSignature(sig([{ pts: line(200, 300, 300, 340), sim: true }]), 4);
  const b = commandsBounds(signatureCommands(t));
  assert.ok(Math.abs(b.x0 - 4) < 1e-6 && Math.abs(b.y0 - 4) < 1e-6);
  assert.ok(Math.abs(t.w - (b.x1 - b.x0 + 8)) < 1e-6);
  assert.ok(Math.abs(t.h - (b.y1 - b.y0 + 8)) < 1e-6);
});

test('trimming moves the signing baseline with the ink', () => {
  const t = trimSignature(sig([{ pts: line(200, 300, 300, 340), sim: true }], { baseline: 330 }), 4);
  const b = commandsBounds(signatureCommands(sig([{ pts: line(200, 300, 300, 340), sim: true }])));
  assert.ok(Math.abs(t.baseline - (330 - b.y0 + 4)) < 1e-6);
});

test('an empty drawing cannot be trimmed into a signature', () => {
  assert.equal(trimSignature(sig([])), null);
  assert.deepEqual(outlineCommands([[0, 0], [1, 1]]), []);
});

test('hex colours convert to PDF rgb and bad input falls back to ink black', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
  assert.equal(hexToRgb('nope').length, 3);
});
