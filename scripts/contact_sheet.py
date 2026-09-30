#!/usr/bin/env python3
"""contact_sheet.py — render stills at the moments that matter and tile them.

  python3 contact_sheet.py <project> [--per-scene 3] [--cols 4]

Writes build/contact_sheet.png: a grid of frames (scene entry, middle, exit) plus a strip
showing scene spans and every SFX cue, so timing problems are visible at a glance.
Look at it before the full render — it is ~20× faster than rendering the video.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))


def font(size):
    for f in ("/System/Library/Fonts/SFNSMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
              "C:/Windows/Fonts/consola.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        sys.exit(1)
    project = os.path.abspath(a[0])
    per = int(a[a.index("--per-scene") + 1]) if "--per-scene" in a else 3
    cols = int(a[a.index("--cols") + 1]) if "--cols" in a else 4
    rep = json.load(open(os.path.join(project, "build", "cues.json")))
    dur = rep["meta"]["duration"]

    times = []
    for s in rep["scenes"]:
        st, en = s["start"] / 1000, s["end"] / 1000
        span = en - st
        picks = [st + min(0.6, span * 0.25), st + span * 0.5, en - min(0.35, span * 0.1)][:per]
        times += [(round(max(0, min(t, dur - 0.02)), 2), s["id"]) for t in picks]
    seen, uniq = set(), []
    for t, sid in times:
        if t not in seen:
            seen.add(t)
            uniq.append((t, sid))

    stills = os.path.join(project, "build", "stills")
    subprocess.run(["node", os.path.join(HERE, "render.mjs"), project, "--stills", ",".join(str(t) for t, _ in uniq),
                    "--stills-dir", "build/stills"], check=True)

    tw = 480
    th = int(tw * rep["meta"]["height"] / rep["meta"]["width"])
    rows = (len(uniq) + cols - 1) // cols
    strip_h = 90
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 10, rows * (th + 28) + 10 + strip_h + 20), (14, 14, 16))
    d = ImageDraw.Draw(sheet)
    f = font(14)
    for i, (t, sid) in enumerate(uniq):
        img = Image.open(os.path.join(stills, f"still_{f'{t:.2f}'.zfill(6)}.png"))
        img.thumbnail((tw, th))
        x = 10 + (i % cols) * (tw + 10)
        y = 10 + (i // cols) * (th + 28)
        sheet.paste(img, (x, y))
        d.text((x, y + th + 5), f"{t:5.2f}s  ·  {sid}", fill=(200, 200, 210), font=f)

    # timeline strip
    y0 = rows * (th + 28) + 20
    W = sheet.width - 20
    px = lambda ms: 10 + ms / (dur * 1000) * W
    palette = [(124, 92, 255), (56, 189, 248), (52, 211, 153), (251, 191, 36), (244, 114, 182), (248, 113, 113)]
    for i, s in enumerate(rep["scenes"]):
        lane = i % 2
        d.rectangle([px(s["start"]), y0 + lane * 18, px(s["end"]), y0 + lane * 18 + 14], fill=palette[i % len(palette)])
        d.text((px(s["start"]) + 3, y0 + lane * 18), s["id"], fill=(10, 10, 10), font=font(11))
    names = sorted({c["sfx"] for c in rep["cues"]})
    for c in rep["cues"]:
        k = names.index(c["sfx"])
        x = px(c["t"])
        d.line([x, y0 + 42, x, y0 + 62], fill=palette[k % len(palette)], width=2)
    for v in rep.get("vo", []):
        d.rectangle([px(v["t"]), y0 + 66, px(v["t"]) + 30, y0 + 72], fill=(255, 255, 255))
    lx = 10
    for k, nme in enumerate(names):
        d.text((lx, y0 + 74), f"■ {nme}", fill=palette[k % len(palette)], font=font(11))
        lx += 12 + int(d.textlength(f"■ {nme}", font=font(11)))
    for sec in range(int(dur) + 1):
        d.line([px(sec * 1000), y0 + 38, px(sec * 1000), y0 + 40], fill=(120, 120, 130))

    out = os.path.join(project, "build", "contact_sheet.png")
    sheet.save(out)
    print(f"✓ {out}  ({len(uniq)} frames)")


if __name__ == "__main__":
    main()
