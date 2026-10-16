"""Load the unpacked extension into a throwaway Chromium profile and sign the
sample PDFs the way a person would: draw with the mouse, draw with a (synthetic)
pressure pen, place, move, resize, undo, then export and render the result.

Usage: python scripts/smoke.py [output_dir]
Never touches a real Chrome profile. Run scripts/make_samples.py first.
"""
import base64
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

import fitz
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
SAMPLES = ROOT / "samples"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "smoke-out"
errors: list[str] = []
# Each open PDF is a tab; only the active tab's pages are shown.
ACTIVE = ".pages:not([hidden])"


def cursive(x0, y0, width, height):
    """A made-up handwritten name: looped letters, uneven spacing, a tail."""
    pts = []
    turns = 4.3 * 2 * math.pi
    for i in range(260):
        t = i / 259 * turns
        speed = 1 + 0.8 * math.sin(i / 17)
        x = 30 * t - 44 * math.sin(t)
        y = -55 * math.cos(t) * (0.8 + 0.2 * math.sin(t / 3)) - 4 * t
        pts.append((x, y, speed))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sx = width / (max(xs) - min(xs))
    sy = height / (max(ys) - min(ys))
    s = min(sx, sy)
    return [(x0 + (x - min(xs)) * s, y0 + (y - min(ys)) * s) for x, y, _ in pts]


def draw_mouse(page, canvas):
    box = canvas.bounding_box()
    pts = cursive(box["x"] + 60, box["y"] + 50, box["width"] - 160, box["height"] - 110)
    page.mouse.move(*pts[0])
    page.mouse.down()
    for i, p in enumerate(pts[1:], 1):
        page.mouse.move(*p, steps=1 + (i % 3))
    page.mouse.up()
    # A second stroke: the underline flourish.
    y = box["y"] + box["height"] - 50
    page.mouse.move(box["x"] + 80, y)
    page.mouse.down()
    for k in range(1, 30):
        page.mouse.move(box["x"] + 80 + k * 15, y - 6 * math.sin(k / 5), steps=2)
    page.mouse.up()


PEN_JS = """([pts]) => {
  const c = document.getElementById('padCanvas');
  const r = c.getBoundingClientRect();
  const fire = (type, [x, y, p]) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: 41, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
    button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : p, clientX: r.left + x, clientY: r.top + y }));
  fire('pointerdown', pts[0]);
  for (const p of pts.slice(1)) fire('pointermove', p);
  fire('pointerup', pts[pts.length - 1]);
}"""


def draw_pen_initials(page):
    strokes = []
    # "P": stem then bowl, with pressure rising and falling.
    stem = [(150, 60 + i * 4, 0.2 + 0.7 * math.sin(i / 30 * math.pi)) for i in range(31)]
    bowl = [(150 + 60 * math.sin(a), 95 - 35 * math.cos(a), 0.3 + 0.6 * math.sin(a)) for a in [i / 30 * math.pi for i in range(31)]]
    # "E" as one looped stroke.
    e = [(260 + 40 * math.cos(a) - a * 4, 120 + 30 * math.sin(a), 0.25 + 0.65 * abs(math.sin(a))) for a in [i / 40 * 2.4 * math.pi for i in range(41)]]
    for s in (stem, bowl, e):
        strokes.append([list(p) for p in s])
    for s in strokes:
        page.evaluate(PEN_JS, [s])


def page_point(page, index, x, y):
    """Screen point for PDF coordinates measured from the page's top-left (fitz style)."""
    el = page.locator(f"{ACTIVE} .page").nth(index)
    w = page.evaluate("(i) => window.__yepsign.state.pages[i].width", index)
    box = el.bounding_box()
    s = box["width"] / w
    sy = box["y"] + y * s
    height = page.viewport_size["height"]
    if not 140 < sy < height - 60:
        # Scroll the viewer so the point is on screen; clicks off screen go nowhere.
        page.evaluate("(dy) => document.getElementById('viewer').scrollBy(0, dy)", sy - height / 2)
        box = el.bounding_box()
    return box["x"] + x * s, box["y"] + y * s


def export(page, name):
    data = page.evaluate("""async () => {
      const { bytes, flattened } = await window.__yepsign.buildOutput();
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), flattened };
    }""")
    path = OUT / f"{name}.pdf"
    path.write_bytes(base64.b64decode(data["b64"]))
    doc = fitz.open(path)
    doc[0].get_pixmap(dpi=110).save(OUT / f"{name}.png")
    return path, data["flattened"], doc


def draw_letter(page, ch):
    canvas = page.locator(f'.cell[data-char="{ch}"] canvas')
    canvas.scroll_into_view_if_needed()
    b = canvas.bounding_box()
    tall = ch.isupper() or ch.isdigit() or ch in "bdfhklt"
    top = -0.7 if tall else -0.45
    bottom = 0.25 if ch in "gjpqy" else 0
    pts = [(0, 0), (0.3, -0.7)] if ch == "/" else [(0, bottom), (0, top), (0.4, top), (0.2, (top + bottom) / 2), (0.4, bottom)]
    to = lambda x, y: (b["x"] + 12 + x * 72, b["y"] + 70 + y * 72)
    page.mouse.move(*to(*pts[0]))
    page.mouse.down()
    for p in pts[1:]:
        page.mouse.move(*to(*p), steps=4)
    page.mouse.up()


def teach_handwriting(page):
    """Write the letters of 'Pat Example' and today's date, one sentence, then save the hand."""
    page.click("#teachHand")
    expect(page.locator("#handDialog")).to_be_visible()
    for ch in "atxmple":
        draw_letter(page, ch)
    expect(page.locator(".cell.filled")).to_have_count(7)
    page.screenshot(path=OUT / "6a-hand-letters.png")
    page.click("#handNext")
    for ch in "PE":
        draw_letter(page, ch)
    page.click("#handNext")
    for ch in "0123456789/":
        draw_letter(page, ch)
    page.click("#handNext")
    line = page.locator(".line-pad canvas").first
    b = line.bounding_box()
    x = b["x"] + 20
    for word in "The quick brown fox jumps over the lazy dog.".split():
        w = 11 * len(word)
        page.mouse.move(x, b["y"] + 100)
        page.mouse.down()
        for k in range(1, 2 * len(word) + 1):
            page.mouse.move(x + k * w / (2 * len(word)), b["y"] + (70 if k % 2 else 104), steps=2)
        page.mouse.up()
        x += w + 22
    page.click("#handNext")
    expect(page.locator(".review")).to_be_visible()
    page.locator(".review input[type=text]").fill("Pat's hand")
    page.screenshot(path=OUT / "6b-hand-review.png")
    page.click("#handNext")
    expect(page.locator("#handDialog")).to_be_hidden()
    chip = page.locator(".font-chip.hand")
    expect(chip).to_have_count(1)
    # With nothing selected the chips show the style for new text: the new hand.
    page.keyboard.press("Escape")
    expect(chip).to_have_attribute("aria-pressed", "true")


def open_sample(page, name):
    page.set_input_files("#fileInput", str(SAMPLES / name))
    expect(page.locator(f"{ACTIVE} .page canvas").first).to_be_visible(timeout=20_000)
    expect(page.locator("#docName")).to_have_text(name)


def run(page, ctx):
    expect(page.locator("#empty")).to_be_visible()
    open_sample(page, "rental-agreement.pdf")
    page.screenshot(path=OUT / "1-opened.png")

    page.click("#newSigBtn")
    canvas = page.locator("#padCanvas")
    expect(canvas).to_be_visible()
    draw_mouse(page, canvas)
    expect(page.locator("#padSave")).to_be_enabled()
    page.screenshot(path=OUT / "2-pad-mouse.png")
    page.click("#padSave")
    expect(page.locator(".sig-card")).to_have_count(1)
    expect(page.locator(".sig-card.armed")).to_have_count(1)

    page.mouse.click(*page_point(page, 0, 200, 364))
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(1)

    page.click("#dateTool")
    page.mouse.click(*page_point(page, 0, 372, 352))
    expect(page.locator(f"{ACTIVE} .item.text")).to_have_count(1)

    page.click("#textTool")
    page.mouse.click(*page_point(page, 0, 372, 462))
    page.keyboard.type("Pat Example")
    page.keyboard.press("Enter")
    expect(page.locator(f"{ACTIVE} .item.text", has_text="Pat Example")).to_have_count(1)
    # The typed name is still selected: restyle it in a handwriting font.
    page.click('.font-chip[data-font="caveat"]')
    font = page.evaluate("() => window.__yepsign.state.items.find(i => i.text === 'Pat Example').font")
    assert font == "caveat", font

    page.click("#newInitBtn")
    draw_pen_initials(page)
    expect(page.locator("#penInfo")).to_have_text("Pen pressure detected")
    page.screenshot(path=OUT / "3-pad-pen.png")
    page.click("#padSave")
    page.mouse.click(*page_point(page, 0, 112, 398))
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(2)
    sims = page.evaluate("() => window.__yepsign.state.sigs.map(s => [s.kind, s.strokes.every(t => t.sim)])")
    assert ["initials", False] in sims and ["signature", True] in sims, sims

    # Move the signature 30 px right, then grow it by its handle.
    sig_el = page.locator(".item.sig").first
    before = page.evaluate("() => ({ ...window.__yepsign.state.items.find(i => i.kind === 'sig') })")
    b = sig_el.bounding_box()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    page.mouse.down()
    page.mouse.move(b["x"] + b["width"] / 2 + 30, b["y"] + b["height"] / 2 + 4, steps=5)
    page.mouse.up()
    hb = page.locator(".item.selected .handle").bounding_box()
    page.mouse.move(hb["x"] + 7, hb["y"] + 7)
    page.mouse.down()
    page.mouse.move(hb["x"] + 37, hb["y"] + 17, steps=5)
    page.mouse.up()
    after = page.evaluate(f"() => ({{ ...window.__yepsign.state.items.find(i => i.id === '{before['id']}') }})")
    assert after["x"] > before["x"] + 10 and after["w"] > before["w"] + 10, (before, after)

    page.keyboard.press("Delete")
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(1)
    page.keyboard.press("Control+z")
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(2)
    page.mouse.click(*page_point(page, 0, 500, 600))

    # Draw a signature straight onto the Lender line and keep a copy in the library.
    page.click("#drawTool")
    expect(page.locator("#drawBar")).to_be_visible()
    page.check("#drawKeep")
    x0, y0 = page_point(page, 0, 90, 438)
    x1, y1 = page_point(page, 0, 300, 472)
    pts = cursive(x0, y0, x1 - x0, y1 - y0)
    page.mouse.move(*pts[0])
    page.mouse.down()
    for i, pt in enumerate(pts[1:], 1):
        page.mouse.move(*pt, steps=1 + (i % 3))
    page.mouse.up()
    page.screenshot(path=OUT / "4a-drawing.png")
    page.click("#drawDone")
    expect(page.locator("#drawBar")).to_be_hidden()
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(3)
    expect(page.locator(".sig-card")).to_have_count(3)
    drawn = page.evaluate("() => window.__yepsign.state.items.find(i => i.sig?.kind === 'ink')")
    assert drawn and 80 < drawn["x"] + drawn["w"] / 2 < 310 and 430 < drawn["y"] + drawn["h"] / 2 < 480, drawn
    page.mouse.click(*page_point(page, 0, 500, 600))
    page.screenshot(path=OUT / "4-placed.png")

    _, flattened, doc = export(page, "signed-agreement")
    assert not flattened
    text = doc[0].get_text()
    assert "Pat Example" in text and "Equipment Rental Agreement" in text, "original or added text missing"
    fonts = [f[3] for f in doc[0].get_fonts()]
    assert any("Caveat" in f for f in fonts), fonts

    # Save the work as .yepsign, reload (saved signatures survive), reopen it: items stay editable.
    (OUT / "agreement.yepsign").write_text(page.evaluate("() => window.__yepsign.workFile()"), encoding="utf-8")
    page.reload()
    expect(page.locator(".sig-card")).to_have_count(3)
    page.set_input_files("#fileInput", str(OUT / "agreement.yepsign"))
    expect(page.locator("#docName")).to_have_text("rental-agreement.pdf", timeout=20_000)
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(3)
    expect(page.locator(f"{ACTIVE} .item.text")).to_have_count(2)

    # Keep the typed name in the library and place it again from there.
    page.locator(f"{ACTIVE} .item.text", has_text="Pat Example").click()
    page.locator(f"{ACTIVE} .item.selected .item-bar .act", has_text="Save").click()
    expect(page.locator(".snippet")).to_have_count(1)
    page.locator(".snippet").first.click()
    page.mouse.click(*page_point(page, 0, 372, 540))
    expect(page.locator(f"{ACTIVE} .item.text", has_text="Pat Example")).to_have_count(2)

    teach_handwriting(page)
    page.click("#dateTool")
    page.mouse.click(*page_point(page, 0, 372, 600))
    hand = page.evaluate("() => window.__yepsign.state.items.find(i => i.font?.startsWith('hand:'))")
    assert hand and hand["sig"] and hand["sig"]["strokes"], hand
    page.mouse.click(*page_point(page, 0, 500, 700))
    page.screenshot(path=OUT / "7-hand-placed.png")
    _, _, doc = export(page, "signed-hand")
    otf_size = page.evaluate("""async () => {
      const { buildOtf } = await import('./lib/handotf.js');
      return buildOtf(window.__yepsign.state.handFonts[0]).byteLength;
    }""")
    assert otf_size > 1000, otf_size

    open_sample(page, "rotated-page.pdf")
    page.locator(".sig-card").first.click()
    page.mouse.click(*page_point(page, 0, 300, 300))
    page.click("#textTool")
    page.mouse.click(*page_point(page, 0, 100, 100))
    page.keyboard.press("Escape")
    expect(page.locator(f"{ACTIVE} .item.text")).to_have_count(0)
    export(page, "signed-rotated")

    open_sample(page, "protected-printing-allowed.pdf")
    page.locator(".sig-card").first.click()
    page.mouse.click(*page_point(page, 0, 200, 364))
    _, flattened, _ = export(page, "signed-protected")
    assert flattened, "protected PDF should have been flattened"

    open_sample(page, "protected-no-printing.pdf")
    page.locator(".sig-card").first.click()
    page.mouse.click(*page_point(page, 0, 200, 364))
    msg = page.evaluate("() => window.__yepsign.buildOutput().then(() => 'saved', e => e.message)")
    assert "does not allow printing" in msg, msg

    # Four documents are open as tabs; each keeps its own items.
    expect(page.locator(".tab")).to_have_count(4)
    page.locator(".tab .tab-name", has_text="rental-agreement.pdf").click()
    expect(page.locator("#docName")).to_have_text("rental-agreement.pdf")
    expect(page.locator(f"{ACTIVE} .item.sig")).to_have_count(3)
    page.screenshot(path=OUT / "8-tabs.png")
    page.locator(".tab", has_text="protected-no-printing.pdf").locator(".tab-close").click()
    expect(page.locator(".tab")).to_have_count(3)

    # The toolbar button's path: bytes handed over through IndexedDB, read once.
    b64 = base64.b64encode((SAMPLES / "rental-agreement.pdf").read_bytes()).decode()
    page.evaluate("""async (b64) => {
      const m = await import('./lib/handoff.js');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      await m.putHandoff('smoke-token', { bytes, name: 'from-toolbar.pdf', url: 'https://example.test/from-toolbar.pdf' });
    }""", b64)
    page.goto(page.url.split("?")[0] + "?token=smoke-token")
    expect(page.locator("#docName")).to_have_text("from-toolbar.pdf", timeout=20_000)
    page.goto(page.url.split("?")[0] + "?token=smoke-token")
    expect(page.locator("#banner")).to_contain_text("no longer waiting")

    # A web PDF YepSign has no access to yet: it asks instead of failing.
    page.goto(page.url.split("?")[0] + "?src=" + "https%3A%2F%2Fexample.test%2Fcontract.pdf")
    expect(page.locator("#banner")).to_contain_text("needs your OK", timeout=20_000)
    expect(page.locator("#banner button", has_text="Allow and open")).to_be_visible()

    page.emulate_media(color_scheme="dark")
    open_sample(page, "rental-agreement.pdf")
    page.screenshot(path=OUT / "5-dark.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="yepsign-smoke-"))
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(profile), channel="chromium", headless=True, viewport={"width": 1440, "height": 1000},
                args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
            )
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
            ext_id = sw.url.split("/")[2]
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            # example.test never resolves; that failed fetch is what triggers the access banner.
            page.on("console", lambda m: m.type == "error" and "ERR_NAME_NOT_RESOLVED" not in m.text and errors.append(m.text))
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"chrome-extension://{ext_id}/signer.html")
            run(page, ctx)
            ctx.close()
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    print(json.dumps({"ok": True, "console_errors": errors, "out": str(OUT)}, indent=2))
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
