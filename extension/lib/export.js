import {
  PDFDocument, StandardFonts, EncryptedPDFError,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, setGraphicsState,
  setFillingRgbColor, moveTo, appendBezierCurve, closePath, fill,
  beginText, endText, setFontAndSize, showText
} from '../vendor/pdf-lib.esm.min.js';
import fontkit from '../vendor/fontkit.mjs';
import { signatureCommands, walkCubic, hexToRgb } from './ink.js';
import { toPdfMatrix, signatureLocal, textLocal } from './geometry.js';
import { fontById } from './fonts.js';

/** pdf-lib cannot write into an encrypted file; the caller flattens instead. */
export class ProtectedPdfError extends Error {}

/**
 * Draw the items into the original PDF and return the new file's bytes.
 * Text, links, forms and other content of the original stay as they were.
 *
 * `transforms[i]` is pdf.js's scale-1 viewport transform for page i; items
 * hold { kind: 'sig' | 'text', page, x, y, w, h, color, sig | text + size +
 * font + baseline }. `loadFont(file)` returns the bytes of a bundled font file.
 */
export async function stampPdf(bytes, transforms, items, { loadFont } = {}) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    // The minified build's thrown class is not always the exported one, so match the message too.
    if (err instanceof EncryptedPDFError || /is encrypted/i.test(err?.message || '')) throw new ProtectedPdfError(err.message);
    throw err;
  }
  await drawItems(doc, doc.getPages(), transforms, items, loadFont);
  return doc.save();
}

/**
 * Build a new PDF from page images (JPEG bytes sized to each page's scale-1
 * viewport) and draw the items on top. Used for protected PDFs.
 */
export async function buildFlattenedPdf(images, items, { loadFont } = {}) {
  const doc = await PDFDocument.create();
  const pages = [];
  const transforms = [];
  for (const img of images) {
    const page = doc.addPage([img.width, img.height]);
    const jpg = await doc.embedJpg(img.bytes);
    page.drawImage(jpg, { x: 0, y: 0, width: img.width, height: img.height });
    pages.push(page);
    transforms.push([1, 0, 0, -1, 0, img.height]);
  }
  await drawItems(doc, pages, transforms, items, loadFont);
  return doc.save();
}

async function embedFont(doc, id, loadFont) {
  const def = fontById(id);
  if (!def.file) return doc.embedFont(StandardFonts.Helvetica);
  if (!loadFont) throw new Error(`No font loader for ${def.label}`);
  doc.registerFontkit(fontkit);
  // Whole font, not subset: fontkit's subsetter drops glyphs from Kalam and
  // Caveat. scripts/slim_fonts.py already cut the files to Latin, so they stay small.
  return doc.embedFont(await loadFont(def.file), { subset: false });
}

async function drawItems(doc, pages, transforms, items, loadFont) {
  const fonts = new Map();
  const fontKeys = new Map();
  const inkState = new Map();
  for (const item of items) {
    const page = pages[item.page];
    const T = transforms[item.page];
    if (!page || !T) throw new Error(`Item placed on missing page ${item.page + 1}`);
    // Text in the user's handwriting carries its ink (item.sig) and draws like a signature.
    if (item.kind === 'sig' || item.sig) {
      if (!inkState.has(page)) {
        // Multiply lets printed lines show through the ink, as on paper.
        const gs = doc.context.obj({ Type: 'ExtGState', ca: 0.96, BM: 'Multiply' });
        inkState.set(page, page.node.newExtGState('YSInk', gs));
      }
      drawSignature(page, T, item, inkState.get(page));
    } else if (item.text && item.text.trim()) {
      const id = fontById(item.font).id;
      if (!fonts.has(id)) fonts.set(id, await embedFont(doc, id, loadFont));
      const font = fonts.get(id);
      const key = `${item.page}:${id}`;
      if (!fontKeys.has(key)) fontKeys.set(key, page.node.newFontDictionary(font.name, font.ref));
      drawText(page, T, item, font, fontKeys.get(key));
    }
  }
}

function drawSignature(page, T, item, gsKey) {
  const ops = [
    pushGraphicsState(),
    setGraphicsState(gsKey),
    concatTransformationMatrix(...toPdfMatrix(T, signatureLocal(item, item.sig))),
    setFillingRgbColor(...hexToRgb(item.color || item.sig.color))
  ];
  walkCubic(signatureCommands(item.sig), {
    move: (x, y) => ops.push(moveTo(x, y)),
    curve: (...a) => ops.push(appendBezierCurve(...a)),
    close: () => ops.push(closePath())
  });
  ops.push(fill(), popGraphicsState());
  page.pushOperators(...ops);
}

function drawText(page, T, item, font, key) {
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...toPdfMatrix(T, textLocal(item))),
    setFillingRgbColor(...hexToRgb(item.color)),
    beginText(),
    setFontAndSize(key, item.size),
    showText(font.encodeText(encodable(font, item.text))),
    endText(),
    popGraphicsState()
  );
}

/**
 * Characters the font has no glyph for become '?', so the save succeeds and
 * the gap is visible. Helvetica covers WinAnsi; the handwriting fonts cover Latin.
 */
export function encodable(font, text) {
  const has = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) out += has.has(ch.codePointAt(0)) ? ch : '?';
  return out;
}
