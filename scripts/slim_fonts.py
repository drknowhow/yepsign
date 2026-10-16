"""Cut the bundled fonts down to Latin and fix variable fonts at Regular weight.

Usage: python scripts/slim_fonts.py FILE[=New Family] ...  (edits in place)

The PDF export embeds fonts whole because fontkit's subsetter drops glyphs from
some of them. Slimming here keeps those whole files small. Running it twice
gives the same file. A slimmed font is a modified version under the OFL, so a
font whose license reserves its name gets the new family name given after '='.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

LATIN = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x250))
    + list(range(0x2010, 0x2030)) + [0x20AC, 0x2122, 0x2116]
)


def rename(font: TTFont, family: str) -> None:
    ps = family.replace(" ", "") + "-Regular"
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID == 4:
            rec.string = f"{family} Regular"
        elif rec.nameID in (3, 6):
            rec.string = ps


def slim(path: Path, family: str | None = None) -> None:
    before = path.stat().st_size
    font = TTFont(path)
    if "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": 400})
    opts = subset.Options()
    # No contextual alternates, ligatures or kerning: pdf-lib places plain glyphs
    # and alternates copy out as the wrong letters, so the preview drops them too.
    opts.layout_features = []
    opts.hinting = False
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=LATIN)
    sub.subset(font)
    if family:
        rename(font, family)
    font.save(path)
    print(f"slimmed {path.name}: {before // 1024} KB -> {path.stat().st_size // 1024} KB" + (f", renamed {family}" if family else ""))


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        file, _, family = arg.partition("=")
        slim(Path(file), family or None)
