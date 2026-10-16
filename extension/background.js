import { putHandoff, sweepHandoffs } from './lib/handoff.js';
import { isPdf, fileNameFromUrl } from './lib/files.js';

const PDF_LINKS = ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.PDF', 'file:///*.pdf', 'file:///*.PDF'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sign-link',
    title: 'Sign this PDF with YepSign',
    contexts: ['link'],
    targetUrlPatterns: PDF_LINKS
  });
});

chrome.action.onClicked.addListener((tab) => openSigner(tab.url));

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'sign-link') openSigner(info.linkUrl);
});

const looksLikePdf = (url) => /\.pdf($|[?#])/i.test(new URL(url).pathname + new URL(url).search);

/**
 * Open the signer for `url`. While the click's activeTab grant lasts, the
 * worker can fetch the tab's PDF directly (with the user's cookies), so try
 * that first and hand the bytes over. If it fails, the signer gets the URL
 * and offers to request access or open the file by hand.
 */
async function openSigner(url) {
  sweepHandoffs().catch(() => {});
  if (!url || !/^(https?|file):/i.test(url)) return showSigner('');
  if (/^https?:/i.test(url)) {
    try {
      const bytes = await fetchPdf(url);
      if (bytes) {
        const token = crypto.randomUUID();
        await putHandoff(token, { bytes, url, name: fileNameFromUrl(url) });
        return showSigner(`token=${token}`);
      }
      if (!looksLikePdf(url)) return showSigner('');
    } catch (err) {
      console.info('YepSign: direct fetch failed, signer will ask for access', err);
      // Without access we can't tell an ordinary page from a PDF served at an
      // extensionless URL, so the signer offers it softly instead of insisting.
      if (!looksLikePdf(url)) return showSigner(`maybe=${encodeURIComponent(url)}`);
    }
  }
  return showSigner(`src=${encodeURIComponent(url)}`);
}

/**
 * Hand `query` to a YepSign tab that is already open (it opens the PDF as
 * another document tab), or open a new YepSign tab with it.
 */
async function showSigner(query) {
  try {
    const hit = await chrome.runtime.sendMessage({ type: 'yepsign-ping' });
    if (hit?.tabId != null) {
      if (query) await chrome.runtime.sendMessage({ type: 'yepsign-open', tabId: hit.tabId, query });
      await chrome.tabs.update(hit.tabId, { active: true });
      await chrome.windows.update(hit.windowId, { focused: true });
      return;
    }
  } catch (err) {
    // No YepSign tab is listening; open one below.
  }
  await chrome.tabs.create({ url: `signer.html${query ? `?${query}` : ''}` });
}

/** The PDF's bytes, or null when the URL is not a PDF. Throws on network/permission errors. */
async function fetchPdf(url) {
  if (!looksLikePdf(url)) {
    const head = await fetch(url, { method: 'HEAD', credentials: 'include' });
    if (!/pdf/i.test(head.headers.get('content-type') || '')) return null;
  }
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  return isPdf(bytes) ? bytes : null;
}
