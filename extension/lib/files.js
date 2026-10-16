/** True when the first KB holds a PDF header (servers often mislabel PDFs). */
export function isPdf(bytes) {
  const n = Math.min(1024, bytes.byteLength);
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, n));
  return head.includes('%PDF-');
}

export function fileNameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

/** "Lease.pdf" → "Lease-signed.pdf"; keeps the name readable and the extension. */
export function signedName(name) {
  const base = (name || 'document').replace(/\.pdf$/i, '').replace(/-signed$/i, '');
  return `${base}-signed.pdf`;
}
