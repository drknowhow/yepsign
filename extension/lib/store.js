// The library lives in chrome.storage.local (this device only, never synced):
// saved signatures, text snippets and handwriting fonts. Outside the extension
// (tests, plain file server) localStorage stands in.
const local = globalThis.chrome?.storage?.local;

async function read(key) {
  try {
    if (local) return (await local.get(key))[key] || [];
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (err) {
    console.warn(`YepSign: could not read ${key}`, err);
    return [];
  }
}

async function write(key, list) {
  if (local) await local.set({ [key]: list });
  else localStorage.setItem(key, JSON.stringify(list));
}

export const loadSignatures = () => read('signatures');
export const saveSignatures = (list) => write('signatures', list);
export const loadSnippets = () => read('snippets');
export const saveSnippets = (list) => write('snippets', list);
export const loadHandFonts = () => read('handFonts');
export const saveHandFonts = (list) => write('handFonts', list);
