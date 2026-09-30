"""synth.py — procedural UI sound effects and a beat-locked placeholder music bed.

Used when ELEVENLABS_API_KEY is missing, credits run out, or --provider synth is passed.
Everything is deterministic (seeded) so re-renders sound identical.

  python3 synth.py sfx <name> <out.wav>
  python3 synth.py music <bpm> <seconds> <out.wav> [--mood bright|dark|chill]
"""
import sys
import wave
import zlib
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000


def _t(dur):
    return np.arange(int(SR * dur)) / SR


def _env(n, attack=0.002, decay=0.1):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))


def _noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def _bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def _lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)


def _hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)


def _norm(x, peak_db=-3.0):
    m = np.max(np.abs(x)) or 1.0
    return x / m * (10 ** (peak_db / 20))


# ───────────────────────────── SFX recipes ─────────────────────────────
def click(seed=1):
    n = int(SR * 0.09)
    body = np.sin(2 * np.pi * 1850 * _t(0.09)) * _env(n, 0.0005, 0.008)
    snap = _bp(_noise(n, seed), 2500, 9000) * _env(n, 0.0002, 0.004)
    thump = np.sin(2 * np.pi * 160 * _t(0.09)) * _env(n, 0.001, 0.02) * 0.5
    return _norm(body * 0.6 + snap + thump)


def tick(seed=2):
    n = int(SR * 0.05)
    x = _bp(_noise(n, seed), 3000, 11000) * _env(n, 0.0002, 0.003)
    return _norm(x + np.sin(2 * np.pi * 3200 * _t(0.05)) * _env(n, 0.0002, 0.004) * 0.4, -6)


def type_(seed=3):
    n = int(SR * 0.07)
    rng = np.random.default_rng(seed)
    f = 900 + rng.uniform(-80, 80)
    x = _bp(_noise(n, seed), 1200, 6000) * _env(n, 0.0003, 0.006)
    x += np.sin(2 * np.pi * f * _t(0.07)) * _env(n, 0.0005, 0.012) * 0.35
    x += np.sin(2 * np.pi * 110 * _t(0.07)) * _env(n, 0.001, 0.015) * 0.3
    return _norm(x, -4)


def pop(seed=4):
    d = 0.16
    t = _t(d)
    f = 280 + 900 * np.exp(-t / 0.018)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * _env(len(t), 0.001, 0.045)
    return _norm(x + _bp(_noise(len(t), seed), 1500, 6000) * _env(len(t), 0.0003, 0.004) * 0.3)


def whoosh(seed=5, dur=0.7, soft=False):
    n = int(SR * dur)
    t = _t(dur)
    x = _noise(n, seed)
    # Sweep a band-pass by processing in chunks with a moving centre frequency.
    out = np.zeros(n)
    chunks = 48
    edges = np.linspace(0, n, chunks + 1, dtype=int)
    for i in range(chunks):
        c = i / chunks
        centre = 400 + 3800 * np.sin(np.pi * c) ** 1.5
        seg = _bp(x[max(0, edges[i] - 512): edges[i + 1]], centre * 0.55, min(centre * 1.8, 20000))
        out[edges[i]: edges[i + 1]] = seg[-(edges[i + 1] - edges[i]):]
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** (2.2 if soft else 1.4)
    out *= shape
    if soft:
        out = _lp(out, 3500)
    return _norm(out, -6 if soft else -3)


def riser(seed=6, dur=1.8):
    n = int(SR * dur)
    t = _t(dur)
    f = 180 * (2 ** (3 * (t / dur) ** 2))
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(ph) + 0.5 * np.sin(2 * ph + 0.3)) * 0.35
    air = _hp(_noise(n, seed), 1500)
    ramp = (t / dur) ** 2.2
    x = (tone + air * 0.5) * ramp
    x[-int(SR * 0.02):] *= np.linspace(1, 0, int(SR * 0.02))
    return _norm(x, -4)


def impact(seed=7, dur=1.6):
    n = int(SR * dur)
    t = _t(dur)
    f = 45 + 80 * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * _env(n, 0.002, 0.45)
    crack = _lp(_noise(n, seed), 4000) * _env(n, 0.0005, 0.06) * 0.6
    tail = _lp(_noise(n, seed + 1), 900) * _env(n, 0.01, 0.6) * 0.25
    return _norm(np.tanh((sub + crack + tail) * 1.6), -2)


def chime(seed=8):
    d = 1.1
    t = _t(d)
    out = np.zeros(len(t))
    for start, f in ((0.0, 1318.5), (0.09, 1975.5)):  # E6 → B6
        m = t >= start
        tt = t[m] - start
        e = np.exp(-tt / 0.35) * np.clip(tt / 0.002, 0, 1)
        out[m] += (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt) + 0.1 * np.sin(2 * np.pi * 3.01 * f * tt)) * e
    return _norm(out, -4)


def toggle(seed=9):
    a = tick(seed)
    b = tick(seed + 1) * 0.8
    gap = int(SR * 0.045)
    out = np.zeros(len(a) + gap)
    out[: len(a)] += a
    out[gap: gap + len(b)] += b
    return _norm(out, -4)


def glitch(seed=10, dur=0.45):
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    out = np.zeros(n)
    pos = 0
    while pos < n:
        ln = int(SR * rng.uniform(0.012, 0.05))
        f = rng.choice([220, 440, 880, 1760, 3520])
        seg = np.sign(np.sin(2 * np.pi * f * np.arange(ln) / SR)) * rng.uniform(0.3, 1)
        if rng.random() < 0.4:
            seg = _noise(ln, int(rng.integers(1e6))) * 0.6
        out[pos: pos + ln] = seg[: max(0, min(ln, n - pos))]
        pos += ln + int(SR * rng.uniform(0, 0.02))
    return _norm(_lp(out, 7000) * np.linspace(1, 0.3, n), -6)


def shimmer(seed=11, dur=1.4):
    rng = np.random.default_rng(seed)
    t = _t(dur)
    out = np.zeros(len(t))
    for _ in range(26):
        st = rng.uniform(0, dur * 0.6)
        f = rng.choice([1567.98, 1975.53, 2349.32, 2637.02, 3135.96, 3951.07])
        m = t >= st
        tt = t[m] - st
        out[m] += np.sin(2 * np.pi * f * tt) * np.exp(-tt / rng.uniform(0.08, 0.3)) * rng.uniform(0.3, 1)
    return _norm(out * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.5, -6)


RECIPES = {
    "click": click, "tick": tick, "type": type_, "pop": pop,
    "whoosh": whoosh, "whoosh-soft": lambda seed=12: whoosh(seed, 0.8, soft=True),
    "riser": riser, "impact": impact, "chime": chime, "toggle": toggle,
    "glitch": glitch, "shimmer": shimmer,
}


def sfx(name):
    base = name.split(":")[0]
    seed = zlib.crc32(name.encode()) % 100000
    fn = RECIPES.get(base)
    if fn is None:
        # Unknown name: pick the closest-sounding family so the render never goes silent.
        lname = base.lower()
        fn = (whoosh if any(k in lname for k in ("swoosh", "swish", "transition", "slide")) else
              impact if any(k in lname for k in ("hit", "boom", "logo", "bass", "drop")) else
              chime if any(k in lname for k in ("success", "notify", "ding", "bell")) else
              riser if "rise" in lname or "build" in lname else pop)
    return fn(seed=seed)


# ───────────────────────────── placeholder music ─────────────────────────────
def _saw(ph):
    return 2 * ((ph / (2 * np.pi)) % 1) - 1


def music(bpm=120, seconds=30.0, mood="bright", seed=21):
    """Beat-locked bed: kick on the beat, hats on offbeats, pad + bass chord loop.
    Beat 0 lands exactly at t=0, so meta.beatOffset = 0 with this bed."""
    beat = 60.0 / bpm
    n = int(SR * (seconds + 1.5))
    t = np.arange(n) / SR
    out = np.zeros(n)
    prog = {
        "bright": [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [67, 72, 76]), (55, [67, 71, 74])],
        "dark": [(45, [57, 60, 64]), (41, [57, 60, 65]), (43, [55, 59, 62]), (40, [55, 59, 64])],
        "chill": [(50, [62, 65, 69, 72]), (55, [62, 67, 71, 74]), (48, [60, 64, 67, 71]), (45, [60, 64, 69, 72])],
    }.get(mood, None) or [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [67, 72, 76]), (55, [67, 71, 74])]
    hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
    bar = beat * 4
    total_beats = int(np.ceil(seconds / beat)) + 2
    intro_beats = 4  # sparse first bar: pad only

    # pad + bass
    for b in range(0, total_beats, 4):
        root, chord = prog[(b // 4) % len(prog)]
        st = b * beat
        m = (t >= st) & (t < st + bar + 0.3)
        tt = t[m] - st
        env = np.clip(tt / 0.25, 0, 1) * np.clip((bar + 0.3 - tt) / 0.3, 0, 1)
        pad = sum(_saw(2 * np.pi * hz(k) * tt * (1 + d)) for k in chord for d in (-0.004, 0.004))
        out[m] += pad * env * 0.05
        if b >= intro_beats:
            for step in range(8):
                s0 = step * beat / 2
                mm = (tt >= s0) & (tt < s0 + beat / 2)
                ts = tt[mm] - s0
                out[np.where(m)[0][mm]] += np.sin(2 * np.pi * hz(root - 12) * ts) * np.exp(-ts / 0.18) * 0.28
    out = _lp(out, 2600 if mood != "bright" else 4200)

    # drums
    kick_len = int(SR * 0.35)
    kt = np.arange(kick_len) / SR
    kick = np.sin(2 * np.pi * np.cumsum(48 + 110 * np.exp(-kt / 0.03)) / SR) * np.exp(-kt / 0.16)
    hat_len = int(SR * 0.06)
    hat = _hp(_noise(hat_len, seed), 7000) * np.exp(-np.arange(hat_len) / SR / 0.015)
    clap_len = int(SR * 0.2)
    clap = _bp(_noise(clap_len, seed + 3), 900, 5000) * np.exp(-np.arange(clap_len) / SR / 0.06)
    for b in range(intro_beats, total_beats):
        i = int(b * beat * SR)
        if i + kick_len < n:
            out[i: i + kick_len] += kick * 0.55
        j = int((b + 0.5) * beat * SR)
        if j + hat_len < n:
            out[j: j + hat_len] += hat * 0.12
        if b % 2 == 1 and i + clap_len < n and mood != "chill":
            out[i: i + clap_len] += clap * 0.18

    out = np.tanh(out * 1.3)
    fade = int(SR * 1.2)
    end = int(SR * seconds)
    out[end - fade: end] *= np.linspace(1, 0, fade)
    out[end:] = 0
    return _norm(out[: end], -3)


def write_wav(path, x, stereo=True):
    x = np.clip(x, -1, 1)
    data = np.stack([x, x], axis=1) if stereo and x.ndim == 1 else x
    with wave.open(path, "wb") as w:
        w.setnchannels(2 if stereo else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((data * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "sfx":
        write_wav(sys.argv[3], sfx(sys.argv[2]))
    elif len(sys.argv) >= 5 and sys.argv[1] == "music":
        mood = sys.argv[sys.argv.index("--mood") + 1] if "--mood" in sys.argv else "bright"
        write_wav(sys.argv[4], music(float(sys.argv[2]), float(sys.argv[3]), mood))
    else:
        print(__doc__)
        sys.exit(1)
