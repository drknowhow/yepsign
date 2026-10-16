import { SignaturePad } from './lib/pad.js';
import { CELL, CELL_PEN, GUIDES, CHARSETS, SENTENCES, DEFAULT_STYLE, glyphFromCell, learnStyle, layoutHand, coverage } from './lib/handfont.js';
import { commandsToSvg, signatureCommands } from './lib/ink.js';

const STEPS = [
  ...CHARSETS.map((c) => ({ kind: 'cells', ...c })),
  { kind: 'sentences', label: 'Sentences' },
  { kind: 'review', label: 'Save' }
];
const ALL_CHARS = CHARSETS.flatMap((c) => [...c.chars]);

const INTRO = {
  cells: 'Write each character in its box, sitting on the solid line: small letters up to the lower dashed line, tall letters and capitals up to the top one. Skip any you never use; YepSign borrows the other case where it can.',
  sentences: 'Write these sentences the way you normally do. YepSign measures your letter spacing, the gaps between words and how much your size and baseline wander. You can skip this step.',
  review: 'This is your handwriting as YepSign will write it. Name it and save it.'
};

function inkSvg(sig, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${sig.w} ${sig.h}`);
  svg.setAttribute('width', sig.w);
  svg.setAttribute('height', sig.h);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', commandsToSvg(signatureCommands(sig)));
  path.setAttribute('fill', color);
  svg.append(path);
  return svg;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The "teach my handwriting" dialog. `getInk()` returns the current pen
 * ({ color, pen, sizeScale }); `onSave(font, remember)` receives the finished
 * font; `onDownload(font)` saves it as an .otf file.
 */
export function createHandWizard({ dialog, getInk, onSave, onDownload }) {
  const $ = (id) => dialog.querySelector(`#${id}`);
  const body = $('handBody');
  const intro = $('handIntro');
  const status = $('handStatus');
  const stepsEl = $('handSteps');
  const next = $('handNext');
  const back = $('handBack');
  let step = 0;
  let pads = new Map();
  let sentencePads = [];
  let stepEls = [];
  let built = null;
  let review = null;

  function drawnCount() {
    let n = 0;
    for (const p of pads.values()) if (!p.isEmpty) n++;
    return n;
  }

  function buildFont() {
    const ink = getInk();
    const glyphs = {};
    for (const [ch, pad] of pads) {
      const g = glyphFromCell(pad.strokes);
      if (g) glyphs[ch] = [g];
    }
    const font = {
      id: crypto.randomUUID(),
      name: review?.name.value.trim() || 'My handwriting',
      created: Date.now(),
      pen: ink.pen,
      sizeScale: ink.sizeScale * CELL_PEN,
      color: ink.color,
      emPx: CELL.em,
      glyphs,
      style: { ...DEFAULT_STYLE }
    };
    const samples = sentencePads.map((p, i) => ({ text: SENTENCES[i], strokes: p.strokes })).filter((s) => s.strokes.length);
    const { style, stats } = learnStyle(font, samples);
    font.style = style;
    return { font, stats, sampled: samples.length };
  }

  function cellsStep(set) {
    const wrap = el('div', 'cells');
    const guideY = {
      top: CELL.baseline - GUIDES.ascender * CELL.em,
      x: CELL.baseline - GUIDES.xHeight * CELL.em,
      base: CELL.baseline,
      desc: CELL.baseline + GUIDES.descender * CELL.em
    };
    for (const ch of set.chars) {
      const cell = el('div', 'cell');
      cell.dataset.char = ch;
      for (const [k, y] of Object.entries(guideY)) {
        const g = el('div', `guide ${k}`);
        g.style.top = `${y}px`;
        cell.append(g);
      }
      cell.append(el('span', 'char', ch));
      const canvas = el('canvas');
      canvas.setAttribute('aria-label', `Write ${ch}`);
      const clear = el('button', 'cell-clear', '×');
      clear.type = 'button';
      clear.setAttribute('aria-label', `Clear ${ch}`);
      cell.append(canvas, clear);
      wrap.append(cell);
      const pad = new SignaturePad(canvas, {
        onChange: () => {
          cell.classList.toggle('filled', !pad.isEmpty);
          updateStatus();
        }
      });
      clear.addEventListener('click', () => pad.clear());
      pads.set(ch, pad);
    }
    return wrap;
  }

  function sentencesStep() {
    const wrap = el('div');
    SENTENCES.forEach((text) => {
      const block = el('div', 'sentence');
      block.append(el('p', 'prompt', text));
      const line = el('div', 'line-pad');
      const canvas = el('canvas');
      canvas.setAttribute('aria-label', `Write: ${text}`);
      line.append(canvas, el('div', 'guide'));
      const clear = el('button', 'btn ghost clear-line', 'Clear');
      clear.type = 'button';
      block.append(line, clear);
      wrap.append(block);
      const pad = new SignaturePad(canvas, { onChange: updateStatus });
      clear.addEventListener('click', () => pad.clear());
      sentencePads.push(pad);
    });
    return wrap;
  }

  function meter(label, value, max, text) {
    const row = el('div', 'meter');
    row.title = text;
    row.append(el('span', null, label));
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = `${Math.max(3, Math.min(100, (value / max) * 100))}%`;
    track.append(fill);
    row.append(track);
    return row;
  }

  function reviewStep() {
    const wrap = el('div', 'review');
    const preview = el('div', 'preview');
    const facts = el('div', 'facts');
    const nameField = el('label', 'field', 'Name');
    const name = el('input');
    name.type = 'text';
    name.value = 'My handwriting';
    name.maxLength = 40;
    nameField.append(name);
    const cover = el('div');
    const learned = el('div');
    const remember = el('label', 'remember');
    const keep = el('input');
    keep.type = 'checkbox';
    keep.checked = true;
    remember.append(keep, document.createTextNode(' Remember on this device'));
    const download = el('button', 'btn', 'Download as a font file (.otf)');
    download.type = 'button';
    download.addEventListener('click', () => onDownload(buildFont().font));
    facts.append(nameField, cover, learned, remember, download);
    wrap.append(preview, facts);
    name.addEventListener('input', () => renderReview());
    review = { wrap, preview, cover, learned, name, keep };
    return wrap;
  }

  function renderReview() {
    built = buildFont();
    const { font, stats, sampled } = built;
    const color = getInk().color;
    review.preview.replaceChildren();
    for (const [text, size] of [['Pat Example', 30], [new Date().toLocaleDateString(), 22], ['The quick brown fox jumps over the lazy dog.', 18]]) {
      const { sig } = layoutHand(font, text, size, 7);
      if (sig) review.preview.append(inkSvg(sig, color));
    }
    if (!review.preview.children.length) review.preview.append(el('p', 'hand-intro', 'Nothing to show yet: go back and write some letters.'));

    const covered = coverage(font);
    const missing = ALL_CHARS.filter((c) => !covered.includes(c));
    review.cover.replaceChildren(el('div', null, `Covers ${covered.length} of ${ALL_CHARS.length} characters`));
    const bar = el('div', 'coverage-bar');
    const fill = el('div', 'fill');
    fill.style.width = `${(covered.length / ALL_CHARS.length) * 100}%`;
    bar.append(fill);
    review.cover.append(bar);
    if (missing.length) review.cover.append(el('div', 'hand-intro', `Missing: ${missing.join(' ')}`));

    const s = font.style;
    let learnedText;
    if (stats.measured) learnedText = `Learned from ${stats.measured} words in ${sampled} sentence${sampled === 1 ? '' : 's'}`;
    else if (sampled) learnedText = 'Your sentences could not be measured (they use letters you have not drawn yet, or the words ran together), so average spacing is used.';
    else learnedText = 'No sentences written, so average spacing is used.';
    review.learned.replaceChildren(el('div', null, learnedText));
    review.learned.append(
      meter('Letter spacing', s.letterSpacing + 0.05, 0.45, `${s.letterSpacing.toFixed(2)} em`),
      meter('Word gap', s.wordSpacing, 1.2, `${s.wordSpacing.toFixed(2)} em`),
      meter('Size wander', s.sizeJitter, 0.12, `${Math.round(s.sizeJitter * 100)}%`),
      meter('Baseline wander', s.baselineJitter, 0.08, `${Math.round(s.baselineJitter * 100)}%`)
    );
    next.disabled = Object.keys(font.glyphs).length < 3;
    status.textContent = next.disabled ? 'Write at least three letters to save.' : '';
  }

  function updateStatus() {
    const s = STEPS[step];
    if (s.kind === 'cells') {
      const done = [...s.chars].filter((c) => !pads.get(c)?.isEmpty).length;
      status.textContent = `${done} of ${s.chars.length} here · ${drawnCount()} of ${ALL_CHARS.length} in all`;
    } else if (s.kind === 'sentences') {
      const n = sentencePads.filter((p) => !p.isEmpty).length;
      status.textContent = n ? `${n} of ${SENTENCES.length} written` : 'Optional';
    }
  }

  function show(i) {
    step = i;
    const s = STEPS[i];
    if (!stepEls[i]) {
      stepEls[i] = s.kind === 'cells' ? cellsStep(s) : s.kind === 'sentences' ? sentencesStep() : reviewStep();
      body.append(stepEls[i]);
    }
    stepEls.forEach((node, j) => { if (node) node.hidden = j !== i; });
    [...stepsEl.children].forEach((li, j) => {
      li.classList.toggle('on', j === i);
      li.classList.toggle('done', j < i);
    });
    intro.textContent = INTRO[s.kind];
    back.hidden = i === 0;
    next.textContent = s.kind === 'review' ? 'Save and use' : s.kind === 'sentences' ? 'Next: review' : 'Next';
    next.disabled = false;
    const ink = getInk();
    const visible = s.kind === 'cells' ? [...s.chars].map((c) => pads.get(c)) : s.kind === 'sentences' ? sentencePads : [];
    const cellInk = { ...ink, sizeScale: ink.sizeScale * CELL_PEN };
    for (const pad of visible) {
      pad.resize();
      pad.setInk(s.kind === 'cells' ? cellInk : ink);
    }
    if (s.kind === 'review') renderReview();
    else updateStatus();
    body.scrollTop = 0;
  }

  function reset() {
    pads = new Map();
    sentencePads = [];
    stepEls = [];
    review = null;
    built = null;
    body.replaceChildren();
    stepsEl.replaceChildren(...STEPS.map((s) => el('li', null, s.label)));
  }

  const hasWork = () => drawnCount() > 0 || sentencePads.some((p) => !p.isEmpty);
  const close = () => {
    if (hasWork() && !confirm('Close without saving? The letters you wrote will be lost.')) return false;
    dialog.close();
    return true;
  };

  next.addEventListener('click', () => {
    if (STEPS[step].kind === 'review') {
      const { font } = buildFont();
      dialog.close();
      onSave(font, review.keep.checked);
      return;
    }
    show(step + 1);
  });
  back.addEventListener('click', () => show(Math.max(0, step - 1)));
  $('handCancel').addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  return {
    open() {
      reset();
      dialog.showModal();
      show(0);
    },
    /** Lets the smoke test reach the pads. */
    debug: () => ({ pads, sentencePads, step })
  };
}
