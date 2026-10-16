import * as pdfjs from './vendor/pdf.min.mjs';
import { SignaturePad, capture, pressureOf, samplesOf } from './lib/pad.js';
import { INKS, PENS, signatureCommands, commandsToSvg, commandsBounds, trimSignature, finishStroke } from './lib/ink.js';
import { FONTS, fontById, cssFamily } from './lib/fonts.js';
import { stampPdf, buildFlattenedPdf, ProtectedPdfError } from './lib/export.js';
import { loadSignatures, saveSignatures, loadSnippets, saveSnippets, loadHandFonts, saveHandFonts } from './lib/store.js';
import { takeHandoff } from './lib/handoff.js';
import { isPdf, fileNameFromUrl, signedName } from './lib/files.js';
import { documentFile, libraryFile, parseFile, looksLikeYepsign, mergeLibrary, EXTENSION } from './lib/docformat.js';
import { layoutHand, DEFAULT_HAND_SIZE } from './lib/handfont.js';
import { createHandWizard } from './hand-wizard.js';
import { TEXT_LINE_HEIGHT, TEXT_BASELINE } from './lib/geometry.js';

const asset = (p) => new URL(p, import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = asset('vendor/pdf.worker.min.mjs');
const PDFJS_OPTIONS = {
  cMapUrl: asset('vendor/pdfjs/cmaps/'),
  cMapPacked: true,
  standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'),
  wasmUrl: asset('vendor/pdfjs/wasm/'),
  iccUrl: asset('vendor/pdfjs/iccs/'),
  isEvalSupported: false,
  enableXfa: false
};
// Browsers refuse canvases much past this many pixels; render less sharply instead of blank.
const MAX_CANVAS_PIXELS = 16_000_000;
const FLATTEN_DPI = 200;
const TEXT_COLOR = '#17181c';
const PLACEHOLDER = 'Type here';
// Text sits this far (points) above the line you click, as handwriting does.
const TEXT_GAP = 1.5;
// Pen sizes are tuned for the pad, where a signature is drawn about three times
// larger than it ends up. Ink drawn straight on the page uses this scale so a
// ballpoint is about 1.3 pt wide at any zoom.
const INK_ON_PAGE = 0.3;
const INK_PAD = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ext = globalThis.chrome;

const $ = (id) => document.getElementById(id);
const els = {
  viewer: $('viewer'), pages: null, empty: $('empty'), banner: $('banner'), docName: $('docName'),
  open: $('openBtn'), emptyOpen: $('emptyOpen'), file: $('fileInput'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'),
  undo: $('undoBtn'), save: $('saveBtn'), saveWork: $('saveWorkBtn'), tabBar: $('tabBar'),
  libExport: $('libExport'), libImport: $('libImport'), snippetList: $('snippetList'),
  teachHand: $('teachHand'), handDialog: $('handDialog'),
  sigList: $('sigList'), newSig: $('newSigBtn'), newInit: $('newInitBtn'),
  textTool: $('textTool'), dateTool: $('dateTool'), hint: $('hint'), toast: $('toast'),
  drawTool: $('drawTool'), fontList: $('fontList'),
  drawBar: $('drawBar'), drawSwatches: $('drawSwatches'), drawPen: $('drawPen'), drawUndo: $('drawUndo'),
  drawKeep: $('drawKeep'), drawCancel: $('drawCancel'), drawDone: $('drawDone'),
  pad: $('padDialog'), padForm: $('padForm'), padTitle: $('padTitle'), padCanvas: $('padCanvas'),
  padPlaceholder: $('padPlaceholder'), penInfo: $('penInfo'), swatches: $('swatches'),
  customColor: $('customColor'), penSelect: $('penSelect'), thickness: $('thickness'),
  padUndo: $('padUndo'), padClear: $('padClear'), padRemember: $('padRemember'),
  padCancel: $('padCancel'), padSave: $('padSave'), padBaseline: document.querySelector('.pad-wrap .baseline')
};

const state = {
  doc: null,
  bytes: null,
  name: '',
  pages: [],
  items: [],
  selected: null,
  editing: null,
  armed: null,
  scale: 1,
  fit: true,
  sigs: [],
  snippets: [],
  handFonts: [],
  history: [],
  dirty: false,
  ink: null
};

// Each open PDF is a tab. The active tab's fields live on `state` (the rest of
// this file reads them there); switching tabs stashes them and loads the next.
const DOC_FIELDS = ['doc', 'bytes', 'name', 'pages', 'items', 'history', 'dirty', 'scale', 'fit', 'permissions', 'selected'];
const tabs = [];
let activeTab = null;
const pageByEl = new WeakMap();

const pathCache = new Map();
function sigPath(sig) {
  if (!pathCache.has(sig.id)) pathCache.set(sig.id, commandsToSvg(signatureCommands(sig)));
  return pathCache.get(sig.id);
}

function sigSvg(sig, color) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sig.w} ${sig.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', sigPath(sig));
  path.setAttribute('fill', color || sig.color);
  svg.append(path);
  return svg;
}

/* ---------- messages ---------- */

let toastTimer = 0;
function toast(msg, { error = false, ms = 4000 } = {}) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', error);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

function banner(message, actions = []) {
  els.banner.replaceChildren();
  if (!message) { els.banner.hidden = true; return; }
  const p = document.createElement('p');
  p.textContent = message;
  els.banner.append(p);
  for (const [label, fn, primary] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${primary ? ' primary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', fn);
    els.banner.append(b);
  }
  els.banner.hidden = false;
}

function setHint() {
  let text;
  if (!state.doc) text = 'Open a PDF, then pick a signature and click where it goes.';
  else if (state.armed?.kind === 'sig') text = 'Click on the signing line. The signature sits on it the way you drew it on the pad. Esc cancels.';
  else if (state.armed?.kind === 'draw') text = 'Draw on the page with your mouse, pen or finger. Done (or Enter) turns it into a signature you can move and resize.';
  else if (state.armed) text = 'Click on the line where the text goes. Esc cancels.';
  else if (state.selected) text = 'Drag to move, drag the round handle to resize. Delete removes it.';
  else if (!state.sigs.length) text = 'Draw a signature to get started.';
  else text = 'Pick a signature, then click where it goes.';
  els.hint.textContent = text;
  els.hint.classList.toggle('active', !!state.armed);
}

/* ---------- opening documents ---------- */

/**
 * Open a PDF in a new tab. `items` restores placed items from a .yepsign file;
 * items on pages the PDF doesn't have are dropped.
 */
async function openPdf(input, name, { items = [] } = {}) {
  const bytes = new Uint8Array(input);
  if (!isPdf(bytes.buffer)) {
    toast('That file is not a PDF.', { error: true });
    return;
  }
  banner(null);

  // pdf.js takes ownership of the buffer it gets, so it receives a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_OPTIONS });
  task.onPassword = (update, reason) => {
    const wrong = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const pw = prompt(wrong ? 'That password did not work. Try again:' : 'This PDF is password protected. Enter its password:');
    if (pw === null) task.destroy();
    else update(pw);
  };
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException' || /destroy/i.test(err?.message || '')) return;
    console.error(err);
    toast(`Could not open this PDF: ${err?.message || err}`, { error: true, ms: 7000 });
    return;
  }

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ index: i - 1, page, width: vp.width, height: vp.height, transform: vp.transform });
  }
  const permissions = await doc.getPermissions().catch(() => null);

  leaveTab();
  const pagesEl = document.createElement('div');
  pagesEl.className = 'pages';
  els.viewer.append(pagesEl);
  const tab = { id: uid(), pagesEl };
  tabs.push(tab);
  activeTab = tab;
  els.pages = pagesEl;
  Object.assign(state, {
    doc, bytes, permissions, pages,
    name: name || 'document.pdf',
    items: items.filter((i) => i.page < pages.length),
    history: [], dirty: false, fit: true, selected: null
  });
  for (const t of tabs) t.pagesEl.hidden = t !== tab;
  buildPages();
  tabChanged();
}

/* ---------- tabs ---------- */

const tabDirty = (t) => (t === activeTab ? state.dirty : t.dirty);
const tabName = (t) => (t === activeTab ? state.name : t.name);

/** Finish anything in progress on the active tab and stash its fields on it. */
function leaveTab() {
  finishEditing();
  if (state.ink) commitInk();
  disarm();
  if (!activeTab) return;
  for (const f of DOC_FIELDS) activeTab[f] = state[f];
  activeTab.scrollTop = els.viewer.scrollTop;
}

function showTab(tab) {
  if (tab === activeTab) return;
  leaveTab();
  activate(tab);
}

/** Make `tab` (or no tab) active without stashing anything. */
function activate(tab) {
  activeTab = tab;
  for (const t of tabs) t.pagesEl.hidden = t !== tab;
  if (tab) {
    for (const f of DOC_FIELDS) state[f] = tab[f];
    els.pages = tab.pagesEl;
  } else {
    Object.assign(state, { doc: null, bytes: null, name: '', pages: [], items: [], history: [], dirty: false, selected: null, permissions: null });
    els.pages = null;
  }
  tabChanged();
}

/** Bring the page chrome in line with the active tab. */
function tabChanged() {
  const has = !!state.doc;
  els.empty.hidden = has;
  els.docName.textContent = has ? state.name : '';
  els.docName.title = has ? state.name : '';
  document.title = has ? `${state.name} · YepSign` : 'YepSign';
  for (const b of [els.zoomIn, els.zoomOut, els.zoomFit, els.save, els.saveWork]) b.disabled = !has;
  if (has) {
    if (state.fit) state.scale = fitScale();
    layoutPages();
    els.viewer.scrollTop = activeTab.scrollTop || 0;
  }
  updateUndo();
  renderTabs();
  setHint();
  renderFontList();
}

async function closeTab(tab) {
  if (tabDirty(tab) && !confirm(`Close ${tabName(tab)}? Changes you haven't saved will be lost.`)) return;
  const index = tabs.indexOf(tab);
  const wasActive = tab === activeTab;
  if (wasActive) {
    state.ink = null;
    leaveTab();
    activeTab = null;
  }
  for (const p of tab.pages || []) {
    p.task?.cancel();
    if (p.el) observer.unobserve(p.el);
  }
  await tab.doc?.loadingTask.destroy().catch(() => {});
  tab.pagesEl.remove();
  tabs.splice(index, 1);
  if (wasActive) activate(tabs[Math.min(index, tabs.length - 1)] || null);
  else renderTabs();
}

function renderTabs() {
  els.tabBar.replaceChildren();
  els.tabBar.hidden = !tabs.length;
  for (const t of tabs) {
    const name = tabName(t);
    const tabEl = document.createElement('div');
    tabEl.className = `tab${t === activeTab ? ' active' : ''}`;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', String(t === activeTab));
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tab-name';
    label.textContent = name;
    label.title = name;
    label.addEventListener('click', () => showTab(t));
    tabEl.append(label);
    if (tabDirty(t)) {
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.title = 'Not saved';
      tabEl.append(dot);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${name}`);
    close.addEventListener('click', () => closeTab(t));
    tabEl.append(close);
    els.tabBar.append(tabEl);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab-add';
  add.textContent = '+';
  add.title = 'Open another PDF';
  add.addEventListener('click', () => els.file.click());
  els.tabBar.append(add);
}

/** Open each file: PDFs as new tabs, .yepsign documents as tabs with their items, libraries merged. */
async function openFiles(files) {
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.yepsign$/i.test(file.name) || looksLikeYepsign(bytes)) await openYepsign(bytes);
    else if (isPdf(bytes.buffer)) await openPdf(bytes, file.name);
    else toast(`${file.name} is not a PDF or a YepSign file.`, { error: true });
  }
}

function readFileUrl(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => (xhr.response?.byteLength ? resolve(xhr.response) : reject(new Error('Empty response')));
    xhr.onerror = () => reject(new Error('Chrome did not let YepSign read the file'));
    xhr.send();
  });
}

async function fetchUrl(url) {
  if (/^file:/i.test(url)) return readFileUrl(url);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return res.arrayBuffer();
}

async function openFromUrl(url, { soft = false } = {}) {
  const host = /^file:/i.test(url) ? 'your computer' : new URL(url).host;

  if (/^file:/i.test(url) && ext?.extension?.isAllowedFileSchemeAccess && !(await ext.extension.isAllowedFileSchemeAccess())) {
    banner('Chrome keeps extensions away from files on your computer until you allow it. Open YepSign’s details, turn on “Allow access to file URLs”, then reload this tab. Or just drag the PDF here.', [
      ['Open YepSign details', () => ext.tabs.create({ url: `chrome://extensions/?id=${ext.runtime.id}` }), true]
    ]);
    return;
  }

  const attempt = async () => {
    const bytes = await fetchUrl(url);
    if (!isPdf(bytes)) {
      banner(soft ? 'That page is not a PDF. Drop a PDF here or use Open PDF.' : 'That link did not return a PDF.');
      return;
    }
    await openPdf(bytes, fileNameFromUrl(url));
  };

  try {
    if (!soft) return await attempt();
  } catch (err) {
    console.info('YepSign: direct read failed', err);
  }

  const origins = [`${new URL(url).origin}/*`];
  const ask = async () => {
    let granted = false;
    try {
      granted = await ext.permissions.request({ origins });
    } catch (err) {
      console.warn(err);
    }
    if (!granted) {
      banner('No access, so YepSign could not read it. You can download the PDF and drag it here instead.');
      return;
    }
    try {
      await attempt();
    } catch (err) {
      banner(`Could not read the PDF from ${host}: ${err.message}. Download it and drag it here instead.`);
    }
  };
  banner(soft
    ? `Was ${host} showing a PDF? YepSign can open it here if you allow it to read from ${host}.`
    : `YepSign needs your OK to read this PDF from ${host}. Chrome asks once per site.`,
  [[soft ? 'Open it here' : 'Allow and open', ask, true], ['Not now', () => banner(null)]]);
}

/* ---------- pages ---------- */

// Pages of hidden tabs report as not intersecting, so each entry is matched
// to its own page object rather than by index into the active tab.
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = pageByEl.get(e.target);
    if (!p) continue;
    p.visible = e.isIntersecting;
    if (p.visible && state.pages.includes(p)) renderPage(p);
  }
}, { root: els.viewer, rootMargin: '600px 0px' });

function fitScale() {
  const avail = els.viewer.clientWidth - 64;
  const widest = Math.max(...state.pages.map((p) => p.width));
  return clamp(avail / widest, 0.3, 2.5);
}

function buildPages() {
  els.pages.replaceChildren();
  state.scale = state.fit ? fitScale() : state.scale;
  for (const p of state.pages) {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.index = p.index;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.dataset.index = p.index;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${p.index + 1} / ${state.pages.length}`;
    el.append(overlay, num);
    els.pages.append(el);
    p.el = el;
    p.overlay = overlay;
    p.canvas = null;
    p.renderedScale = 0;
    pageByEl.set(el, p);
    bindOverlay(p);
    observer.observe(el);
  }
  layoutPages();
}

function layoutPages() {
  for (const p of state.pages) {
    p.el.style.width = `${p.width * state.scale}px`;
    p.el.style.height = `${p.height * state.scale}px`;
    if (p.visible) renderPage(p);
  }
  els.zoomFit.textContent = `${Math.round(state.scale * 100)}%`;
  renderItems();
}

async function renderPage(p) {
  const scale = state.scale;
  if (p.renderedScale === scale || p.renderingScale === scale) return;
  p.task?.cancel();
  p.renderingScale = scale;
  const dpr = window.devicePixelRatio || 1;
  let s = scale * dpr;
  const area = p.width * p.height * s * s;
  if (area > MAX_CANVAS_PIXELS) s *= Math.sqrt(MAX_CANVAS_PIXELS / area);
  const viewport = p.page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  p.task = p.page.render({ canvas, viewport });
  try {
    await p.task.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.error(err);
    return;
  } finally {
    if (p.renderingScale === scale) p.renderingScale = 0;
  }
  if (state.scale !== scale || !p.el) return;
  p.canvas?.remove();
  p.el.prepend(canvas);
  p.canvas = canvas;
  p.renderedScale = scale;
}

function setZoom(scale, fit = false) {
  if (!state.doc) return;
  const v = els.viewer;
  const ratio = v.scrollTop / Math.max(1, v.scrollHeight);
  state.fit = fit;
  state.scale = fit ? fitScale() : clamp(scale, 0.3, 4);
  layoutPages();
  v.scrollTop = ratio * v.scrollHeight;
}

/* ---------- items ---------- */

const uid = () => crypto.randomUUID();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pageOf = (item) => state.pages[item.page];

function snapshot() {
  return state.items.map((i) => ({ ...i }));
}

function remember(before) {
  state.history.push(before);
  if (state.history.length > 100) state.history.shift();
  const wasDirty = state.dirty;
  state.dirty = true;
  updateUndo();
  if (!wasDirty) renderTabs();
}

function updateUndo() {
  els.undo.disabled = !state.history.length;
}

function undo() {
  if (!state.history.length) return;
  finishEditing(true);
  state.items = state.history.pop();
  if (!state.items.some((i) => i.id === state.selected)) state.selected = null;
  state.dirty = true;
  updateUndo();
  renderItems();
}

function keepInPage(item) {
  const p = pageOf(item);
  item.x = clamp(item.x, 0, Math.max(0, p.width - item.w));
  item.y = clamp(item.y, 0, Math.max(0, p.height - item.h));
}

function renderItems() {
  for (const p of state.pages) p.overlay?.replaceChildren();
  for (const item of state.items) {
    const p = pageOf(item);
    if (!p?.overlay) continue;
    const el = itemEl(item);
    p.overlay.append(el);
    if (item.kind === 'text' && !isHand(item)) measureText(item, el);
  }
  if (state.ink) state.pages[state.ink.page]?.overlay.append(state.ink.svg);
  setHint();
  renderFontList();
}

function placeEl(el, item) {
  const s = state.scale;
  el.style.left = `${item.x * s}px`;
  el.style.top = `${item.y * s}px`;
  if (inkShown(item)) {
    el.style.width = `${item.w * s}px`;
    el.style.height = `${item.h * s}px`;
  } else {
    el.style.fontSize = `${item.size * s}px`;
  }
}

/* Text in the user's handwriting is drawn as ink, except while it is being edited. */
const isHand = (item) => item.kind === 'text' && typeof item.font === 'string' && item.font.startsWith('hand:');
const handFontOf = (id) => state.handFonts.find((f) => `hand:${f.id}` === id);
const inkShown = (item) => item.kind === 'sig' || (isHand(item) && item.sig && state.editing !== item.id);
const fontSize = (id) => (id?.startsWith('hand:') ? DEFAULT_HAND_SIZE : fontById(id).size);

/**
 * Lay a handwriting item out again after its text, size or font changed,
 * keeping its left edge and baseline where they were.
 */
function relayoutHand(item) {
  const font = handFontOf(item.font);
  if (!font) {
    // Opened from a file made elsewhere: the ink can't be rewritten here.
    delete item.sig;
    item.font = 'kalam';
    item.size = fontById('kalam').size;
    toast('That handwriting is not saved on this device, so the edited text uses Neat hand.', { ms: 6000 });
    return;
  }
  const { sig, missing } = layoutHand(font, item.text, item.size, item.seed);
  if (!sig) return;
  const baselineY = item.y + item.size * (item.baseline ?? TEXT_BASELINE);
  item.sig = sig;
  item.w = sig.w;
  item.h = sig.h;
  item.baseline = sig.baseline / item.size;
  item.y = baselineY - sig.baseline;
  if (missing.length) toast(`Your handwriting has no ${missing.join(' ')} yet, so those are left as gaps. Teach YepSign those letters to fill them.`, { ms: 7000 });
}

/**
 * Read the box and the baseline the browser laid out, so the PDF puts the
 * text exactly where the preview shows it in whatever font it uses.
 */
function measureText(item, el) {
  item.w = el.offsetWidth / state.scale;
  item.h = el.offsetHeight / state.scale;
  const marker = el.querySelector('.bl');
  if (marker) item.baseline = marker.offsetTop / (item.size * state.scale);
}

function itemEl(item) {
  const el = document.createElement('div');
  el.className = `item ${item.kind}`;
  el.dataset.id = item.id;
  if (inkShown(item)) {
    if (item.kind === 'text') el.classList.add('hand');
    el.append(sigSvg(item.sig, item.color));
  } else {
    const body = document.createElement('span');
    body.className = 'text-body';
    body.textContent = item.text;
    const marker = document.createElement('span');
    marker.className = 'bl';
    el.style.color = item.color;
    // While handwriting is being edited it shows in a stand-in hand.
    el.style.fontFamily = cssFamily(fontById(isHand(item) ? 'kalam' : item.font));
    el.append(body, marker);
  }
  placeEl(el, item);
  if (state.selected === item.id) {
    el.classList.add('selected');
    el.append(itemBar(item), handle());
  }
  el.addEventListener('pointerdown', (e) => onItemDown(e, item, el));
  return el;
}

function handle() {
  const h = document.createElement('button');
  h.type = 'button';
  h.className = 'handle';
  h.setAttribute('aria-label', 'Resize');
  return h;
}

function itemBar(item) {
  const bar = document.createElement('div');
  bar.className = 'item-bar';
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  const colors = item.kind === 'sig' ? INKS.slice(0, 2) : [{ name: 'Black', color: TEXT_COLOR }, INKS[0]];
  for (const ink of colors) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `dot${(item.color || '').toLowerCase() === ink.color ? ' on' : ''}`;
    dot.style.background = ink.color;
    dot.title = ink.name;
    dot.setAttribute('aria-label', ink.name);
    dot.addEventListener('click', () => {
      const before = snapshot();
      item.color = ink.color;
      remember(before);
      renderItems();
    });
    bar.append(dot);
  }
  if (item.kind === 'text') {
    bar.append(action('Edit', () => startEditing(item, bar.parentElement)));
    bar.append(action('Save', () => saveSnippet(item)));
  }
  bar.append(action('Delete', () => deleteItem(item.id), 'del'));
  return bar;
}

function action(label, fn, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `act ${cls}`;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function select(id) {
  if (state.selected === id) return;
  finishEditing();
  state.selected = id;
  renderItems();
}

function deleteItem(id) {
  const before = snapshot();
  state.items = state.items.filter((i) => i.id !== id);
  if (state.selected === id) state.selected = null;
  remember(before);
  renderItems();
}

let lastDown = { id: null, at: 0 };

function onItemDown(e, item, el) {
  if (state.editing === item.id) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const now = performance.now();
  const second = lastDown.id === item.id && now - lastDown.at < 450;
  lastDown = { id: item.id, at: now };
  if (second && item.kind === 'text') {
    startEditing(item, state.pages[item.page].overlay.querySelector(`[data-id="${item.id}"]`));
    return;
  }
  if (state.armed) disarm();
  const resizing = e.target.classList.contains('handle');
  if (state.selected !== item.id) {
    select(item.id);
    el = state.pages[item.page].overlay.querySelector(`[data-id="${item.id}"]`);
  }
  drag(e, item, el, resizing ? 'resize' : 'move');
}

function drag(e, item, el, mode) {
  const before = snapshot();
  const start = { x: e.clientX, y: e.clientY, item: { ...item } };
  const p = pageOf(item);
  let moved = false;
  capture(el, e.pointerId);

  const onMove = (ev) => {
    const dx = (ev.clientX - start.x) / state.scale;
    const dy = (ev.clientY - start.y) / state.scale;
    if (!moved && Math.hypot(dx, dy) * state.scale < 2) return;
    moved = true;
    if (mode === 'move') {
      item.x = start.item.x + dx;
      item.y = start.item.y + dy;
      keepInPage(item);
    } else {
      const maxW = p.width - start.item.x;
      const maxH = p.height - start.item.y;
      let ratio = (start.item.w + dx) / start.item.w;
      ratio = clamp(ratio, 16 / start.item.w, Math.min(maxW / start.item.w, maxH / start.item.h));
      item.w = start.item.w * ratio;
      item.h = start.item.h * ratio;
      if (item.kind === 'text') item.size = start.item.size * ratio;
    }
    placeEl(el, item);
  };
  const onUp = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    if (moved) {
      remember(before);
      if (item.kind === 'text' && !isHand(item)) measureText(item, el);
    }
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function startEditing(item, el, { before = null, isNew = false } = {}) {
  if (!el) return;
  finishEditing();
  state.selected = item.id;
  state.editing = item.id;
  state.editNew = isNew;
  state.editBefore = before || snapshot();
  if (isHand(item)) {
    // Swap the ink for editable text in a stand-in hand.
    renderItems();
    el = state.pages[item.page].overlay.querySelector(`[data-id="${item.id}"]`);
  }
  const body = el.querySelector('.text-body');
  body.contentEditable = 'plaintext-only';
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finishEditing(); }
    if (e.key === 'Escape') { e.preventDefault(); body.textContent = isNew ? '' : item.text; finishEditing(); }
  });
  body.addEventListener('blur', () => finishEditing(), { once: true });
}

/**
 * Commit the text being edited. A new box left empty (or still showing the
 * placeholder) disappears without an undo step; `silent` skips committing
 * because undo is about to replace the items anyway.
 */
function finishEditing(silent = false) {
  if (!state.editing) return;
  const id = state.editing;
  const isNew = state.editNew;
  state.editing = null;
  state.editNew = false;
  const item = state.items.find((i) => i.id === id);
  if (!item || silent) return;
  const el = document.querySelector(`.item[data-id="${id}"] .text-body`);
  const text = (el?.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text || (isNew && text === PLACEHOLDER)) {
    state.items = state.items.filter((i) => i.id !== id);
    if (state.selected === id) state.selected = null;
    if (!isNew) remember(state.editBefore);
  } else if (isNew || text !== item.text) {
    item.text = text;
    if (isHand(item)) relayoutHand(item);
    remember(state.editBefore);
  }
  renderItems();
}

/* ---------- placing ---------- */

function arm(armed) {
  if (armed && !state.doc) {
    toast('Open a PDF first, then click where this goes.');
    return;
  }
  finishEditing();
  if (state.armed?.kind === 'draw' && armed?.kind !== 'draw') commitInk();
  // One seed per placement, so the handwriting preview and the placed text match.
  if (armed && armed.seed == null) armed.seed = Math.floor(Math.random() * 2 ** 31);
  state.armed = armed;
  state.selected = null;
  for (const c of els.sigList.querySelectorAll('.sig-card')) c.classList.toggle('armed', armed?.kind === 'sig' && c.dataset.id === armed.sig.id);
  for (const c of els.snippetList.children) c.classList.toggle('armed', armed?.kind === 'snippet' && c.dataset.id === armed.snippet.id);
  els.textTool.classList.toggle('armed', armed?.kind === 'text');
  els.dateTool.classList.toggle('armed', armed?.kind === 'date');
  els.drawTool.classList.toggle('armed', armed?.kind === 'draw');
  els.drawBar.hidden = armed?.kind !== 'draw';
  els.drawUndo.disabled = !state.ink?.strokes.length;
  for (const p of state.pages) {
    p.overlay?.classList.toggle('armed', !!armed);
    p.overlay?.classList.toggle('drawing', armed?.kind === 'draw');
  }
  renderItems();
}

function disarm() {
  if (!state.armed) return;
  ghost?.remove();
  ghost = null;
  arm(null);
}

let ghost = null;

function defaultSigSize(sig, p) {
  // Ink drawn on a page keeps the size it was drawn at.
  if (sig.natural) {
    const k = Math.min(1, (p.width * 0.9) / sig.w, (p.height * 0.9) / sig.h);
    return { w: sig.w * k, h: sig.h * k };
  }
  let w = sig.kind === 'initials' ? 60 : Math.min(170, p.width * 0.4);
  let h = (w * sig.h) / sig.w;
  const maxH = sig.kind === 'initials' ? 30 : 70;
  if (h > maxH) { h = maxH; w = (h * sig.w) / sig.h; }
  return { w, h };
}

function newItem(armed, p, x, y) {
  if (armed.kind === 'sig') {
    const { w, h } = defaultSigSize(armed.sig, p);
    const sig = armed.sig;
    const top = sig.baseline != null ? y - clamp(sig.baseline, 0, sig.h) * (w / sig.w) : y - h / 2;
    return { id: uid(), kind: 'sig', page: p.index, x: x - w / 2, y: top, w, h, sig, color: sig.color };
  }
  if (armed.kind === 'snippet') {
    const s = armed.snippet;
    return textItem({ text: s.text, font: s.font, size: s.size, color: s.color, seed: s.seed, sig: s.sig }, p, x, y);
  }
  const text = armed.kind === 'date' ? new Date().toLocaleDateString() : PLACEHOLDER;
  const font = handFontOf(prefs.font) ? prefs.font : fontById(prefs.font).id;
  return textItem({ text, font, size: fontSize(font), color: textColor(font), seed: armed.seed }, p, x, y);
}

/**
 * A text item whose baseline sits TEXT_GAP above (x, y). Handwriting gets its
 * ink laid out now; `sig` stands in when that handwriting isn't on this device.
 */
function textItem({ text, font, size, color, seed, sig }, p, x, y) {
  const item = { id: uid(), kind: 'text', page: p.index, x, y: 0, w: text.length * size * 0.55, h: size * TEXT_LINE_HEIGHT, size, text, font, color, baseline: TEXT_BASELINE };
  if (isHand(item)) {
    item.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    const hand = handFontOf(font);
    const ink = hand ? layoutHand(hand, text, size, item.seed).sig : sig;
    if (ink) Object.assign(item, { sig: ink, w: ink.w, h: ink.h, baseline: ink.baseline / size });
  }
  // Until the browser measures a typed font's baseline, assume Helvetica's.
  item.y = y - size * item.baseline - TEXT_GAP;
  return item;
}

/** Handwriting starts in the pen's ink colour; Print starts black. */
const textColor = (id) => (id?.startsWith('hand:') || fontById(id).file ? prefs.color : TEXT_COLOR);

function pagePoint(p, e) {
  const r = p.overlay.getBoundingClientRect();
  return [(e.clientX - r.left) / state.scale, (e.clientY - r.top) / state.scale];
}

function bindOverlay(p) {
  const o = p.overlay;
  o.addEventListener('pointerdown', (e) => {
    if (state.armed?.kind === 'draw') { inkDown(p, e); return; }
    if (e.target !== o) return;
    if (!state.armed) {
      finishEditing();
      if (state.selected) { state.selected = null; renderItems(); }
      return;
    }
    e.preventDefault();
    const [x, y] = pagePoint(p, e);
    const armed = state.armed;
    const item = newItem(armed, p, x, y);
    keepInPage(item);
    const before = snapshot();
    state.items.push(item);
    disarm();
    state.selected = item.id;
    renderItems();
    if (item.kind === 'text') {
      // Now that the baseline is measured, sit the text on the clicked line.
      item.y = y - item.size * (item.baseline ?? TEXT_BASELINE) - TEXT_GAP;
      keepInPage(item);
      renderItems();
    }
    if (armed.kind === 'text') startEditing(item, o.querySelector(`[data-id="${item.id}"]`), { before, isNew: true });
    else remember(before);
  });
  o.addEventListener('pointerup', (e) => inkUp(e));
  o.addEventListener('pointercancel', (e) => inkUp(e));
  o.addEventListener('pointermove', (e) => {
    if (state.armed?.kind === 'draw') { inkMove(p, e); return; }
    if (!state.armed || e.pointerType !== 'mouse') return;
    const [x, y] = pagePoint(p, e);
    const item = newItem(state.armed, p, x, y);
    keepInPage(item);
    if (!ghost || ghost.parentElement !== o) {
      ghost?.remove();
      ghost = itemEl(item);
      ghost.classList.add('ghost');
      o.append(ghost);
    }
    placeEl(ghost, item);
  });
  o.addEventListener('pointerleave', () => { ghost?.remove(); ghost = null; });
}

/* ---------- drawing straight on the page ---------- */

// One drawing session collects strokes on one page; Done turns them into a
// signature item. Points are in page units, so the ink keeps its size at any zoom.
const inkSig = (strokes) => ({ pen: prefs.pen, sizeScale: prefs.sizeScale * INK_ON_PAGE, color: prefs.color, strokes });

function startInk(p) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('ink-live');
  svg.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.append(document.createElementNS(SVG_NS, 'path'));
  p.overlay.append(svg);
  state.ink = { page: p.index, strokes: [], current: null, svg };
}

let inkFrame = 0;
function drawInk() {
  inkFrame = 0;
  const ink = state.ink;
  if (!ink) return;
  const strokes = ink.current ? [...ink.strokes, finishStroke(ink.current.pts, ink.current.type)] : ink.strokes;
  const path = ink.svg.firstChild;
  path.setAttribute('d', commandsToSvg(signatureCommands(inkSig(strokes))));
  path.setAttribute('fill', prefs.color);
  els.drawUndo.disabled = !ink.strokes.length;
}
const scheduleInk = () => { inkFrame ||= requestAnimationFrame(drawInk); };

function inkPoint(p, e) {
  const [x, y] = pagePoint(p, e);
  return [x, y, pressureOf(e)];
}

function inkDown(p, e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  if (state.ink && state.ink.page !== p.index) commitInk();
  if (!state.ink) startInk(p);
  if (state.ink.current) return;
  capture(p.overlay, e.pointerId);
  state.ink.current = { id: e.pointerId, type: e.pointerType, pts: [inkPoint(p, e)] };
  scheduleInk();
}

function inkMove(p, e) {
  const cur = state.ink?.current;
  if (!cur || cur.id !== e.pointerId) return;
  for (const ev of samplesOf(e)) cur.pts.push(inkPoint(p, ev));
  scheduleInk();
}

function inkUp(e) {
  const ink = state.ink;
  if (!ink?.current || ink.current.id !== e.pointerId) return;
  ink.strokes.push(finishStroke(ink.current.pts, ink.current.type));
  ink.current = null;
  scheduleInk();
}

function undoInkStroke() {
  state.ink?.strokes.pop();
  scheduleInk();
}

/** End the session: its strokes become one movable signature item. Returns it, or null. */
function commitInk() {
  const ink = state.ink;
  if (!ink) return null;
  ink.svg.remove();
  state.ink = null;
  if (!ink.strokes.length) return null;
  const raw = { id: uid(), kind: 'ink', natural: true, created: Date.now(), ...inkSig(ink.strokes) };
  const b = commandsBounds(signatureCommands(raw));
  const sig = trimSignature(raw, INK_PAD);
  const item = { id: uid(), kind: 'sig', page: ink.page, x: b.x0 - INK_PAD, y: b.y0 - INK_PAD, w: sig.w, h: sig.h, sig, color: sig.color };
  const before = snapshot();
  state.items.push(item);
  remember(before);
  if (els.drawKeep.checked) {
    state.sigs.unshift({ ...sig, id: uid(), kind: 'signature' });
    persistSigs();
    renderSigList();
  }
  return item;
}

function finishDrawing() {
  const item = commitInk();
  disarm();
  if (item) {
    state.selected = item.id;
    renderItems();
  }
}

function cancelDrawing() {
  state.ink?.svg.remove();
  state.ink = null;
  disarm();
}

/* ---------- text style ---------- */

const selectedText = () => state.items.find((i) => i.id === state.selected && i.kind === 'text');

function fontChip(id, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'font-chip';
  b.dataset.font = id;
  b.title = `${label}: for new text, or the selected text`;
  b.addEventListener('click', () => chooseFont(id));
  return b;
}

function renderFontList() {
  const key = state.handFonts.map((f) => f.id).join(',');
  if (els.fontList.dataset.key !== key || !els.fontList.children.length) {
    els.fontList.dataset.key = key;
    els.fontList.replaceChildren();
    for (const f of FONTS) {
      const b = fontChip(f.id, f.label);
      b.style.fontFamily = cssFamily(f);
      b.textContent = f.label;
      els.fontList.append(b);
    }
    for (const f of state.handFonts) {
      const id = `hand:${f.id}`;
      const b = fontChip(id, f.name);
      b.classList.add('hand');
      const { sig } = layoutHand(f, f.name, 14, 1);
      if (sig) b.append(sigSvg(sig, '#1c1c20'));
      else b.textContent = f.name;
      const del = document.createElement('span');
      del.className = 'chip-del';
      del.textContent = '×';
      del.setAttribute('role', 'button');
      del.setAttribute('aria-label', `Remove ${f.name}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeHandFont(f);
      });
      b.append(del);
      els.fontList.append(b);
    }
  }
  const current = selectedText()?.font || prefs.font;
  for (const b of els.fontList.children) b.setAttribute('aria-pressed', String(b.dataset.font === current));
}

/** Set the style for new text and restyle the selected text, keeping its apparent size and baseline. */
function chooseFont(id) {
  const item = selectedText();
  if (item && item.font !== id) {
    const before = snapshot();
    const wasHand = isHand(item);
    const baselineY = item.y + item.size * (item.baseline ?? TEXT_BASELINE);
    if (item.color === textColor(item.font)) item.color = textColor(id);
    item.size = (item.size * fontSize(id)) / fontSize(item.font);
    item.font = id;
    if (isHand(item)) {
      item.seed ??= Math.floor(Math.random() * 2 ** 31);
      relayoutHand(item);
    } else if (wasHand) {
      delete item.sig;
      item.baseline = TEXT_BASELINE;
      item.y = baselineY - item.size * TEXT_BASELINE;
    }
    remember(before);
    renderItems();
  }
  prefs.font = id;
  writePrefs();
  renderFontList();
}

async function removeHandFont(font) {
  if (!confirm(`Remove "${font.name}" from this device? Text you already placed keeps its ink.`)) return;
  state.handFonts = state.handFonts.filter((f) => f.id !== font.id);
  if (prefs.font === `hand:${font.id}`) {
    prefs.font = 'helvetica';
    writePrefs();
  }
  await persistHandFonts();
  renderFontList();
}

/* ---------- library: saved text, handwriting, export and import ---------- */

function saveSnippet(item) {
  const { text, font, size, color, seed, sig, baseline } = item;
  state.snippets.unshift({ id: uid(), created: Date.now(), text, font, size, color, seed, sig, baseline });
  persistSnippets();
  renderSnippets();
  toast('Saved to your library. Click it there to place it again.');
}

function renderSnippets() {
  els.snippetList.replaceChildren();
  for (const s of state.snippets) {
    const card = document.createElement('div');
    card.className = `snippet${state.armed?.snippet?.id === s.id ? ' armed' : ''}`;
    card.dataset.id = s.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Place "${s.text}"`);
    card.title = s.text;
    if (s.sig && s.font?.startsWith('hand:')) {
      card.append(sigSvg(s.sig, s.color));
    } else {
      const span = document.createElement('span');
      span.textContent = s.text;
      span.style.fontFamily = cssFamily(fontById(s.font));
      span.style.color = s.color;
      span.style.fontSize = '15px';
      card.append(span);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'snippet-del';
    del.textContent = '×';
    del.setAttribute('aria-label', `Remove "${s.text}"`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.snippets = state.snippets.filter((x) => x.id !== s.id);
      if (state.armed?.snippet?.id === s.id) disarm();
      persistSnippets();
      renderSnippets();
    });
    card.append(del);
    const choose = () => (state.armed?.snippet?.id === s.id ? disarm() : arm({ kind: 'snippet', snippet: s }));
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    els.snippetList.append(card);
  }
}

const persistSnippets = () => saveSnippets(state.snippets).catch((err) => toast(`Could not save to the library: ${err.message}`, { error: true }));
const persistHandFonts = () => saveHandFonts(state.handFonts.filter((f) => !f.temp)).catch((err) => toast(`Could not save your handwriting: ${err.message}`, { error: true }));

async function exportLibrary() {
  const json = libraryFile({ signatures: state.sigs.filter((s) => !s.temp), snippets: state.snippets, handFonts: state.handFonts.filter((f) => !f.temp) });
  const saved = await deliver(new Blob([json], { type: 'application/json' }), `my-yepsign-library${EXTENSION}`, YEPSIGN_TYPE);
  if (saved) toast(`Saved your library as ${saved}. Import it on another computer, or keep it as a backup.`, { ms: 6000 });
}

async function importLibrary(lib) {
  const current = { signatures: state.sigs, snippets: state.snippets, handFonts: state.handFonts };
  const added = mergeLibrary(current, lib);
  state.sigs = current.signatures;
  state.snippets = current.snippets;
  state.handFonts = current.handFonts;
  await Promise.all([persistSigs(), persistSnippets(), persistHandFonts()]);
  renderSigList();
  renderSnippets();
  renderFontList();
  toast(`Added ${added.signatures} signatures, ${added.snippets} saved texts and ${added.handFonts} handwriting styles to your library.`, { ms: 6000 });
}

async function saveHandFont(font, remember) {
  if (!remember) font.temp = true;
  state.handFonts.push(font);
  await persistHandFonts();
  // New text only: restyling whatever happened to be selected would surprise.
  prefs.font = `hand:${font.id}`;
  writePrefs();
  renderFontList();
  toast(`"${font.name}" is ready. It is now the text style for new text.`, { ms: 5000 });
}

async function downloadOtf(font) {
  try {
    const { buildOtf } = await import('./lib/handotf.js');
    const name = `${(font.name || 'My handwriting').replace(/[\\/:*?"<>|]+/g, '').trim() || 'My handwriting'}.otf`;
    const saved = await deliver(new Blob([buildOtf(font)], { type: 'font/otf' }), name, OTF_TYPE);
    if (saved) toast(`Saved ${saved}. Install it to type in your handwriting in other apps.`, { ms: 6000 });
  } catch (err) {
    console.error(err);
    toast(`Could not build the font file: ${err.message}`, { error: true });
  }
}

/* ---------- .yepsign documents ---------- */

const workName = (name) => `${(name || 'document').replace(/\.pdf$/i, '')}${EXTENSION}`;

function workFile() {
  finishEditing();
  if (state.ink) commitInk();
  return documentFile({ name: state.name, pdf: state.bytes, items: state.items });
}

async function saveWork() {
  if (!state.doc) return;
  const saved = await deliver(new Blob([workFile()], { type: 'application/json' }), workName(state.name), YEPSIGN_TYPE);
  if (!saved) return;
  state.dirty = false;
  renderTabs();
  toast(`Saved ${saved}. Open it in YepSign to keep editing.`);
}

async function openYepsign(bytes) {
  let parsed;
  try {
    parsed = parseFile(bytes);
  } catch (err) {
    toast(err.message, { error: true, ms: 7000 });
    return;
  }
  if (parsed.type === 'library') {
    await importLibrary(parsed);
    return;
  }
  await openPdf(parsed.pdf, parsed.name, { items: parsed.items });
  if (state.doc) toast(`Reopened your work on ${parsed.name}. Everything placed can still be moved and edited.`, { ms: 5000 });
}

const fontFiles = new Map();
/** Bytes of a bundled font, fetched once; the PDF export embeds them. */
function loadFont(file) {
  if (!fontFiles.has(file)) {
    fontFiles.set(file, fetch(asset(`vendor/fonts/${file}`)).then((res) => {
      if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`);
      return res.arrayBuffer();
    }).then((buf) => new Uint8Array(buf)));
  }
  return fontFiles.get(file);
}

/** Register the bundled fonts with the page, so text measures right on first render. */
async function loadFaces() {
  const results = await Promise.allSettled(FONTS.filter((f) => f.file).map(async (f) => {
    const face = new FontFace(`YS ${f.label}`, `url("${asset(`vendor/fonts/${f.file}`)}")`);
    document.fonts.add(await face.load());
  }));
  for (const r of results) if (r.status === 'rejected') console.warn('YepSign: font failed to load', r.reason);
}

/* ---------- saved signatures ---------- */

function renderSigList() {
  els.sigList.replaceChildren();
  for (const sig of state.sigs) {
    const card = document.createElement('div');
    card.className = `sig-card${state.armed?.sig?.id === sig.id ? ' armed' : ''}`;
    card.dataset.id = sig.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Place ${sig.kind === 'initials' ? 'initials' : 'signature'}`);
    const label = document.createElement('span');
    label.className = 'sig-label';
    label.textContent = (sig.kind === 'initials' ? 'Initials' : 'Signature') + (sig.temp ? ' · this session' : '');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sig-del';
    del.textContent = 'Remove';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this saved signature from this device? Signatures already placed stay.')) return;
      state.sigs = state.sigs.filter((s) => s.id !== sig.id);
      if (state.armed?.sig?.id === sig.id) disarm();
      await persistSigs();
      renderSigList();
    });
    card.append(sigSvg(sig), label, del);
    const choose = () => (state.armed?.sig?.id === sig.id ? disarm() : arm({ kind: 'sig', sig }));
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    els.sigList.append(card);
  }
  setHint();
}

async function persistSigs() {
  try {
    await saveSignatures(state.sigs.filter((s) => !s.temp));
  } catch (err) {
    toast(`Could not save the signature on this device: ${err.message}`, { error: true });
  }
}

/* ---------- signature pad ---------- */

const prefs = readPrefs();
let padKind = 'signature';
const pad = new SignaturePad(els.padCanvas, {
  onChange: () => {
    els.padSave.disabled = pad.isEmpty;
    els.padPlaceholder.hidden = !pad.isEmpty;
  },
  onPen: (real) => {
    els.penInfo.textContent = real ? 'Pen pressure detected' : 'Pen detected, no pressure reported';
  }
});

function readPrefs() {
  const defaults = { color: INKS[0].color, pen: 'ballpoint', sizeScale: 1, font: 'helvetica' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('prefs') || '{}') };
  } catch {
    return defaults;
  }
}

function writePrefs() {
  try {
    localStorage.setItem('prefs', JSON.stringify(prefs));
  } catch {
    // Only a convenience: the next pad opens with default ink.
  }
}

/** Ink colour and pen controls, in the pad and in the drawing bar; both edit the same prefs. */
function buildInkControls() {
  for (const container of [els.swatches, els.drawSwatches]) {
    for (const ink of INKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = ink.color;
      b.title = ink.name;
      b.dataset.color = ink.color;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', ink.name);
      b.addEventListener('click', () => setInk({ color: ink.color }));
      container.append(b);
    }
  }
  els.customColor.addEventListener('input', () => setInk({ color: els.customColor.value }));
  for (const select of [els.penSelect, els.drawPen]) {
    for (const [key, pen] of Object.entries(PENS)) select.add(new Option(pen.label, key));
    select.addEventListener('change', () => setInk({ pen: select.value }));
  }
  els.thickness.addEventListener('input', () => setInk({ sizeScale: Number(els.thickness.value) }));
}

function setInk(change) {
  Object.assign(prefs, change);
  writePrefs();
  pad.setInk(prefs);
  for (const s of document.querySelectorAll('.swatch')) s.setAttribute('aria-checked', String(s.dataset.color === prefs.color));
  els.customColor.value = prefs.color;
  els.penSelect.value = prefs.pen;
  els.drawPen.value = prefs.pen;
  els.thickness.value = prefs.sizeScale;
  if (state.ink) scheduleInk();
}

function openPad(kind) {
  padKind = kind;
  els.padTitle.textContent = kind === 'initials' ? 'Draw your initials' : 'Draw your signature';
  els.penInfo.textContent = '';
  els.pad.showModal();
  pad.resize();
  pad.clear();
  setInk({});
}

els.padForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const line = els.padBaseline;
  const sig = pad.toSignature(padKind, line.offsetTop + line.offsetHeight);
  if (!sig) return;
  if (!els.padRemember.checked) sig.temp = true;
  state.sigs.unshift(sig);
  els.pad.close();
  await persistSigs();
  renderSigList();
  if (state.doc) arm({ kind: 'sig', sig });
});
els.padCancel.addEventListener('click', () => els.pad.close());
els.padUndo.addEventListener('click', () => pad.undo());
els.padClear.addEventListener('click', () => pad.clear());
let resizeTimer = 0;
window.addEventListener('resize', () => {
  if (els.pad.open) pad.resize();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.doc && state.fit) setZoom(0, true); }, 150);
});

/* ---------- saving ---------- */

function printAllowed() {
  const perms = state.permissions;
  if (!perms) return true;
  const has = (flag) => (perms.has ? perms.has(flag) : perms.includes(flag));
  return has(pdfjs.PermissionFlag.PRINT) || has(pdfjs.PermissionFlag.PRINT_HIGH_QUALITY);
}

async function flatten() {
  const images = [];
  for (const p of state.pages) {
    let s = FLATTEN_DPI / 72;
    const area = p.width * p.height * s * s;
    if (area > MAX_CANVAS_PIXELS) s *= Math.sqrt(MAX_CANVAS_PIXELS / area);
    const viewport = p.page.getViewport({ scale: s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: p.width, height: p.height });
    canvas.width = canvas.height = 0;
  }
  return buildFlattenedPdf(images, state.items, { loadFont });
}

/** The signed file's bytes and whether it had to be flattened. */
async function buildOutput() {
  finishEditing();
  if (state.ink) commitInk();
  try {
    return { bytes: await stampPdf(state.bytes, state.pages.map((p) => p.transform), state.items, { loadFont }), flattened: false };
  } catch (err) {
    if (!(err instanceof ProtectedPdfError)) throw err;
    if (!printAllowed()) {
      const e = new Error('This PDF is protected and its owner does not allow printing or changes, so YepSign cannot sign it.');
      e.userFacing = true;
      throw e;
    }
    return { bytes: await flatten(), flattened: true };
  }
}

const PDF_TYPE = { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } };
const YEPSIGN_TYPE = { description: 'YepSign file', accept: { 'application/json': [EXTENSION] } };
const OTF_TYPE = { description: 'Font file', accept: { 'font/otf': ['.otf'] } };

/** Save `blob` where the user picks (or to Downloads). Returns the file name, or null if cancelled. */
async function deliver(blob, name, type) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [type] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return handle.name;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn('YepSign: save picker failed, downloading instead', err);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return name;
}

async function save() {
  if (!state.doc || els.save.dataset.busy) return;
  if (!state.items.length && !confirm('Nothing has been placed on this PDF yet. Save an unchanged copy?')) return;
  els.save.dataset.busy = '1';
  els.save.textContent = 'Saving…';
  try {
    const { bytes, flattened } = await buildOutput();
    const saved = await deliver(new Blob([bytes], { type: 'application/pdf' }), signedName(state.name), PDF_TYPE);
    if (!saved) return;
    state.dirty = false;
    renderTabs();
    toast(flattened
      ? `Saved ${saved}. This PDF was protected, so each page was saved as an image at ${FLATTEN_DPI} dpi; its text can’t be selected.`
      : `Saved ${saved}.`, { ms: flattened ? 9000 : 4000 });
  } catch (err) {
    console.error(err);
    toast(err.userFacing ? err.message : `Could not save: ${err.message}`, { error: true, ms: 9000 });
  } finally {
    delete els.save.dataset.busy;
    els.save.textContent = 'Save signed PDF';
  }
}

/* ---------- wiring ---------- */

els.open.addEventListener('click', () => els.file.click());
els.emptyOpen.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  const files = [...els.file.files];
  els.file.value = '';
  openFiles(files);
});
els.saveWork.addEventListener('click', saveWork);
els.libExport.addEventListener('click', exportLibrary);
els.libImport.addEventListener('click', () => els.file.click());
const wizard = createHandWizard({ dialog: els.handDialog, getInk: () => ({ ...prefs }), onSave: saveHandFont, onDownload: downloadOtf });
els.teachHand.addEventListener('click', () => wizard.open());
els.zoomIn.addEventListener('click', () => setZoom(state.scale * 1.2));
els.zoomOut.addEventListener('click', () => setZoom(state.scale / 1.2));
els.zoomFit.addEventListener('click', () => setZoom(0, true));
els.undo.addEventListener('click', undo);
els.save.addEventListener('click', save);
els.newSig.addEventListener('click', () => openPad('signature'));
els.newInit.addEventListener('click', () => openPad('initials'));
els.textTool.addEventListener('click', () => (state.armed?.kind === 'text' ? disarm() : arm({ kind: 'text' })));
els.dateTool.addEventListener('click', () => (state.armed?.kind === 'date' ? disarm() : arm({ kind: 'date' })));
els.drawTool.addEventListener('click', () => (state.armed?.kind === 'draw' ? finishDrawing() : arm({ kind: 'draw' })));
els.drawDone.addEventListener('click', finishDrawing);
els.drawCancel.addEventListener('click', cancelDrawing);
els.drawUndo.addEventListener('click', undoInkStroke);

let dragDepth = 0;
els.viewer.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  els.viewer.classList.add('dragging');
});
els.viewer.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.viewer.classList.remove('dragging');
});
els.viewer.addEventListener('dragover', (e) => e.preventDefault());
els.viewer.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.viewer.classList.remove('dragging');
  openFiles([...e.dataTransfer.files]);
});

document.addEventListener('keydown', (e) => {
  if (els.pad.open || els.handDialog.open || state.editing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (state.armed?.kind === 'draw') {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finishDrawing(); return; }
    if (mod && e.key.toLowerCase() === 'z' && state.ink?.strokes.length) { e.preventDefault(); undoInkStroke(); return; }
  }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); els.file.click(); return; }
  if (e.key === 'Escape') { disarm(); if (state.selected) { state.selected = null; renderItems(); } return; }
  const item = state.items.find((i) => i.id === state.selected);
  if (!item || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(item.id); return; }
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) {
    e.preventDefault();
    const before = snapshot();
    item.x += d[0];
    item.y += d[1];
    keepInPage(item);
    remember(before);
    renderItems();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (tabs.some(tabDirty)) e.preventDefault();
});

// Lets the smoke test drive the page and read the output without a save dialog.
window.__yepsign = { state, tabs, openPdf, buildOutput, arm, workFile, wizard, showTab };

/** Open what a signer URL (or the toolbar button, via a message) asks for. */
async function openQuery(params) {
  try {
    if (params.get('token')) {
      const h = await takeHandoff(params.get('token'));
      if (h?.bytes) await openPdf(h.bytes, h.name);
      else banner('That PDF is no longer waiting here. Click the YepSign button on the PDF tab again, or drop the file here.');
    } else if (params.get('src')) {
      await openFromUrl(params.get('src'));
    } else if (params.get('maybe')) {
      await openFromUrl(params.get('maybe'), { soft: true });
    }
  } catch (err) {
    console.error(err);
    banner(`Could not open the PDF: ${err.message}. Drop the file here instead.`);
  }
}

// The toolbar button opens PDFs as tabs here when a YepSign tab is already
// open: it pings, the first YepSign tab answers with its id, and only that tab opens it.
let myTab = null;
ext?.tabs?.getCurrent?.((t) => { myTab = t || null; });
ext?.runtime?.onMessage?.addListener((msg, _sender, reply) => {
  if (msg?.type === 'yepsign-ping' && myTab) {
    reply({ tabId: myTab.id, windowId: myTab.windowId });
  } else if (msg?.type === 'yepsign-open' && myTab && msg.tabId === myTab.id) {
    openQuery(new URLSearchParams(msg.query || ''));
    reply({ ok: true });
  }
});

async function init() {
  buildInkControls();
  setInk({});
  await loadFaces();
  [state.sigs, state.snippets, state.handFonts] = await Promise.all([loadSignatures(), loadSnippets(), loadHandFonts()]);
  renderSigList();
  renderSnippets();
  renderFontList();
  renderTabs();
  await openQuery(new URLSearchParams(location.search));
  setHint();
}

init();
