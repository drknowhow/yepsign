import test from 'node:test';
import assert from 'node:assert/strict';
import { documentFile, libraryFile, parseFile, looksLikeYepsign, mergeLibrary, toBase64, fromBase64 } from '../extension/lib/docformat.js';

const enc = (s) => new TextEncoder().encode(s);
const sig = { id: 's1', strokes: [{ sim: true, pts: [[0, 0, 0.5], [10, 4, 0.5]] }], w: 20, h: 10, pen: 'ballpoint', sizeScale: 1 };

test('base64 round-trips bytes of every value', () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test('a document file round-trips the PDF and its items', () => {
  const pdf = enc('%PDF-1.7 fake');
  const items = [
    { id: 'a', kind: 'sig', page: 0, x: 1, y: 2, w: 30, h: 10, sig },
    { id: 'b', kind: 'text', page: 1, x: 5, y: 6, size: 11, text: 'Pat Example', font: 'caveat' }
  ];
  const back = parseFile(enc(documentFile({ name: 'lease.pdf', pdf, items })));
  assert.equal(back.type, 'document');
  assert.equal(back.name, 'lease.pdf');
  assert.deepEqual(back.pdf, pdf);
  assert.deepEqual(back.items, items);
});

test('items that are malformed are dropped, not trusted', () => {
  const file = JSON.parse(documentFile({ name: 'x.pdf', pdf: enc('%PDF'), items: [] }));
  file.items = [{ kind: 'sig', page: 0, x: 0, y: 0 }, { kind: 'text', page: 'one', x: 0, y: 0, size: 3, text: 'x' }, { kind: 'text', page: 0, x: 0, y: 0, size: 3, text: 'ok' }];
  assert.deepEqual(parseFile(enc(JSON.stringify(file))).items.map((i) => i.text), ['ok']);
});

test('a library file round-trips signatures, snippets and fonts', () => {
  const lib = { signatures: [sig], snippets: [{ id: 'n1', text: 'Pat Example' }], handFonts: [{ id: 'h1', glyphs: { a: [] } }] };
  const back = parseFile(enc(libraryFile(lib)));
  assert.equal(back.type, 'library');
  assert.deepEqual(back.signatures, lib.signatures);
  assert.deepEqual(back.snippets, lib.snippets);
  assert.deepEqual(back.handFonts, lib.handFonts);
});

test('other files are refused with a message a person can act on', () => {
  assert.throws(() => parseFile(enc('not json')), /not a YepSign file/);
  assert.throws(() => parseFile(enc('{"format":"other"}')), /not a YepSign file/);
  assert.throws(() => parseFile(enc('{"format":"yepsign","version":99,"type":"document"}')), /newer version/);
});

test('YepSign files are told apart from PDFs by their first byte', () => {
  assert.equal(looksLikeYepsign(enc('  {"format":"yepsign"}')), true);
  assert.equal(looksLikeYepsign(enc('%PDF-1.7')), false);
});

test('merging a library adds only entries not already present', () => {
  const current = { signatures: [sig], snippets: [], handFonts: [] };
  const added = mergeLibrary(current, { signatures: [sig, { ...sig, id: 's2' }], snippets: [{ id: 'n1', text: 'x' }] });
  assert.deepEqual(added, { signatures: 1, snippets: 1, handFonts: 0 });
  assert.equal(current.signatures.length, 2);
});
