"""Draw the toolbar icon (a signature stroke over a baseline on an ink-blue tile)
at 512 px and downsample it to the sizes the manifest lists.

Usage: python scripts/make_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
INK = (31, 58, 147, 255)
PAPER = (251, 250, 247, 255)
S = 512


def squiggle():
    # A prolate cycloid: the loops read as joined-up handwriting.
    pts = []
    turns = 2.6 * 2 * math.pi
    for i in range(600):
        t = i / 599 * turns
        x = 30 * t - 46 * math.sin(t)
        y = -62 * math.cos(t) - 6 * t
        pts.append((x, y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sx = 300 / (max(xs) - min(xs))
    return [(106 + (x - min(xs)) * sx, 170 + (y - min(ys)) * sx) for x, y in pts]


def main() -> None:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((16, 16, S - 16, S - 16), radius=112, fill=INK)
    pts = squiggle()
    for i, (x, y) in enumerate(pts):
        w = 20 + 16 * math.sin(i / len(pts) * math.pi)
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=PAPER)
    d.rounded_rectangle((96, 360, 416, 380), radius=10, fill=(251, 250, 247, 170))
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48):
        img.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    # The Chrome Web Store wants the 128 px icon as 96 px of artwork with 16 px clear padding.
    big = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    big.paste(img.resize((96, 96), Image.LANCZOS), (16, 16))
    big.save(OUT / "icon128.png")
    img.save(OUT.parent.parent / "docs" / "img" / "icon.png")
    print("wrote", ", ".join(f"icon{s}.png" for s in (16, 32, 48, 128)))


if __name__ == "__main__":
    main()
