#!/usr/bin/env python3
"""build_audio.py — turn build/cues.json into audio assets.

  python3 build_audio.py <project> [--provider auto|elevenlabs|synth] [--no-music] [--no-vo] [--force]

Provider "auto": ElevenLabs when ELEVENLABS_API_KEY is set, otherwise synth.
Any ElevenLabs failure (no credits, network, 4xx) falls back to synth for that asset
and is reported — a render never dies because an API did.

Outputs (all 48 kHz stereo WAV):
  build/audio/sfx/<name>.wav      one file per unique SFX name (leading silence trimmed)
  build/audio/music.wav           music bed at exactly meta.duration
  build/audio/vo/<i>.wav          voiceover lines
  build/audio/manifest.json       what came from where + beat analysis
Cache: ~/.cache/cinereel/ (keyed by prompt + duration) so re-runs cost zero credits.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth  # noqa: E402

SR = 48000
API = "https://api.elevenlabs.io/v1"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "cinereel")

# name → (ElevenLabs prompt, seconds, default gain dB)
SFX_LIBRARY = {
    "click": ("Single crisp UI mouse click, clean and dry, close-mic, no reverb, no room", 0.5, -9),
    "tick": ("One very short soft UI tick, subtle and dry, minimal", 0.5, -15),
    "type": ("One single soft laptop keyboard keystroke, dry, close-mic, no reverb", 0.5, -18),
    "pop": ("Soft rounded UI pop for a card appearing, playful, short, clean", 0.5, -12),
    "whoosh": ("Fast airy swoosh for a motion graphics transition, clean, modern, no rumble", 1.0, -13),
    "whoosh-soft": ("Gentle soft air swish, subtle smooth transition, very light", 0.8, -17),
    "riser": ("Short modern riser building anticipation, airy synth swell into a cut, no hit at the end", 2.0, -15),
    "impact": ("Deep clean modern cinematic hit with sub bass for a logo reveal, tight tail", 1.5, -10),
    "chime": ("Bright positive two-note success chime, clean UI notification", 1.0, -13),
    "toggle": ("Small clean UI switch toggle sound, two soft clicks", 0.5, -13),
    "glitch": ("Short tasteful digital glitch stutter, tech UI accent", 0.6, -17),
    "shimmer": ("Light airy sparkle shimmer for a logo reveal, soft and magical", 1.5, -17),
}
TONE_LOWPASS = {"soft": 5200, "neutral": 11000, "bright": None}


def log(msg):
    print(msg, flush=True)


# ───────────────────────────── audio io ─────────────────────────────
def decode(path):
    """Any audio file → float32 array (n, 2) at 48 kHz."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).copy()


def write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    _write_stereo(path, x)


def _write_stereo(path, x):
    import wave
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def trim_leading_silence(x, thresh_db=-42):
    """Generated SFX often start with 20–150 ms of air. That offset is exactly what
    makes hits feel late, so cut it (keep 3 ms of pre-roll)."""
    mono = np.abs(x).max(axis=1)
    thr = 10 ** (thresh_db / 20)
    idx = np.argmax(mono > thr) if (mono > thr).any() else 0
    idx = max(0, idx - int(SR * 0.003))
    y = x[idx:]
    # trailing silence too
    rev = np.argmax(mono[::-1] > thr / 3) if (mono > thr / 3).any() else 0
    if rev > 0:
        y = y[: len(y) - max(0, rev - int(SR * 0.02))]
    fade = min(len(y), int(SR * 0.004))
    if fade:
        y[:fade] *= np.linspace(0, 1, fade)[:, None]
    return y


def fit_length(x, seconds):
    n = int(round(seconds * SR))
    if len(x) >= n:
        y = x[:n].copy()
    else:
        y = np.zeros((n, 2), dtype=np.float32)
        y[: len(x)] = x
    fade = min(n, int(SR * 1.2))
    y[n - fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    return y


# ───────────────────────────── ElevenLabs ─────────────────────────────
class ProviderError(Exception):
    pass


def eleven(path, body, dest):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise ProviderError("ELEVENLABS_API_KEY not set")
    import requests
    try:
        r = requests.post(f"{API}{path}", headers={"xi-api-key": key, "Content-Type": "application/json"},
                          json=body, timeout=300)
    except Exception as e:  # network / proxy
        raise ProviderError(f"network: {e}") from e
    if r.status_code != 200:
        detail = r.text[:300]
        hint = " (out of credits?)" if r.status_code in (401, 402, 429) or "quota" in detail.lower() else ""
        raise ProviderError(f"HTTP {r.status_code}{hint}: {detail}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(r.content)
    return dest


def cached(kind, payload, ext="mp3"):
    h = hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
    return os.path.join(CACHE, kind, f"{h}.{ext}")


# ───────────────────────────── beat analysis ─────────────────────────────
def analyze_beats(x, bpm_hint):
    """Estimate tempo + beat-grid offset so the timeline can snap to the real track.
    Tempo: autocorrelation of a full-band spectral-flux onset envelope (coarse → fine search).
    Phase: kick-band flux only, so hats/claps on offbeats can't pull the grid half a beat."""
    mono = x.mean(axis=1)
    hop, win = 256, 2048
    frames = 1 + (len(mono) - win) // hop
    if frames < 128:
        return None
    fps = SR / hop
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.log1p(np.abs(np.fft.rfft(mono[idx] * np.hanning(win), axis=1)))
    kick_bins = slice(1, int(win * 160 / SR) + 1)
    full = np.maximum(np.diff(spec, axis=0), 0).sum(axis=1)
    kick = np.maximum(np.diff(spec[:, kick_bins], axis=0), 0).sum(axis=1)
    z = lambda v: (v - v.mean()) / (v.std() + 1e-9)
    full, kick = z(full), z(kick)
    tempo_env = full + 2 * kick

    def ac_at(bpm):
        lag = fps * 60 / bpm
        l0, fr = int(lag), lag - int(lag)
        a = np.dot(tempo_env[:-l0], tempo_env[l0:]) / (len(tempo_env) - l0)
        b = np.dot(tempo_env[:-(l0 + 1)], tempo_env[l0 + 1:]) / (len(tempo_env) - l0 - 1)
        # also reward the 2-beat and 4-beat lags so we don't pick a half/double tempo
        l2 = int(2 * lag)
        c = np.dot(tempo_env[:-l2], tempo_env[l2:]) / (len(tempo_env) - l2) if l2 < len(tempo_env) - 1 else 0
        prior = 0.6 + 0.4 * np.exp(-0.5 * ((bpm - bpm_hint) / (bpm_hint * 0.2)) ** 2)
        return ((1 - fr) * a + fr * b + 0.5 * c) * prior

    # Wide search: generated music does not always honour the requested tempo.
    cands = np.arange(70, 180, 0.25)
    scores = np.array([ac_at(b) for b in cands])
    coarse = float(cands[int(np.argmax(scores))])

    # Joint fine search over tempo × phase on the kick envelope (sub-frame via interpolation).
    # Octave traps (×2, ÷2, ×1.5, ÷1.5) are resolved by grid fit: a wrong grid lands on silence.
    frames_idx = np.arange(len(kick))
    smooth = np.convolve(kick, [0.25, 0.5, 1.0, 0.5, 0.25], mode="same")

    def fit(center):
        top = (center, 0.0, -1e9)
        for bpm_c in np.arange(center - 0.4, center + 0.4, 0.02):
            period = fps * 60 / bpm_c
            grid = period * np.arange(int((len(kick) - 1) / period))
            for ph in np.arange(0, period, 0.25):
                pos = ph + grid
                sc = np.interp(pos[pos < len(kick) - 1], frames_idx, smooth).mean()
                if sc > top[2]:
                    top = (float(bpm_c), float(ph), float(sc))
        return top

    results = []
    for ratio in (1, 2, 0.5, 1.5, 2 / 3, 3, 1 / 3):
        c = coarse * ratio
        if 58 <= c <= 200:
            results.append(fit(c))
    top_score = max(r[2] for r in results)
    # Sub-harmonic grids (½×, ⅓×) fit exactly as well as the true tempo, so among near-ties
    # prefer the tempo closest to the typical launch-video range around the hint.
    near = [r for r in results if r[2] >= top_score * 0.92]
    pick = max(near, key=lambda r: np.exp(-0.5 * ((r[0] - bpm_hint) / (bpm_hint * 0.45)) ** 2) + (0.05 if 85 <= r[0] <= 175 else 0))
    best = (*pick, pick[2])
    bpm, ph, sc, _ = best
    beat = 60 / bpm
    # Latency of the analysis itself: half the FFT window (the onset registers when it reaches the
    # window centre) + ~2 hops of attack rise. Calibrated against synthetic grids to < 5 ms.
    latency = (win / 2 + 2 * hop) / SR
    offset = ((ph + 1) * hop / SR + latency) % beat
    if beat - offset < 0.004:
        offset = 0.0
    conf = float(np.clip(sc / 4, 0, 1))
    return {"bpm": round(float(bpm), 2), "beatOffset": round(float(offset), 3), "confidence": round(conf, 2)}


# ───────────────────────────── builders ─────────────────────────────
def build_sfx(names, overrides, provider, tone, out_dir, force, project="."):
    results = {}
    for name in sorted(names):
        o = overrides.get(name, {})
        base = name.split(":")[0]
        lib = SFX_LIBRARY.get(base, (None, 0.8, -12))
        prompt = o.get("prompt") or lib[0] or f"Clean modern UI sound effect: {base.replace('-', ' ')}"
        dur = float(o.get("dur", lib[1]))
        gain = float(o.get("gain", lib[2]))
        dest = os.path.join(out_dir, "sfx", f"{name.replace(':', '_')}.wav")
        source = None
        if o.get("file"):
            x = decode(os.path.join(project, o["file"]))
            source = f"file:{o['file']}"
        else:
            x = None
            if provider in ("auto", "elevenlabs") and os.environ.get("ELEVENLABS_API_KEY"):
                payload = {"text": prompt, "duration_seconds": max(0.5, min(dur, 22)), "prompt_influence": float(o.get("influence", 0.55))}
                cfile = cached("sfx", dict(payload, take=name))  # name:variant → distinct take
                try:
                    if force or not os.path.exists(cfile):
                        eleven("/sound-generation", payload, cfile)
                        source = "elevenlabs"
                    else:
                        source = "elevenlabs(cache)"
                    x = decode(cfile)
                except ProviderError as e:
                    log(f"  ⚠ sfx '{name}': ElevenLabs failed → synth ({e})")
            elif provider == "elevenlabs":
                log(f"  ⚠ sfx '{name}': ELEVENLABS_API_KEY not set → synth")
            if x is None:
                mono = synth.sfx(base)
                x = np.stack([mono, mono], axis=1).astype(np.float32)
                source = "synth"
        x = trim_leading_silence(x)
        lp = TONE_LOWPASS.get(o.get("tone", tone))
        if lp:
            x = np.stack([synth._lp(x[:, c], lp) for c in range(2)], axis=1)
        pk = np.abs(x).max() or 1
        x = x / pk * 10 ** (-1 / 20)  # normalise peak; per-name gain applied in mix
        write(dest, x)
        results[name] = {"file": dest, "gain": gain, "source": source, "prompt": prompt, "len": round(len(x) / SR, 3)}
        log(f"  ✓ sfx {name:<14} {source:<18} {len(x) / SR:.2f}s  gain {gain} dB")
    return results


def build_music(spec, meta, provider, out_dir, force, project="."):
    dur = float(meta["duration"])
    bpm = float(meta.get("bpm", 120))
    dest = os.path.join(out_dir, "music.wav")
    source = None
    x = None
    if spec.get("file"):
        x = decode(os.path.join(project, spec["file"]))
        source = f"file:{spec['file']}"
    elif provider in ("auto", "elevenlabs") and os.environ.get("ELEVENLABS_API_KEY"):
        prompt = (spec.get("prompt") or "Modern confident tech product launch track, punchy drums, warm synths").strip()
        full = (f"{prompt}. Instrumental only. Around {int(round(bpm))} BPM with a steady, clearly audible beat from the first bar. "
                f"Length {int(round(dur))} seconds with a clean resolved ending.")
        payload = {"prompt": full, "music_length_ms": int(max(3000, round(dur * 1000) + 1000)),
                   "model_id": spec.get("model", "music_v2"), "force_instrumental": True}
        # Cache key ignores the bpm hint so correcting meta.bpm after beat analysis
        # does not trigger a brand-new (different) track.
        cfile = cached("music", {"prompt": prompt, "len": payload["music_length_ms"], "model": payload["model_id"],
                                 "bpm": spec.get("bpm", "first")})
        try:
            if force or not os.path.exists(cfile):
                log("  … composing music with ElevenLabs (can take a minute)")
                eleven("/music", payload, cfile)
                source = "elevenlabs"
            else:
                source = "elevenlabs(cache)"
            x = decode(cfile)
        except ProviderError as e:
            log(f"  ⚠ music: ElevenLabs failed → synth bed ({e})")
    if x is None:
        mono = synth.music(bpm, dur, spec.get("mood", "bright"))
        x = np.stack([mono, mono], axis=1).astype(np.float32)
        source = "synth"
    if spec.get("trim"):
        x = x[int(float(spec["trim"]) * SR):]
    x = fit_length(x, dur)
    write(dest, x)
    analysis = analyze_beats(x, bpm) if source != "synth" else {"bpm": bpm, "beatOffset": 0.0, "confidence": 1.0}
    log(f"  ✓ music {source}  {dur:.1f}s  detected ≈ {analysis['bpm'] if analysis else '?'} bpm, "
        f"beatOffset ≈ {analysis['beatOffset'] if analysis else '?'}s")
    return {"file": dest, "source": source, "gain": float(spec.get("gain", -15)), "analysis": analysis}


def build_vo(lines, audio_cfg, provider, out_dir, force):
    out = []
    if not lines:
        return out
    voice = audio_cfg.get("voice") or os.environ.get("ELEVENLABS_VOICE_ID")
    if provider == "synth" or not os.environ.get("ELEVENLABS_API_KEY") or not voice:
        why = "no API key" if not os.environ.get("ELEVENLABS_API_KEY") else "no voice id (set audio.voice or ELEVENLABS_VOICE_ID)"
        log(f"  ⚠ voiceover skipped: {why if provider != 'synth' else 'synth provider has no voice'}")
        return out
    for i, line in enumerate(lines):
        v = line.get("voice", voice)
        model = audio_cfg.get("voiceModel", "eleven_multilingual_v2")
        payload = {"text": line["text"], "model_id": model, "voice": v}
        cfile = cached("vo", payload)
        try:
            if force or not os.path.exists(cfile):
                eleven(f"/text-to-speech/{v}", {"text": line["text"], "model_id": model}, cfile)
            x = trim_leading_silence(decode(cfile), -48)
        except ProviderError as e:
            log(f"  ⚠ vo line {i}: {e} — skipped")
            continue
        dest = os.path.join(out_dir, "vo", f"{i:02d}.wav")
        write(dest, x)
        out.append({"file": dest, "t": line["t"], "len": round(len(x) / SR, 3), "text": line["text"], "gain": float(line.get("gain", -3))})
        log(f"  ✓ vo {i:02d} @ {line['t'] / 1000:.2f}s  {len(x) / SR:.2f}s  “{line['text'][:48]}”")
    for a, b in zip(out, out[1:]):
        if a["t"] + a["len"] * 1000 > b["t"]:
            log(f"  ⚠ vo line at {a['t'] / 1000:.2f}s runs {(a['t'] + a['len'] * 1000 - b['t']) / 1000:.2f}s into the next line — move it later")
    return out


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    project = os.path.abspath(args[0])
    flag = lambda k: k in args
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    provider = opt("--provider", "auto")
    cues_path = os.path.join(project, "build", "cues.json")
    if not os.path.exists(cues_path):
        log("✗ build/cues.json missing — run probe.mjs first")
        sys.exit(1)
    report = json.load(open(cues_path))
    meta, audio = report["meta"], report["audio"]
    out_dir = os.path.join(project, "build", "audio")
    os.makedirs(out_dir, exist_ok=True)
    keyed = "yes" if os.environ.get("ELEVENLABS_API_KEY") else "no"
    log(f"▸ audio provider: {provider} (ElevenLabs key: {keyed}), tone: {audio.get('tone', 'neutral')}")

    names = {c["sfx"] for c in report["cues"]}
    manifest = {
        "sfx": build_sfx(names, audio.get("sfx") or {}, provider, audio.get("tone", "neutral"), out_dir, flag("--force"), project),
        "music": None if flag("--no-music") or audio.get("music") is False else
        build_music(audio.get("music") or {}, meta, provider, out_dir, flag("--force"), project),
        "vo": [] if flag("--no-vo") else build_vo(report["vo"], audio, provider, out_dir, flag("--force")),
    }
    json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)

    an = (manifest["music"] or {}).get("analysis")
    if an and manifest["music"]["source"] != "synth":
        want = float(meta.get("bpm", 120))
        # The timeline's bpm encodes event density. Fold the detected tempo to the octave nearest
        # it (half-/double-time grids are musically valid) and correct only tempo + phase.
        det = float(an["bpm"])
        while det * 2 - want < want - det and det < want:
            det *= 2
        while want - det / 2 < det - want and det > want:
            det /= 2
        det = round(det, 2)
        off = round(float(an["beatOffset"]) % (60 / det), 3)
        manifest["music"]["suggested"] = {"bpm": det, "beatOffset": off}
        json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)
        drift_ms = abs(off - float(meta.get("beatOffset", 0))) * 1000
        tempo_err = abs(det - want) / want
        # How far the grid is off by the end of the video — what the viewer actually feels.
        end_err = drift_ms + tempo_err * float(meta["duration"]) * 1000
        if end_err > 25:
            log(f"\n⚠ BEAT DRIFT: the music's grid is {det} bpm with beat 0 at {off}s "
                f"(timeline: {want} bpm / {meta.get('beatOffset', 0)}s) → up to {end_err:.0f} ms off by the end.\n"
                f"  → set meta.bpm = {det} and meta.beatOffset = {off} in timeline.js, then re-run probe.mjs\n"
                f"    (music is cached — no new generation). Beat-addressed events re-time themselves. "
                f"confidence {an['confidence']}")
        else:
            log(f"✓ music grid matches the timeline (≤ {end_err:.0f} ms)")
    log(f"✓ wrote {os.path.join(out_dir, 'manifest.json')}")


if __name__ == "__main__":
    main()
