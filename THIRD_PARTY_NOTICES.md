# Third-party notices

YepSign bundles the following libraries and fonts in `extension/vendor/`. Each keeps its own license; the full license texts ship next to the files (`extension/vendor/LICENSE.*`, `extension/vendor/fonts/*-LICENSE.txt`, `extension/vendor/pdfjs/**/LICENSE*`).

## Libraries

| Library | Version | License | Copyright |
|---|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`, legacy build, with its cmaps, standard fonts and JBIG2/OpenJPEG/QCMS decoders) | 6.4.299 | Apache-2.0 | Mozilla Foundation and contributors |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | Andrew Dillon |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | Andrew Dillon, Devon Govett |
| [opentype.js](https://github.com/opentypejs/opentype.js) | 1.3.4 | MIT | Frederik De Bleser |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | 1.2.3 | MIT | Stephen Ruiz Ltd |

## Fonts

The fonts come from [google/fonts](https://github.com/google/fonts). `scripts/slim_fonts.py` reduces each to Latin characters and, for variable fonts, the Regular weight. Under the SIL Open Font License that makes them modified versions; Dancing Script reserves its name, so YepSign's copy is renamed **YepSign Cursive**.

| Font | Shown in YepSign as | License | Copyright |
|---|---|---|---|
| Kalam | Neat hand | SIL OFL 1.1 | Indian Type Foundry |
| Patrick Hand | Casual hand | SIL OFL 1.1 | Patrick Wagesreiter |
| Caveat | Quick note | SIL OFL 1.1 | The Caveat Project Authors |
| Nothing You Could Do | Scrawl | SIL OFL 1.1 | Kimberly Geswein |
| Dancing Script (renamed YepSign Cursive) | Cursive | SIL OFL 1.1, Reserved Font Name "Dancing Script" | The Dancing Script Project Authors |
| Homemade Apple | Loopy | Apache-2.0 | Font Diner, Inc. |

## Development only

The store screenshots use the public-domain Hershey script font, through the [Hershey-Fonts](https://pypi.org/project/Hershey-Fonts/) Python package. It is not part of the extension.
