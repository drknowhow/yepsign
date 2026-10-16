// Fonts for typed text. `src` is the file's path in github.com/google/fonts;
// scripts/vendor.mjs downloads each to vendor/fonts/<file>. `size` is the
// default size in points, set per font so each looks about as big as 11 pt Helvetica.
export const FONTS = [
  { id: 'helvetica', label: 'Print', family: 'Helvetica, Arial, sans-serif', size: 11 },
  { id: 'kalam', label: 'Neat hand', file: 'Kalam-Regular.ttf', src: 'ofl/kalam/Kalam-Regular.ttf', license: 'ofl/kalam/OFL.txt', size: 12 },
  { id: 'patrick', label: 'Casual hand', file: 'PatrickHand-Regular.ttf', src: 'ofl/patrickhand/PatrickHand-Regular.ttf', license: 'ofl/patrickhand/OFL.txt', size: 13 },
  { id: 'caveat', label: 'Quick note', file: 'Caveat.ttf', src: 'ofl/caveat/Caveat[wght].ttf', license: 'ofl/caveat/OFL.txt', size: 15 },
  { id: 'nothing', label: 'Scrawl', file: 'NothingYouCouldDo.ttf', src: 'ofl/nothingyoucoulddo/NothingYouCouldDo.ttf', license: 'ofl/nothingyoucoulddo/OFL.txt', size: 12 },
  // Its OFL reserves the name "Dancing Script", so the slimmed copy is renamed.
  { id: 'dancing', label: 'Cursive', file: 'DancingScript.ttf', src: 'ofl/dancingscript/DancingScript[wght].ttf', license: 'ofl/dancingscript/OFL.txt', size: 14, rename: 'YepSign Cursive' },
  { id: 'homemade', label: 'Loopy', file: 'HomemadeApple-Regular.ttf', src: 'apache/homemadeapple/HomemadeApple-Regular.ttf', license: 'apache/homemadeapple/LICENSE.txt', size: 10 }
];

export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

/** CSS family for a font: the bundled file's face, or the system stack for Print. */
export const cssFamily = (font) => font.family || `"YS ${font.label}"`;
