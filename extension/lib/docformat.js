// The .yepsign file: JSON holding either a document in progress (the original
// PDF plus every placed item, still editable) or a library (saved signatures,
// text snippets and handwriting fonts). Items carry their ink, so a file opens
// the same on any machine.
export const FORMAT = 'yepsign';
export const VERSION = 1;
export const EXTENSION = '.yepsign';

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function documentFile({ name, pdf, items }) {
  return JSON.stringify({ format: FORMAT, version: VERSION, type: 'document', savedAt: new Date().toISOString(), name, pdf: toBase64(pdf), items });
}

export function libraryFile({ signatures = [], snippets = [], handFonts = [] }) {
  return JSON.stringify({ format: FORMAT, version: VERSION, type: 'library', savedAt: new Date().toISOString(), signatures, snippets, handFonts });
}

/** True when the bytes look like a .yepsign file rather than a PDF. */
export function looksLikeYepsign(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let i = 0;
  while (i < u8.length && i < 64 && (u8[i] === 0x20 || u8[i] === 0x0a || u8[i] === 0x0d || u8[i] === 0x09 || u8[i] === 0xef || u8[i] === 0xbb || u8[i] === 0xbf)) i++;
  return u8[i] === 0x7b;
}

/**
 * Parse and check a .yepsign file. Returns { type: 'document', name, pdf, items }
 * or { type: 'library', signatures, snippets, handFonts }; throws an Error with
 * a message fit to show the user.
 */
export function parseFile(bytes) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('This is not a YepSign file (it is not valid JSON).');
  }
  if (data?.format !== FORMAT) throw new Error('This is not a YepSign file.');
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new Error('This YepSign file was made by a newer version. Update YepSign to open it.');
  }
  if (data.type === 'document') {
    if (typeof data.pdf !== 'string' || !Array.isArray(data.items)) throw new Error('This YepSign document is incomplete.');
    return { type: 'document', name: String(data.name || 'document.pdf'), pdf: fromBase64(data.pdf), items: data.items.filter(validItem) };
  }
  if (data.type === 'library') {
    const list = (v) => (Array.isArray(v) ? v : []);
    return {
      type: 'library',
      signatures: list(data.signatures).filter((s) => s?.id && Array.isArray(s.strokes)),
      snippets: list(data.snippets).filter((s) => s?.id && typeof s.text === 'string'),
      handFonts: list(data.handFonts).filter((f) => f?.id && f.glyphs && typeof f.glyphs === 'object')
    };
  }
  throw new Error('This YepSign file holds something this version does not know.');
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

function validItem(i) {
  if (!i || !num(i.page) || !num(i.x) || !num(i.y)) return false;
  if (i.kind === 'sig') return !!i.sig && Array.isArray(i.sig.strokes) && num(i.w) && num(i.h);
  if (i.kind === 'text') return typeof i.text === 'string' && num(i.size);
  return false;
}

/** Add the library entries that aren't already present (matched by id). Returns counts added. */
export function mergeLibrary(current, incoming) {
  const added = {};
  for (const key of ['signatures', 'snippets', 'handFonts']) {
    const have = new Set((current[key] || []).map((x) => x.id));
    const fresh = (incoming[key] || []).filter((x) => !have.has(x.id));
    current[key] = [...(current[key] || []), ...fresh];
    added[key] = fresh.length;
  }
  return added;
}
