# Manual test checklist

Run through this before a release, in a real Chrome profile with a real mouse (and a pen tablet if you have one). It takes about 15 minutes. The sample PDFs are in `samples/`.

## 0. Load the build

1. `npm run vendor`, or unzip a release zip.
2. Open `chrome://extensions`, turn on **Developer mode** and click **Load unpacked**. Choose `extension/` (or the unzipped folder).
3. In YepSign's **Details**, turn on **Allow access to file URLs**.
4. Pin YepSign from the extensions menu so its button is visible.

After a code change, click the reload arrow on the YepSign card and reload the YepSign tab.

## 1. Draw a signature

1. Open a new tab, click the YepSign button, then **New signature**.
2. Sign with the mouse at a normal speed. Fast strokes should come out thinner. Try **Undo stroke**, **Clear**, each ink colour, each pen and the thickness slider.
3. With a pen tablet, sign again. The dialog should say "Pen pressure detected", and pressing harder should give a wider line.
4. **Use this signature**: it appears in the library. Add **New initials** the same way.

## 2. Sign the sample agreement

1. Drag `samples/rental-agreement.pdf` onto the YepSign tab.
2. Click the signature card, then the **Borrower signature** line. The signature should sit on the line.
3. Drag it, resize it with the round handle, recolour it from its toolbar, press Delete, then Ctrl+Z.
4. **Today's date** on the Date line; **Text** on another line, type a name, press Enter.
5. Put initials on page 2.
6. Select the typed name and try each **Text style**.
7. **Draw on the page**: sign directly on the **Lender signature** line, tick "Also save to my signatures", then **Done**.
8. **Save signed PDF**, open the file in Chrome's viewer and another PDF reader, and check the ink at 400% zoom.

## 3. Tabs, saved work and the library

1. Open `samples/rotated-page.pdf` as well. Switch tabs: each keeps its own items.
2. **Save work** on the agreement, close its tab, open the `.yepsign` file: everything comes back and can still be moved.
3. Select the typed name, choose **Save** in its toolbar, then place it again from **Saved text**.
4. **Export** the library and **Import** it again: nothing is duplicated.

## 4. Handwriting

1. **Teach YepSign my handwriting**: write the letters and numbers, both sentences, then **Save and use**.
2. Place a date and a name in the new handwriting. Note anything that gives it away as generated.
3. On the last step, **Download as a font file (.otf)** and check that it installs.

## 5. From Chrome's PDF viewer

1. Open `samples/rotated-page.pdf` in Chrome and click the YepSign button. It opens in YepSign, as a new tab if YepSign is already open.
2. Sign the rotated page and save: the signature is upright in the saved file.
3. On a PDF from a website, click the YepSign button. Note whether it opens directly or asks for access to the site.

## 6. Protected files

1. `samples/protected-printing-allowed.pdf`: sign and save. Expect a message that the copy is flattened.
2. `samples/protected-no-printing.pdf`: sign and save. Expect a refusal.
