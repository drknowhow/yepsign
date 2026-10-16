// Affine matrices in PDF order [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.

export function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (!det) throw new Error('Page transform is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** m1 ∘ m2: apply m2 first, then m1. */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1
  ];
}

export function apply([a, b, c, d, e, f], x, y) {
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * Matrix from an item's local units to PDF user space.
 *
 * `viewTransform` is pdf.js's viewport.transform at scale 1 (PDF → screen, y
 * down, with page rotation, crop box offset and UserUnit folded in). Items are
 * stored in that screen space, so inverting it is exact for every page shape.
 * `local` maps the item's own units into screen space.
 */
export function toPdfMatrix(viewTransform, local) {
  return multiply(invert(viewTransform), local);
}

/** Signature: local units are the signature's drawing units, y down. */
export function signatureLocal(item, sig) {
  const k = item.w / sig.w;
  return [k, 0, 0, k, item.x, item.y];
}

// Baseline of a single line set at line-height 1.25 in Helvetica/Arial, as a
// fraction of the font size from the top of the box. The page measures each
// item's real baseline in the browser (item.baseline); this is the fallback.
export const TEXT_BASELINE = 0.97;
export const TEXT_LINE_HEIGHT = 1.25;

/** Text: local units are PDF text space (y up), one unit per screen unit. */
export function textLocal(item) {
  return [1, 0, 0, -1, item.x, item.y + item.size * (item.baseline ?? TEXT_BASELINE)];
}
