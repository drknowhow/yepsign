"""Render one page of a PDF with MuPDF and report where coloured ink landed.

Usage: python scripts/measure_ink.py file.pdf [page] [dpi]
Prints JSON: {"width": px, "height": px, "red": [x0, y0, x1, y1] | null, "green": ..., "text": str}
with boxes as fractions of the rendered page (rotation and crop box applied).
MuPDF is independent of pdf.js, so it checks the export rather than echoing it.
"""
import json
import sys

import fitz
import numpy as np


def box(mask, w, h):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return [xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h]


def main() -> None:
    path = sys.argv[1]
    index = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 144
    page = fitz.open(path)[index]
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    r, g, b = (img[:, :, i].astype(int) for i in range(3))
    red = (r > 170) & (g < 90) & (b < 90)
    green = (g > 110) & (r < 80) & (b < 80)
    print(json.dumps({
        "width": pix.width,
        "height": pix.height,
        "red": box(red, pix.width, pix.height),
        "green": box(green, pix.width, pix.height),
        "text": page.get_text(),
    }))


if __name__ == "__main__":
    main()
