"""Render the Chrome Web Store images. The five 1280x800 screenshots go to
docs/img (the website and README use the same files); the 440x280 and 1400x560
promo tiles and the 128 px store icon go to the store folder.

Usage: python scripts/store_assets.py
Needs Playwright and `pip install Hershey-Fonts`. The demo handwriting is the
public-domain Hershey script face, drawn through the real UI with synthetic pen
pressure, so the screenshots show what the extension actually produces.
Runs in a throwaway Chromium profile.
"""
import json
import math
import random
import shutil
import tempfile
from pathlib import Path

from HersheyFonts import HersheyFonts
from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
SAMPLES = ROOT / "samples"
OUT = ROOT / "store"
SHOTS = ROOT / "docs" / "img"
ACTIVE = ".pages:not([hidden])"
W, H = 1280, 800

_font = HersheyFonts()
_font.load_default_font("scripts")
_font.normalize_rendering(100)
BASE, CAP = 36.4, 100.0  # Hershey script units: baseline and capital height (y up)


def hershey(text, cap_px, x0, baseline, slant=0.18, seed=1, wobble=0.6):
    """Pen strokes for `text`: lists of (x, y, pressure) in CSS px, densified."""
    rnd = random.Random(seed)
    k = cap_px / (CAP - BASE)
    segs = list(_font.lines_for_text(text))
    strokes, cur = [], []
    for a, b in segs:
        if cur and cur[-1] != a:
            strokes.append(cur)
            cur = []
        if not cur:
            cur = [a]
        cur.append(b)
    if cur:
        strokes.append(cur)
    out = []
    for s in strokes:
        pts = []
        for (ax, ay), (bx, by) in zip(s, s[1:]):
            n = max(1, int(math.hypot(bx - ax, by - ay) * k / 2))
            for i in range(n):
                t = i / n
                pts.append((ax + (bx - ax) * t, ay + (by - ay) * t))
        pts.append(s[-1])
        line = []
        for i, (x, y) in enumerate(pts):
            u = i / max(1, len(pts) - 1)
            p = 0.3 + 0.5 * math.sin(math.pi * u) ** 0.6 + rnd.uniform(-0.05, 0.05)
            yy = (y - BASE) * k
            line.append((x0 + x * k + yy * slant + rnd.uniform(-wobble, wobble) * 0.3,
                         baseline - yy + rnd.uniform(-wobble, wobble) * 0.3, max(0.08, p)))
        out.append(line)
    return out


def glyph_box(ch):
    xs = [v for a, b in _font.lines_for_text(ch) for v in (a[0], b[0])]
    return (min(xs), max(xs)) if xs else (0, 0)


PEN_JS = """([selector, strokes]) => {
  const c = document.querySelector(selector);
  const r = c.getBoundingClientRect();
  let id = 50;
  for (const pts of strokes) {
    id++;
    const fire = (type, [x, y, p]) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : p, clientX: r.left + x, clientY: r.top + y }));
    fire('pointerdown', pts[0]);
    for (const p of pts.slice(1)) fire('pointermove', p);
    fire('pointerup', pts[pts.length - 1]);
  }
}"""


def pen(page, selector, strokes):
    page.evaluate(PEN_JS, [selector, [[list(p) for p in s] for s in strokes]])


def page_point(page, x, y):
    el = page.locator(f"{ACTIVE} .page").first
    w = page.evaluate("() => window.__yepsign.state.pages[0].width")
    box = el.bounding_box()
    s = box["width"] / w
    return box["x"] + x * s, box["y"] + y * s


def open_sample(page, name):
    page.set_input_files("#fileInput", str(SAMPLES / name))
    expect(page.locator("#docName")).to_have_text(name, timeout=20_000)
    expect(page.locator(f"{ACTIVE} .page canvas").first).to_be_visible(timeout=20_000)


def shot(page, name):
    page.locator("#toast").evaluate("el => el.hidden = true")
    page.screenshot(path=SHOTS / name)


def signature_strokes():
    strokes = hershey("Pat Example", 70, 70, 168, slant=0.28, seed=4)
    # The underline flourish most signatures end with.
    tail = [(120 + i * 14, 186 - 7 * math.sin(i / 6) + i * 0.15, 0.25 + 0.4 * math.sin(math.pi * i / 34)) for i in range(35)]
    return strokes + [tail]


def teach(page):
    """Fill the wizard with Hershey letters and both sentences; leave it on the review step."""
    page.click("#teachHand")
    k = 50 / (CAP - BASE)
    for step in range(3):
        for cell in page.locator(".cell").all():
            if not cell.is_visible():
                continue
            ch = cell.get_attribute("data-char")
            x_min, _ = glyph_box(ch)
            strokes = hershey(ch, 50, 12 - x_min * k, 70, slant=0.12, seed=ord(ch), wobble=0.4)
            pen(page, f'.cell[data-char="{json.dumps(ch)[1:-1]}"] canvas', strokes)
        if step == 0:
            shot(page, "3-teach-letters.png")
        page.click("#handNext")
    for i, text in enumerate(["The quick brown fox jumps over the lazy dog.", "Sphinx of black quartz, judge my vow."]):
        pen(page, f".sentence:nth-child({i + 1}) canvas", hershey(text, 30, 18, 106, slant=0.16, seed=90 + i))
    page.click("#handNext")
    expect(page.locator(".review")).to_be_visible()
    page.locator(".review input[type=text]").fill("My handwriting")


def screenshots(page):
    open_sample(page, "rental-agreement.pdf")
    page.click("#newSigBtn")
    expect(page.locator("#padCanvas")).to_be_visible()
    pen(page, "#padCanvas", signature_strokes())
    shot(page, "2-draw-signature.png")
    page.click("#padSave")

    page.mouse.click(*page_point(page, 200, 364))
    page.click("#dateTool")
    page.mouse.click(*page_point(page, 372, 364))
    page.locator('.font-chip[data-font="kalam"]').click()
    page.click("#newInitBtn")
    pen(page, "#padCanvas", hershey("PE", 80, 200, 168, slant=0.25, seed=7))
    page.click("#padSave")
    page.mouse.click(*page_point(page, 110, 398))
    page.keyboard.press("Escape")
    page.evaluate("() => document.getElementById('viewer').scrollTo(0, 330)")
    shot(page, "1-sign-the-line.png")

    teach(page)
    shot(page, "4-your-handwriting.png")
    page.click("#handNext")
    expect(page.locator("#handDialog")).to_be_hidden()

    page.evaluate("() => document.getElementById('viewer').scrollTo(0, 330)")
    page.click("#textTool")
    page.mouse.click(*page_point(page, 372, 474))
    page.keyboard.type("Pat Example")
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    open_sample(page, "rotated-page.pdf")
    open_sample(page, "protected-printing-allowed.pdf")
    page.locator(".tab .tab-name", has_text="rental-agreement.pdf").click()
    page.evaluate("() => document.getElementById('viewer').scrollTo(0, 330)")
    shot(page, "5-tabs-and-library.png")


TILE_CSS = """
@font-face { font-family: Caveat; src: url('%(caveat)s'); }
* { box-sizing: border-box; margin: 0; }
body { width: %(w)dpx; height: %(h)dpx; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif;
  background: radial-gradient(120%% 140%% at 85%% 10%%, #2747c4 0%%, #1f3a93 45%%, #142a6e 100%%); color: #fbfaf7; position: relative; }
.paper { position: absolute; background: #fbfaf7; border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.rule { position: absolute; height: 2px; background: #2a2a30; opacity: .7; }
.ink path { fill: #1f3a93; }
.brand { display: flex; align-items: center; gap: %(gap)dpx; font-weight: 700; letter-spacing: .01em; }
.brand img { border-radius: 22%%; }
.tag { font-family: Caveat, cursive; color: #ffd98a; }
"""


def svg_path(strokes, size_scale=1.0):
    """The ink as an SVG path string, using the extension's own outline code via Node."""
    import subprocess
    sig = {"pen": "ballpoint", "sizeScale": size_scale, "strokes": [{"sim": False, "pts": [list(p) for p in s]} for s in strokes]}
    js = ("const m = await import('./extension/lib/ink.js'); let raw = '';"
          "for await (const c of process.stdin) raw += c;"
          "process.stdout.write(m.commandsToSvg(m.signatureCommands(JSON.parse(raw))));")
    return subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(sig),
                          cwd=ROOT, capture_output=True, text=True, check=True).stdout


def tiles(browser):
    sig = signature_strokes()
    d = svg_path(sig, 1.3)
    xs = [p[0] for s in sig for p in s]
    ys = [p[1] for s in sig for p in s]
    vb = f"{min(xs) - 10} {min(ys) - 10} {max(xs) - min(xs) + 20} {max(ys) - min(ys) + 20}"
    # set_content pages can't load file:// URLs, so the icon and font go in as data URIs.
    import base64
    icon = "data:image/png;base64," + base64.b64encode((ROOT / "docs" / "img" / "icon.png").read_bytes()).decode()
    caveat = "data:font/ttf;base64," + base64.b64encode((EXT / "vendor" / "fonts" / "Caveat.ttf").read_bytes()).decode()
    specs = {
        "promo-small-440x280.png": (440, 280, f"""
          <div class="brand" style="position:absolute;left:26px;top:24px;font-size:24px"><img src="{icon}" width="38" height="38">YepSign</div>
          <div style="position:absolute;left:26px;top:82px;font-size:22px;font-weight:600;line-height:1.2;width:190px">Sign PDFs in your own hand</div>
          <div class="tag" style="position:absolute;left:26px;top:160px;font-size:24px;line-height:1.05;width:180px">skip the printer<br>and the scanner</div>
          <div class="paper" style="left:232px;top:96px;width:240px;height:220px;transform:rotate(-5deg)">
            <div class="rule" style="left:16px;top:118px;width:180px"></div>
            <svg class="ink" viewBox="{vb}" style="position:absolute;left:10px;top:54px;width:190px;height:78px"><path d="{d}"/></svg>
          </div>"""),
        "promo-marquee-1400x560.png": (1400, 560, f"""
          <div class="brand" style="position:absolute;left:90px;top:86px;font-size:44px;gap:18px"><img src="{icon}" width="72" height="72">YepSign</div>
          <div style="position:absolute;left:90px;top:200px;font-size:54px;font-weight:600;line-height:1.15;width:640px">Sign PDFs in your own hand.</div>
          <div style="position:absolute;left:90px;top:342px;font-size:24px;line-height:1.45;width:600px;opacity:.88">Draw your signature with a mouse, pen or finger. Click the line. Save. Your files never leave your computer.</div>
          <div class="tag" style="position:absolute;left:90px;top:450px;font-size:38px">Skip the printer and the scanner.</div>
          <div class="paper" style="left:800px;top:70px;width:520px;height:560px;transform:rotate(-3deg)">
            <div style="position:absolute;left:44px;top:46px;font:700 26px Georgia,serif;color:#1c1c20">Rental Agreement</div>
            <div style="position:absolute;left:44px;top:96px;width:420px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div style="position:absolute;left:44px;top:116px;width:380px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div style="position:absolute;left:44px;top:136px;width:400px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div class="rule" style="left:44px;top:292px;width:300px"></div>
            <svg class="ink" viewBox="{vb}" style="position:absolute;left:40px;top:180px;width:330px;height:130px"><path d="{d}"/></svg>
            <div style="position:absolute;left:44px;top:302px;font:14px 'Segoe UI';color:#77767c">Signature</div>
          </div>"""),
    }
    specs["og.png"] = (1200, 630, f"""
          <div class="brand" style="position:absolute;left:70px;top:70px;font-size:40px;gap:16px"><img src="{icon}" width="64" height="64">YepSign</div>
          <div style="position:absolute;left:70px;top:180px;font-size:56px;font-weight:600;line-height:1.12;width:560px">Sign PDFs in your own hand.</div>
          <div class="tag" style="position:absolute;left:70px;top:380px;font-size:40px;width:520px">Skip the printer and the scanner.</div>
          <div style="position:absolute;left:70px;top:500px;font-size:22px;opacity:.85">Free Chrome extension · files stay on your computer</div>
          <div class="paper" style="left:690px;top:90px;width:470px;height:520px;transform:rotate(-3deg)">
            <div style="position:absolute;left:40px;top:42px;font:700 24px Georgia,serif;color:#1c1c20">Rental Agreement</div>
            <div style="position:absolute;left:40px;top:90px;width:380px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div style="position:absolute;left:40px;top:110px;width:340px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div style="position:absolute;left:40px;top:130px;width:360px;height:8px;background:#e4e0d6;border-radius:4px"></div>
            <div class="rule" style="left:40px;top:300px;width:280px"></div>
            <svg class="ink" viewBox="{vb}" style="position:absolute;left:36px;top:190px;width:310px;height:122px"><path d="{d}"/></svg>
          </div>""")
    page = browser.new_page()
    for name, (w, h, html) in specs.items():
        page.set_viewport_size({"width": w, "height": h})
        css = TILE_CSS % {"w": w, "h": h, "caveat": caveat, "gap": 10}
        page.set_content(f"<!doctype html><html><head><style>{css}</style></head><body>{html}</body></html>")
        page.wait_for_timeout(400)
        page.screenshot(path=(SHOTS if name == "og.png" else OUT) / name)
    page.close()


def signature_svg():
    """docs/img/signature.svg: the demo signature, inked stroke by stroke as the page loads."""
    sig = signature_strokes()
    outline = svg_path(sig, 1.3)
    xs = [p[0] for s in sig for p in s]
    ys = [p[1] for s in sig for p in s]
    x0, y0, x1, y1 = min(xs) - 12, min(ys) - 12, max(xs) + 12, max(ys) + 12
    lengths = [sum(math.dist(a[:2], b[:2]) for a, b in zip(s, s[1:])) for s in sig]
    total = sum(lengths)
    paths, t = [], 0.0
    for s, length in zip(sig, lengths):
        d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y, _ in s)
        dur = 2.4 * length / total
        paths.append(f'<path d="{d}" pathLength="1" style="animation-delay:{t:.2f}s;animation-duration:{max(dur, 0.05):.2f}s"/>')
        t += dur + 0.05
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" role="img" aria-label="A handwritten signature">
<style>
.c path {{ fill: none; stroke: #fff; stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: ink linear forwards; }}
@keyframes ink {{ to {{ stroke-dashoffset: 0; }} }}
@media (prefers-reduced-motion: reduce) {{ .c path {{ animation: none; stroke-dashoffset: 0; }} }}
</style>
<mask id="m" maskUnits="userSpaceOnUse" x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}"><g class="c">{''.join(paths)}</g></mask>
<path d="{outline}" fill="#1f3a93" mask="url(#m)"/>
</svg>
"""
    (SHOTS / "signature.svg").write_text(svg, encoding="utf-8")


def store_icon():
    """128 px with 96 px artwork and 16 px clear padding, as the store asks."""
    src = Image.open(ROOT / "docs" / "img" / "icon.png").convert("RGBA")
    out = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    out.paste(src.resize((96, 96), Image.LANCZOS), (16, 16))
    out.save(OUT / "icon-128.png")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    SHOTS.mkdir(parents=True, exist_ok=True)
    store_icon()
    signature_svg()
    profile = Path(tempfile.mkdtemp(prefix="yepsign-store-"))
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(profile), channel="chromium", headless=True, viewport={"width": W, "height": H},
                args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            page.goto(f"chrome-extension://{sw.url.split('/')[2]}/signer.html")
            screenshots(page)
            tiles(ctx)
            ctx.close()
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    for f in sorted([*OUT.glob("*.png"), *SHOTS.glob("*.png")]):
        print(f.name, Image.open(f).size)


if __name__ == "__main__":
    main()
