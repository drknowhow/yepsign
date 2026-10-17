# Chrome Web Store listing

Live at <https://chromewebstore.google.com/detail/yepsign-sign-pdfs-by-hand/jiooelcmkfbpfakhkpedincdmmeobdpp> (item ID `jiooelcmkfbpfakhkpedincdmmeobdpp`).

Text and answers to paste into the Chrome Web Store developer dashboard, and the steps to publish. Images are in this folder and in `docs/img/`.

## Store listing tab

**Name** (comes from `manifest.json`): YepSign: Sign PDFs by Hand

**Summary** (from `manifest.json`, 132 characters at most):
Sign PDFs in your own handwriting with a mouse, pen or finger. No printing or scanning, and your files stay on your computer.

**Category:** Productivity › Tools

**Language:** English

**Description:**

```
Sign a PDF without printing it, signing it and scanning it back in.

Draw your signature once with a mouse, a pen tablet or a finger. Click the line it belongs on. Save. The signed PDF is a normal PDF you can email or upload anywhere.

SIGNATURES THAT LOOK LIKE INK
A pen tablet's pressure, or the speed of your mouse, changes the line width the way a real pen does. Choose the ink colour, a ballpoint, fountain pen or felt marker, and the thickness. The ink is saved as vector paths, so it stays sharp at any zoom.

ON THE LINE, WHERE IT BELONGS
Your signature sits on the line you click the same way it sat on the line in the drawing pad. Or sign straight onto the page.

DATES, NAMES AND TEXT
Add today's date or any text in print, in one of six handwriting styles, or in your own handwriting.

YOUR OWN HANDWRITING
Write each letter once, then two sentences. YepSign writes typed text with your letters and with the spacing and unevenness it measured in your sentences, so repeated letters don't look stamped. You can also download your handwriting as a font file for other apps.

MORE THAN ONE DOCUMENT
Open several PDFs as tabs. Save unfinished work as a .yepsign file and keep editing it later. Keep signatures, initials and frequently used text in a library, and move it to another computer with export and import.

PRIVATE
No account, no server, no analytics. Your PDFs, signatures and handwriting stay on your computer. YepSign only goes online to fetch a PDF you asked it to open from a website.

Works with rotated and cropped pages. PDFs that are protected against changes but allow printing are saved as a flattened copy.

A drawn signature is not a cryptographic digital signature, and YepSign does not verify who signed. Check that the other party accepts electronic signatures for your document.

Free and open source: https://github.com/drknowhow/yepsign
```

**Graphic assets:**
- Store icon: `store/icon-128.png` (128×128, 16 px transparent padding).
- Screenshots, in this order (1280×800): `docs/img/1-sign-the-line.png`, `docs/img/2-draw-signature.png`, `docs/img/4-your-handwriting.png`, `docs/img/5-tabs-and-library.png`, `docs/img/3-teach-letters.png`.
- Small promo tile: `store/promo-small-440x280.png`.
- Marquee promo tile: `store/promo-marquee-1400x560.png`.

**Official URL / homepage:** https://drknowhow.github.io/yepsign/

**Support URL:** https://github.com/drknowhow/yepsign/issues

## Privacy practices tab

**Single purpose:**
YepSign lets you sign and fill in PDF documents with a handwritten signature and text, entirely in your browser.

**Permission justifications:**
- `storage`: Saves the user's signatures, initials, saved text and handwriting in local extension storage so they can be reused.
- `unlimitedStorage`: Handwriting styles and signatures are stored as pen strokes and can exceed the default local storage quota.
- `activeTab`: When the user clicks the toolbar button on a tab showing a PDF, YepSign reads that PDF so it can open it for signing.
- `contextMenus`: Adds "Sign this PDF with YepSign" to the right-click menu of links to PDF files.
- Optional host permissions (`<all_urls>`): Requested for one site at a time, only when the user asks YepSign to open a PDF hosted on that site and it could not be read through activeTab.

**Remote code:** No, I am not using remote code. All scripts, fonts and decoders are packaged in the extension.

**Data usage:** Check none of the data types; YepSign does not collect or transmit user data. Certify all three statements (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://drknowhow.github.io/yepsign/privacy.html

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch with a link only).
- Regions: All regions.
- Pricing: free.

## Publishing steps

1. Register a developer account at https://chrome.google.com/webstore/devconsole with the Google account that will own the listing, and pay the one-time registration fee (US$5 at the time of writing). The developer email can't be changed later.
2. In **Account**, set the publisher name and the contact email `yepgent@gmail.com`; Chrome sends a verification link to it, and it is shown on the listing. If the extension ever sells anything, a physical address is also required. The dashboard also asks whether you act as a trader under EU law; trader contact details are shown to users in the EU.
3. Build the package: `npm install && npm run vendor && npm test && npm run package`, which writes `dist/yepsign-<version>.zip`.
4. **New item** → upload the zip, then fill in the store listing, privacy practices and distribution tabs from this file.
5. **Submit for review.** Review usually takes from a day to a few weeks; the optional all-sites permission can make it longer.
6. For each update: raise `version` in `extension/manifest.json` and `package.json`, run `npm run package`, upload the new zip on the item's **Package** tab and submit again.

The same zip can also be submitted to Microsoft Edge Add-ons (free developer account) without changes.
