import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb, concatTransformationMatrix } from '../extension/vendor/pdf-lib.esm.min.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Ink boxes and text of page 1 as MuPDF renders it (scripts/measure_ink.py); the JSON is its last line. */
export function measure(file) {
  const out = execFileSync('python', [join(root, 'scripts', 'measure_ink.py'), file], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

// Page shapes that move PDF user space away from the screen: rotation, crop
// boxes, a media box not at the origin, a content stream that leaves the CTM
// scaled, and UserUnit.
export const CASES = [
  { name: 'portrait', size: [612, 792] },
  { name: 'rot90', size: [612, 792], rotate: 90 },
  { name: 'rot180-a4', size: [595.28, 841.89], rotate: 180 },
  { name: 'rot270', size: [612, 792], rotate: 270 },
  { name: 'cropbox', size: [612, 792], crop: [50, 80, 512, 632] },
  { name: 'origin-offset', size: [612, 792], media: [-100, -100, 612, 792] },
  { name: 'rot90-cropbox', size: [612, 792], rotate: 90, crop: [40, 60, 540, 700] },
  { name: 'unbalanced-ctm', size: [612, 792], scaleCtm: 2 },
  { name: 'userunit', size: [306, 396], userUnit: 2 }
];

export async function buildCase(c) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(c.size);
  if (c.media) page.setMediaBox(...c.media);
  if (c.crop) page.setCropBox(...c.crop);
  if (c.rotate) page.setRotation(degrees(c.rotate));
  if (c.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(c.userUnit));
  const box = page.getCropBox();
  page.drawRectangle({ x: box.x + 10, y: box.y + 10, width: box.width - 20, height: box.height - 20, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 2 });
  page.drawText(`Fixture ${c.name}`, { x: box.x + 30, y: box.y + box.height - 50, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
  if (c.scaleCtm) page.pushOperators(concatTransformationMatrix(c.scaleCtm, 0, 0, c.scaleCtm, 0, 0));
  return doc.save();
}
