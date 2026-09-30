#!/usr/bin/env python3
"""mix_audio.py — place every cue sample-accurately, duck music under VO, normalise loudness.

  python3 mix_audio.py <project> [--lufs -14]

Reads build/cues.json + build/audio/manifest.json, writes build/mix.wav.
Mix knobs live in timeline.js → audio.mix:
  { music: 0, sfx: 0, vo: 0,      // dB trims per bus
    duck: 8,                      // dB music reduction while VO speaks
    lufs: -14,                    // integrated loudness target (YouTube ≈ -14)
    vary: true }                  // subtle pitch/gain variation on repeated hits
"""
import json
import os
import subprocess
import sys
import zlib

import numpy as np
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_audio import SR, decode, _write_stereo  # noqa: E402

db = lambda v: 10 ** (v / 20)


def envelope(x, attack=0.01, release=0.25):
    mono = np.abs(x).max(axis=1)
    a = np.exp(-1 / (SR * attack))
    r = np.exp(-1 / (SR * release))
    # Vectorised-ish follower on a decimated signal (fast enough for minutes of audio).
    step = 48
    m = mono[: len(mono) // step * step].reshape(-1, step).max(axis=1)
    env = np.zeros_like(m)
    prev = 0.0
    a2, r2 = a ** step, r ** step
    for i, v in enumerate(m):
        coef = a2 if v > prev else r2
        prev = coef * prev + (1 - coef) * v
        env[i] = prev
    full = np.repeat(env, step)
    return np.pad(full, (0, len(mono) - len(full)), mode="edge")


def place(bus, x, start, gain):
    if start >= len(bus):
        return
    if start < 0:
        x = x[-start:]
        start = 0
    end = min(len(bus), start + len(x))
    bus[start:end] += x[: end - start] * gain


def loudnorm(src, dst, lufs, tp=-1.5, lra=11):
    first = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", src, "-af", f"loudnorm=I={lufs}:TP={tp}:LRA={lra}:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    try:
        j = json.loads(first[first.rindex("{"): first.rindex("}") + 1])
        af = (f"loudnorm=I={lufs}:TP={tp}:LRA={lra}:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
              f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
        measured = float(j["input_i"])
    except Exception:
        af, measured = f"loudnorm=I={lufs}:TP={tp}:LRA={lra}", None
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-af", af, "-ar", str(SR), "-ac", "2", dst], check=True)
    return measured


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    project = os.path.abspath(args[0])
    report = json.load(open(os.path.join(project, "build", "cues.json")))
    man = json.load(open(os.path.join(project, "build", "audio", "manifest.json")))
    meta, mix = report["meta"], report["audio"].get("mix") or {}
    lufs = float(args[args.index("--lufs") + 1]) if "--lufs" in args else float(mix.get("lufs", -14))
    n = int(round(float(meta["duration"]) * SR))

    sfx_bus = np.zeros((n, 2), dtype=np.float32)
    vo_bus = np.zeros((n, 2), dtype=np.float32)
    music_bus = np.zeros((n, 2), dtype=np.float32)

    cache = {}
    vary_on = mix.get("vary", True)
    for i, c in enumerate(report["cues"]):
        info = man["sfx"].get(c["sfx"])
        if not info:
            print(f"  ⚠ no asset for sfx '{c['sfx']}' — run build_audio.py again")
            continue
        if c["sfx"] not in cache:
            cache[c["sfx"]] = decode(info["file"])
        x = cache[c["sfx"]]
        gain = c.get("gain") if c.get("gain") is not None else info["gain"]
        if vary_on and c.get("vary"):
            h = zlib.crc32(f"{c['sfx']}{i}".encode())
            rate = 0.955 + (h % 1000) / 1000 * 0.09          # ±4.5 % pitch
            gain += ((h >> 10) % 1000) / 1000 * 3 - 1.5       # ±1.5 dB
            down = int(round(200 * rate))
            x = resample_poly(x, 200, down, axis=0).astype(np.float32)
        place(sfx_bus, x, int(c["t"] / 1000 * SR), db(gain))

    for line in man.get("vo") or []:
        place(vo_bus, decode(line["file"]), int(line["t"] / 1000 * SR), db(line.get("gain", -3)))

    if man.get("music"):
        m = decode(man["music"]["file"])
        place(music_bus, m, 0, db(man["music"]["gain"]))
        if np.abs(vo_bus).max() > 0:
            env = envelope(vo_bus)
            thr = 10 ** (-40 / 20)
            depth = np.clip(env / thr, 0, 1)
            music_bus *= (1 - depth * (1 - db(-float(mix.get("duck", 8)))))[:, None]
        fin = int(SR * 0.05)
        music_bus[:fin] *= np.linspace(0, 1, fin)[:, None]

    out = (music_bus * db(mix.get("music", 0)) + sfx_bus * db(mix.get("sfx", 0)) + vo_bus * db(mix.get("vo", 0)))
    peak = float(np.abs(out).max() or 1)
    if peak > 0.98:  # pre-normalisation safety; loudnorm sets the final level
        out *= 0.98 / peak
    raw = os.path.join(project, "build", "audio", "mix_raw.wav")
    _write_stereo(raw, out)
    dst = os.path.join(project, "build", "mix.wav")
    measured = loudnorm(raw, dst, lufs)
    print(f"✓ mix: {len(report['cues'])} sfx hits, {len(man.get('vo') or [])} vo lines, "
          f"music {'on' if man.get('music') else 'off'} → {lufs} LUFS"
          + (f" (was {measured:.1f})" if measured is not None else ""))
    print(f"✓ {dst}")


if __name__ == "__main__":
    main()
