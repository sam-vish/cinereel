/*!
 * cinereel-runtime.js — deterministic motion engine for launch videos.
 *
 * One clock. Picture and sound read the same timeline.
 *
 * The page defines window.CINEREEL = { meta, scenes, tracks, cursor, audio }
 * (see references/timeline-schema.md), then loads this file.
 *
 * Exposes:
 *   window.renderFrame(ms)     pure function of time; called once per frame by the renderer
 *   window.__videoReady        true once fonts/images are loaded and layout is measured
 *   window.__stopPreview()     stops the in-browser preview loop before capture
 *   window.__cinereelReport    { meta, scenes, cues, vo, warnings } consumed by probe.mjs
 *
 * Rules that keep it deterministic:
 *   - No CSS @keyframes / transitions on anything the timeline animates.
 *   - Every style write happens inside renderFrame, derived only from `t`.
 *   - Never put a CSS transform on an element the timeline animates (wrap it instead).
 */
(function () {
  'use strict';

  const CR = window.CINEREEL;
  if (!CR || !CR.meta) {
    console.error('[cinereel] window.CINEREEL is missing. Load timeline.js before the runtime.');
    return;
  }

  const RENDER_MODE = /[?&]render=1/.test(location.search);
  const meta = Object.assign(
    { width: 1920, height: 1080, fps: 30, duration: 30, bpm: 120, beatOffset: 0, beatsPerBar: 4, accent: '#7c5cff' },
    CR.meta
  );
  const W = meta.width, H = meta.height;
  const DURATION_MS = meta.duration * 1000;
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };

  document.documentElement.style.setProperty('--cr-accent', meta.accent);

  // ───────────────────────────── math + easing ─────────────────────────────
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-5) break;
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      return sy(clamp(t, 0, 1));
    };
  }

  const EASE = {
    linear: (t) => t,
    sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    quadOut: (t) => 1 - (1 - t) * (1 - t),
    cubicOut: (t) => 1 - Math.pow(1 - t, 3),
    cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    quartOut: (t) => 1 - Math.pow(1 - t, 4),
    expoOut: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    expoInOut: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    backOut: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    // Damped spring normalised to land exactly on 1.
    spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(9 * t)),
    // Apple-style "standard" curves.
    smooth: bezier(0.25, 0.1, 0.25, 1),
    emphasized: bezier(0.2, 0, 0, 1),
    snappy: bezier(0.32, 0.72, 0, 1),
  };
  function ease(name, fallback) {
    const e = name == null ? fallback : name;
    if (Array.isArray(e)) return bezier(e[0], e[1], e[2], e[3]);
    if (!EASE[e]) { warn(`Unknown ease "${e}", using cubicOut`); return EASE.cubicOut; }
    return EASE[e];
  }

  // ───────────────────────────── time resolution ─────────────────────────────
  // Accepts: 2.5 (seconds) | "b12" (beat) | "bar3" | "bar3.5" | "s2" | "s2+0.4" | "s2-0.2"
  const beatSec = 60 / meta.bpm;
  const sceneStart = {};
  const sceneEnd = {};

  function resolveTime(v, ctx) {
    if (v == null) return null;
    if (typeof v === 'number') return v * 1000;
    const s = String(v).trim();
    let m;
    if ((m = /^b(-?\d+(?:\.\d+)?)$/.exec(s))) return (meta.beatOffset + parseFloat(m[1]) * beatSec) * 1000;
    if ((m = /^bar(-?\d+(?:\.\d+)?)$/.exec(s)))
      return (meta.beatOffset + parseFloat(m[1]) * meta.beatsPerBar * beatSec) * 1000;
    if ((m = /^([A-Za-z_][\w-]*)(?:\.(end))?([+-]\d*\.?\d+)?$/.exec(s))) {
      const id = m[1];
      const base = m[2] === 'end' ? sceneEnd[id] : sceneStart[id];
      if (base == null) { warn(`Time "${s}" references unknown scene "${id}"${ctx ? ' in ' + ctx : ''}`); return 0; }
      return base + (m[3] ? parseFloat(m[3]) * 1000 : 0);
    }
    if ((m = /^-?\d*\.?\d+$/.exec(s))) return parseFloat(s) * 1000;
    warn(`Unparseable time "${s}"${ctx ? ' in ' + ctx : ''}`);
    return 0;
  }
  const resolveDur = (v, d) => (v == null ? d : typeof v === 'string' && /^b/.test(v)
    ? parseFloat(v.slice(1)) * beatSec * 1000 : v * 1000);

  // ───────────────────────────── scenes ─────────────────────────────
  const scenes = (CR.scenes || []).map((sc, i) => {
    const el = document.querySelector(`[data-scene="${sc.id}"]`);
    if (!el) warn(`Scene "${sc.id}" has no element [data-scene="${sc.id}"]`);
    return { i, def: sc, el, cam: el ? el.querySelector(':scope > .cr-camera') : null };
  });
  // Two passes so scenes can reference earlier scenes ("s1.end").
  for (const s of scenes) {
    const st = resolveTime(s.def.start, `scene ${s.def.id}`);
    sceneStart[s.def.id] = st;
    const en = s.def.end != null ? resolveTime(s.def.end, `scene ${s.def.id}`) : st + resolveDur(s.def.dur, 3000);
    sceneEnd[s.def.id] = en;
    s.start = st; s.end = en;
    if (en <= st) warn(`Scene "${s.def.id}" ends before it starts`);
    if (st > DURATION_MS) warn(`Scene "${s.def.id}" starts after meta.duration`);
    const norm = (x, dflt) => (typeof x === 'string' ? { type: x } : Object.assign({}, dflt, x || {}));
    s.in = norm(s.def.in, { type: st === 0 ? 'none' : 'fade' });
    s.out = norm(s.def.out, { type: en >= DURATION_MS ? 'none' : 'fade' });
    s.in.ms = resolveDur(s.in.dur, 450);
    s.out.ms = resolveDur(s.out.dur, 400);
  }

  function transitionState(type, p, entering) {
    // p: 0 = fully out, 1 = fully in
    const st = { o: 1, x: 0, y: 0, s: 1, blur: 0, clip: null };
    switch (type) {
      case 'none': break;
      case 'fade': st.o = p; break;
      case 'slideUp': st.o = p; st.y = (1 - p) * (entering ? 80 : -80); break;
      case 'slideLeft': st.o = p; st.x = (1 - p) * (entering ? 160 : -160); break;
      case 'zoom': st.o = p; st.s = entering ? lerp(1.08, 1, p) : lerp(0.96, 1, p); break;
      case 'blur': st.o = p; st.blur = (1 - p) * 24; break;
      case 'wipe': st.clip = entering ? `inset(0 ${(1 - p) * 100}% 0 0)` : `inset(0 0 0 ${(1 - p) * 100}%)`; break;
      case 'cut': st.o = p > 0 ? 1 : 0; break;
      default: warn(`Unknown scene transition "${type}"`); st.o = p;
    }
    return st;
  }

  function renderScenes(t) {
    for (const s of scenes) {
      if (!s.el) continue;
      const style = s.el.style;
      if (t < s.start || t >= s.end) { style.opacity = '0'; style.visibility = 'hidden'; continue; }
      style.visibility = 'visible';
      let st = { o: 1, x: 0, y: 0, s: 1, blur: 0, clip: null };
      if (t < s.start + s.in.ms && s.in.type !== 'none') {
        const p = ease(s.in.ease, 'emphasized')(clamp((t - s.start) / s.in.ms, 0, 1));
        st = transitionState(s.in.type, p, true);
      } else if (t >= s.end - s.out.ms && s.out.type !== 'none') {
        const p = ease(s.out.ease, 'smooth')(clamp((s.end - t) / s.out.ms, 0, 1));
        st = transitionState(s.out.type, p, false);
      }
      style.opacity = String(st.o);
      style.transform = `translate(${st.x.toFixed(2)}px,${st.y.toFixed(2)}px) scale(${st.s.toFixed(4)})`;
      style.filter = st.blur > 0.01 ? `blur(${st.blur.toFixed(2)}px)` : '';
      style.clipPath = st.clip || '';
    }
  }

  // ───────────────────────────── camera ─────────────────────────────
  function prepareCameras() {
    for (const s of scenes) {
      if (!s.cam) { if (s.def.camera) warn(`Scene "${s.def.id}" has camera keys but no child .cr-camera`); continue; }
      s.cam.style.transformOrigin = `${W / 2}px ${H / 2}px`;
      s.cam.style.transform = 'none';
      const camRect = s.cam.getBoundingClientRect();
      s.keys = (s.def.camera || []).map((k, i) => {
        const key = Object.assign({ scale: 1, x: 0, y: 0, rotate: 0 }, k);
        key.t = k.abs != null ? resolveTime(k.abs) : s.start + resolveDur(k.at, 0);
        if (typeof k.at === 'string' && !/^b/.test(k.at)) key.t = resolveTime(k.at, `camera key ${i} of ${s.def.id}`);
        if (k.focus) {
          const el = s.cam.querySelector(k.focus) || document.querySelector(k.focus);
          if (!el) { warn(`Camera focus "${k.focus}" not found in scene ${s.def.id}`); }
          else {
            const r = el.getBoundingClientRect();
            const cx = r.left - camRect.left + r.width / 2;
            const cy = r.top - camRect.top + r.height / 2;
            const off = k.offset || [0, 0];
            key.x = -(cx - W / 2) * key.scale + off[0];
            key.y = -(cy - H / 2) * key.scale + off[1];
          }
        }
        return key;
      }).sort((a, b) => a.t - b.t);
    }
  }

  function renderCameras(t) {
    for (const s of scenes) {
      if (!s.cam || !s.keys || !s.keys.length) continue;
      const K = s.keys;
      let cur;
      if (t <= K[0].t) cur = K[0];
      else if (t >= K[K.length - 1].t) cur = K[K.length - 1];
      else {
        let i = 0;
        while (i < K.length - 1 && !(t >= K[i].t && t < K[i + 1].t)) i++;
        const a = K[i], b = K[i + 1];
        const p = ease(b.ease, 'cubicInOut')((t - a.t) / (b.t - a.t));
        cur = { scale: lerp(a.scale, b.scale, p), x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), rotate: lerp(a.rotate, b.rotate, p) };
      }
      s.cam.style.transform =
        `translate(${cur.x.toFixed(2)}px,${cur.y.toFixed(2)}px) scale(${cur.scale.toFixed(4)}) rotate(${cur.rotate.toFixed(3)}deg)`;
    }
  }

  // ───────────────────────────── element animations ─────────────────────────────
  const bump = (raw) => Math.sin(Math.PI * clamp(raw, 0, 1));
  const ANIMS = {
    // enters
    fadeIn: { ease: 'smooth', apply: (s, p) => { s.o *= p; } },
    fadeUp: { ease: 'emphasized', apply: (s, p, it) => { s.o *= p; s.y += (1 - p) * (it.distance ?? 28); } },
    fadeDown: { ease: 'emphasized', apply: (s, p, it) => { s.o *= p; s.y -= (1 - p) * (it.distance ?? 28); } },
    slideLeft: { ease: 'emphasized', apply: (s, p, it) => { s.o *= p; s.x += (1 - p) * (it.distance ?? 64); } },
    slideRight: { ease: 'emphasized', apply: (s, p, it) => { s.o *= p; s.x -= (1 - p) * (it.distance ?? 64); } },
    scaleIn: { ease: 'emphasized', apply: (s, p, it) => { s.o *= p; s.s *= lerp(it.from ?? 0.9, 1, p); } },
    popIn: { ease: 'backOut', apply: (s, p, it, raw) => { s.o *= clamp(raw * 4, 0, 1); s.s *= lerp(it.from ?? 0.6, 1, p); } },
    blurIn: { ease: 'smooth', apply: (s, p, it) => { s.o *= p; s.blur += (1 - p) * (it.amount ?? 14); s.s *= lerp(1.04, 1, p); } },
    maskReveal: {
      ease: 'expoOut',
      apply: (s, p, it) => {
        const d = it.direction || 'right';
        if (d === 'right') s.clip[1] += (1 - p) * 100;
        else if (d === 'left') s.clip[3] += (1 - p) * 100;
        else if (d === 'down') s.clip[2] += (1 - p) * 100;
        else s.clip[0] += (1 - p) * 100;
      },
    },
    barGrow: { ease: 'expoOut', origin: 'bottom center', apply: (s, p) => { s.sy *= p; } },
    fillX: { ease: 'expoOut', origin: 'left center', apply: (s, p) => { s.sx *= p; } },
    // exits
    fadeOut: { ease: 'smooth', apply: (s, p) => { s.o *= 1 - p; } },
    fadeOutUp: { ease: 'smooth', apply: (s, p, it) => { s.o *= 1 - p; s.y -= p * (it.distance ?? 24); } },
    scaleOut: { ease: 'smooth', apply: (s, p, it) => { s.o *= 1 - p; s.s *= lerp(1, it.to ?? 0.92, p); } },
    blurOut: { ease: 'smooth', apply: (s, p, it) => { s.o *= 1 - p; s.blur += p * (it.amount ?? 14); } },
    // emphasis (only active inside the window)
    pulse: { ease: 'linear', window: true, apply: (s, p, it, raw) => { s.s *= 1 + (it.amount ?? 0.06) * bump(raw); } },
    press: { ease: 'linear', window: true, apply: (s, p, it, raw) => { s.s *= 1 - (it.amount ?? 0.06) * bump(raw); } },
    glow: { ease: 'linear', window: true, apply: (s, p, it, raw) => { s.glow = Math.max(s.glow, bump(raw) * (it.amount ?? 1)); } },
    shake: { ease: 'linear', window: true, apply: (s, p, it, raw) => { s.x += Math.sin(raw * Math.PI * 8) * (it.amount ?? 8) * (1 - raw); } },
    float: { ease: 'linear', window: true, apply: (s, p, it, raw, lt) => { s.y += Math.sin(lt / 1000 * (it.speed ?? 1.4)) * (it.amount ?? 6); } },
    // continuous moves that hold their end state
    moveBy: { ease: 'emphasized', apply: (s, p, it) => { s.x += (it.x || 0) * p; s.y += (it.y || 0) * p; } },
    scaleTo: { ease: 'emphasized', apply: (s, p, it) => { s.s *= lerp(1, it.to ?? 1.1, p); } },
    rotateTo: { ease: 'emphasized', apply: (s, p, it) => { s.r += (it.to ?? 0) * p; } },
    // content
    countUp: { ease: 'expoOut', content: true },
    type: { ease: 'linear', content: true },
    draw: { ease: 'cubicInOut', content: true },
    addClass: { content: true },
    swapText: { content: true },
  };

  function formatNumber(v, it) {
    const dec = it.decimals ?? 0;
    let str = Math.abs(v).toFixed(dec);
    if (it.separator !== false) {
      const [a, b] = str.split('.');
      str = a.replace(/\B(?=(\d{3})+(?!\d))/g, it.separator || ',') + (b ? '.' + b : '');
    }
    return (v < 0 ? '-' : '') + (it.prefix || '') + str + (it.suffix || '');
  }

  // Split text into spans before targets are collected: data-split="words" | "chars" | "lines-as-is"
  function splitText() {
    document.querySelectorAll('[data-split]').forEach((el) => {
      const mode = el.getAttribute('data-split');
      const text = el.textContent;
      el.textContent = '';
      const parts = mode === 'chars' ? Array.from(text) : text.split(/(\s+)/);
      for (const part of parts) {
        if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); continue; }
        if (!part) continue;
        const span = document.createElement('span');
        span.className = mode === 'chars' ? 'cr-c' : 'cr-w';
        span.style.display = 'inline-block';
        span.textContent = part;
        el.appendChild(span);
      }
    });
  }

  // Expanded items: one per (element, track)
  const items = [];
  const elementsTouched = new Map(); // el -> { items: [], hasTransform, hasOpacity, ... }

  function prepareTracks() {
    let prevStart = 0, prevEnd = 0;
    (CR.tracks || []).forEach((tr, ti) => {
      const ctx = `track ${ti} (${tr.anim} ${tr.target})`;
      const def = ANIMS[tr.anim];
      if (!def) { warn(`Unknown anim "${tr.anim}" in ${ctx}`); return; }
      let at;
      if (typeof tr.at === 'string' && tr.at.startsWith('+')) at = prevEnd + parseFloat(tr.at.slice(1)) * 1000;
      else if (typeof tr.at === 'string' && tr.at.startsWith('@')) at = prevStart + parseFloat(tr.at.slice(1)) * 1000;
      else at = resolveTime(tr.at ?? 0, ctx);
      const dur = resolveDur(tr.dur, tr.anim === 'type' ? ((tr.text || '').length * 45) : 600);
      const stagger = resolveDur(tr.stagger, 0);
      const els = Array.from(document.querySelectorAll(tr.target));
      if (!els.length) { warn(`Target "${tr.target}" matched nothing in ${ctx}`); }
      const order = tr.reverse ? els.slice().reverse() : els;
      order.forEach((el, i) => {
        const it = Object.assign({}, tr, { el, at: at + i * stagger, ms: dur, idx: i, def, easeFn: ease(tr.ease, def.ease || 'linear') });
        if (at + i * stagger > DURATION_MS) warn(`${ctx} starts after meta.duration`);
        if (def.origin && !el.style.transformOrigin) el.style.transformOrigin = def.origin;
        if (tr.origin) el.style.transformOrigin = tr.origin;
        if (tr.anim === 'type') {
          it.fullText = tr.text != null ? tr.text : el.textContent;
          it.isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
          it.placeholder = tr.placeholder ?? '';
        }
        if (tr.anim === 'swapText') it.before = el.textContent;
        if (tr.anim === 'draw') {
          try { it.len = el.getTotalLength(); el.style.strokeDasharray = `${it.len}`; } catch (e) { warn(`draw target is not an SVG path in ${ctx}`); }
        }
        items.push(it);
        if (!elementsTouched.has(el)) elementsTouched.set(el, { items: [], transform: false, opacity: false, filter: false, clip: false, glow: false });
        const rec = elementsTouched.get(el);
        rec.items.push(it);
        if (!def.content) {
          const probe = { o: 1, x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, blur: 0, clip: [0, 0, 0, 0], glow: 0 };
          // Sample a couple of points to learn which properties this anim touches.
          for (const p of [0, 0.5]) def.apply(probe, p, it, p, 0);
          if (probe.o !== 1) rec.opacity = true;
          if (probe.x || probe.y || probe.s !== 1 || probe.sx !== 1 || probe.sy !== 1 || probe.r) rec.transform = true;
          if (probe.blur) rec.filter = true;
          if (probe.clip.some((v) => v)) rec.clip = true;
          if (tr.anim === 'glow') rec.glow = true;
          if (['pulse', 'press', 'shake', 'float', 'rotateTo', 'moveBy', 'scaleTo'].includes(tr.anim)) rec.transform = true;
        }
      });
      prevStart = at;
      prevEnd = at + (els.length ? (els.length - 1) * stagger : 0) + dur;
    });
  }

  function renderElements(t) {
    for (const [el, rec] of elementsTouched) {
      const s = { o: 1, x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, blur: 0, clip: [0, 0, 0, 0], glow: 0 };
      for (const it of rec.items) {
        const raw = it.ms > 0 ? clamp((t - it.at) / it.ms, 0, 1) : (t >= it.at ? 1 : 0);
        const def = it.def;
        if (def.content) { renderContent(it, t, raw); continue; }
        if (def.window && (t < it.at || t > it.at + it.ms)) continue;
        def.apply(s, it.easeFn(raw), it, raw, t - it.at);
      }
      const st = el.style;
      if (rec.opacity) st.opacity = s.o.toFixed(4);
      if (rec.transform) {
        st.transform = `translate(${s.x.toFixed(2)}px,${s.y.toFixed(2)}px) scale(${(s.s * s.sx).toFixed(4)},${(s.s * s.sy).toFixed(4)}) rotate(${s.r.toFixed(3)}deg)`;
      }
      if (rec.filter) st.filter = s.blur > 0.01 ? `blur(${s.blur.toFixed(2)}px)` : 'none';
      if (rec.clip) st.clipPath = `inset(${s.clip.map((v) => clamp(v, 0, 100).toFixed(3) + '%').join(' ')})`;
      if (rec.glow) {
        st.boxShadow = s.glow > 0.001
          ? `0 0 0 ${(2 * s.glow).toFixed(2)}px var(--cr-accent), 0 0 ${(28 * s.glow).toFixed(1)}px color-mix(in srgb, var(--cr-accent) ${Math.round(60 * s.glow)}%, transparent)`
          : '';
      }
    }
  }

  function renderContent(it, t, raw) {
    const el = it.el;
    switch (it.anim) {
      case 'countUp': {
        const v = lerp(it.from ?? 0, it.to ?? 0, it.easeFn(raw));
        el.textContent = formatNumber(v, it);
        break;
      }
      case 'type': {
        const n = t < it.at ? 0 : Math.round(it.fullText.length * raw);
        const shown = n === 0 && t < it.at ? it.placeholder : it.fullText.slice(0, n);
        const caretOn = it.caret !== false && t >= it.at && (raw < 1 || Math.floor((t - it.at - it.ms) / 530) % 2 === 0) &&
          t < it.at + it.ms + (it.caretHold ?? 900);
        if (it.isInput) el.value = shown;
        else el.textContent = shown + (caretOn ? '▍' : '');
        break;
      }
      case 'draw': {
        if (it.len != null) el.style.strokeDashoffset = String(it.len * (1 - it.easeFn(raw)));
        break;
      }
      case 'addClass': {
        const until = it.until != null ? resolveTime(it.until) : Infinity;
        el.classList.toggle(it.class, t >= it.at && t < until);
        break;
      }
      case 'swapText': {
        el.textContent = t >= it.at ? it.text : it.before;
        break;
      }
    }
  }

  // ───────────────────────────── cursor ─────────────────────────────
  let cursor = null;
  let stageScale = 1; // preview fit-to-window scale; always 1 when rendering
  function prepareCursor() {
    const C = CR.cursor;
    if (!C || !C.events || !C.events.length) return;
    const overlay = document.getElementById('cr-overlay') || (() => {
      const o = document.createElement('div'); o.id = 'cr-overlay'; document.body.appendChild(o); return o;
    })();
    const el = document.createElement('div');
    el.id = 'cr-cursor';
    el.innerHTML =
      '<svg width="34" height="34" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))">' +
      '<path d="M4 2.5 L4 19.5 L8.6 15.4 L11.7 22 L14.6 20.7 L11.6 14.3 L17.8 14.3 Z" fill="' + (C.fill || '#fff') + '" stroke="' + (C.stroke || '#111') + '" stroke-width="1.3" stroke-linejoin="round"/></svg>' +
      '<div class="cr-ripple"></div>';
    el.style.cssText = 'position:absolute;left:0;top:0;width:34px;height:34px;pointer-events:none;will-change:transform,opacity;transform-origin:4px 3px;z-index:9999;';
    const rip = el.querySelector('.cr-ripple');
    rip.style.cssText = 'position:absolute;left:-18px;top:-19px;width:44px;height:44px;border-radius:50%;border:2px solid var(--cr-accent);background:color-mix(in srgb, var(--cr-accent) 25%, transparent);opacity:0;';
    overlay.appendChild(el);

    const events = C.events.map((e, i) => {
      const ev = Object.assign({}, e);
      ev.t = resolveTime(e.at, `cursor event ${i}`);
      ev.ms = resolveDur(e.dur, e.click ? 260 : 750);
      if (e.to && typeof e.to === 'string' && !document.querySelector(e.to)) warn(`Cursor target "${e.to}" not found`);
      return ev;
    }).sort((a, b) => a.t - b.t);

    // Auto-press the clicked element for a tactile feel.
    for (const ev of events) {
      if (ev.click && ev.press) {
        const pel = document.querySelector(ev.press);
        if (!pel) { warn(`Cursor press target "${ev.press}" not found`); continue; }
        const it = { anim: 'press', el: pel, at: ev.t, ms: 240, def: ANIMS.press, easeFn: EASE.linear, amount: 0.05 };
        items.push(it);
        if (!elementsTouched.has(pel)) elementsTouched.set(pel, { items: [], transform: true, opacity: false, filter: false, clip: false, glow: false });
        const rec = elementsTouched.get(pel); rec.items.push(it); rec.transform = true;
      }
    }
    const first = events[0].t, last = events[events.length - 1].t + events[events.length - 1].ms;
    const show = C.show ? C.show.map((v) => resolveTime(v)) : [Math.max(0, first - 350), last + 900];
    cursor = { el, rip, events, show, start: C.start || [W * 0.62, H * 0.78] };
  }

  function pointOf(target) {
    if (Array.isArray(target)) return target;
    const el = document.querySelector(target);
    if (!el) return [W / 2, H / 2];
    const r = el.getBoundingClientRect();
    return [(r.left + r.width / 2) / stageScale, (r.top + r.height / 2) / stageScale];
  }

  function renderCursor(t) {
    if (!cursor) return;
    const { el, rip, events, show } = cursor;
    let pos = cursor.start.slice();
    let scale = 1;
    let ripple = -1;
    for (const ev of events) {
      if (ev.to != null) {
        const off = ev.offset || [0, 0];
        const tgt = pointOf(ev.to);
        const dst = [tgt[0] + off[0], tgt[1] + off[1]];
        if (t >= ev.t + ev.ms) { pos = dst; continue; }
        if (t > ev.t) {
          const p = ease(ev.ease, 'emphasized')((t - ev.t) / ev.ms);
          const dx = dst[0] - pos[0], dy = dst[1] - pos[1];
          const dist = Math.hypot(dx, dy) || 1;
          const arc = Math.sin(Math.PI * p) * Math.min(90, dist * 0.12) * (ev.arc ?? 1);
          pos = [lerp(pos[0], dst[0], p) + (-dy / dist) * arc, lerp(pos[1], dst[1], p) + (dx / dist) * arc];
        }
        break;
      }
    }
    for (const ev of events) {
      if (!ev.click) continue;
      if (t >= ev.t && t <= ev.t + ev.ms) scale = Math.min(scale, 1 - 0.18 * bump((t - ev.t) / ev.ms));
      const rp = (t - ev.t) / 520;
      if (rp >= 0 && rp <= 1) ripple = ripple < 0 ? rp : Math.min(ripple, rp);
    }
    let o = 1;
    if (t < show[0] || t > show[1]) o = 0;
    else o = Math.min(clamp((t - show[0]) / 250, 0, 1), clamp((show[1] - t) / 250, 0, 1));
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translate(${(pos[0] - 4).toFixed(2)}px,${(pos[1] - 3).toFixed(2)}px) scale(${scale.toFixed(3)})`;
    if (ripple >= 0) {
      rip.style.opacity = (0.9 * (1 - ripple)).toFixed(3);
      rip.style.transform = `scale(${(0.3 + ripple * 1.5).toFixed(3)})`;
    } else rip.style.opacity = '0';
  }

  // ───────────────────────────── film layer ─────────────────────────────
  let grainEl = null;
  function prepareGrain() {
    if (!meta.grain) return;
    grainEl = document.createElement('div');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='.55'/></svg>`;
    grainEl.style.cssText = `position:absolute;inset:-220px;pointer-events:none;z-index:10000;mix-blend-mode:overlay;opacity:${meta.grain === true ? 0.08 : meta.grain};background-image:url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}");`;
    document.body.appendChild(grainEl);
  }
  function renderGrain(t) {
    if (!grainEl) return;
    const f = Math.floor(t / (1000 / 12)); // 12fps grain reads as film, not noise
    const x = (f * 73) % 220, y = (f * 151) % 220;
    grainEl.style.transform = `translate(${x}px,${y}px)`;
  }

  // ───────────────────────────── cues (the audio contract) ─────────────────────────────
  function buildReport() {
    const cues = [];
    const push = (t, sfx, extra) => { if (sfx) cues.push(Object.assign({ t: Math.round(t), sfx }, extra || {})); };
    for (const it of items) {
      if (!it.sfx) continue;
      if (it.anim === 'type' && it.sfxMode !== 'once') {
        const every = it.sfxEvery ?? 2;
        const len = Math.max(1, it.fullText.length);
        for (let k = 0; k < Math.ceil(len / every); k++) push(it.at + ((k * every) / len) * it.ms, it.sfx, { gain: it.sfxGain, vary: true, src: 'type' });
        continue;
      }
      if (it.idx > 0 && !it.sfxEach) continue;
      push(it.at + (it.sfxOffset ?? 0) * 1000, it.sfx, { gain: it.sfxGain, vary: !!it.sfxEach, src: it.anim });
    }
    for (const s of scenes) {
      if (s.def.sfx) push(s.start + (s.def.sfxOffset ?? -0.08) * 1000, s.def.sfx, { gain: s.def.sfxGain, src: `scene:${s.def.id}` });
    }
    if (cursor) for (const ev of cursor.events) if (ev.click) push(ev.t, ev.sfx === undefined ? 'click' : ev.sfx, { gain: ev.sfxGain, vary: true, src: 'click' });
    const A = CR.audio || {};
    (A.cues || []).forEach((c, i) => push(resolveTime(c.at, `audio cue ${i}`), c.sfx, { gain: c.gain, src: 'manual' }));
    cues.sort((a, b) => a.t - b.t);
    const clean = [];
    for (const c of cues) {
      if (c.t < 0 || c.t > DURATION_MS) { warn(`SFX "${c.sfx}" at ${c.t}ms is outside the video`); continue; }
      const prev = clean[clean.length - 1];
      if (prev && prev.sfx === c.sfx && c.t - prev.t < (c.src === 'type' ? 40 : 70)) continue; // de-dupe machine-gun hits
      clean.push(c);
    }
    const vo = (A.vo || []).map((v, i) => Object.assign({}, v, { t: Math.round(resolveTime(v.at, `vo line ${i}`)) }));
    window.__cinereelReport = {
      meta,
      scenes: scenes.map((s) => ({ id: s.def.id, start: s.start, end: s.end, label: s.def.label || '' })),
      cues: clean,
      vo,
      audio: { music: A.music || null, sfx: A.sfx || {}, tone: A.tone || 'neutral', mix: A.mix || {} },
      warnings,
    };
  }

  // ───────────────────────────── main ─────────────────────────────
  window.renderFrame = function (t) {
    renderScenes(t);
    renderCameras(t);
    renderElements(t);
    renderCursor(t);
    renderGrain(t);
    if (hud) hud.textContent = `${(t / 1000).toFixed(2)}s  ·  beat ${((t / 1000 - meta.beatOffset) / beatSec).toFixed(1)}`;
  };

  let hud = null;
  let previewActive = false, rafId = null, playhead = 0, lastNow = 0, paused = false;
  window.__stopPreview = function () { previewActive = false; if (rafId != null) cancelAnimationFrame(rafId); rafId = null; };

  function startPreview() {
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:100000;font:12px/1 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.6);padding:6px 8px;border-radius:6px;';
    document.documentElement.appendChild(hud);
    const hint = document.createElement('div');
    hint.style.cssText = hud.style.cssText.replace('left:12px', 'right:12px');
    hint.textContent = 'space: play/pause · ←/→: ±1s · ,/.: ±1 frame · 0: restart';
    document.documentElement.appendChild(hint);
    previewActive = true;
    lastNow = performance.now();
    const tick = (now) => {
      if (!previewActive) return;
      if (!paused) playhead = (playhead + (now - lastNow)) % DURATION_MS;
      lastNow = now;
      window.renderFrame(playhead);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    window.addEventListener('keydown', (e) => {
      const f = 1000 / meta.fps;
      if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
      if (e.key === 'ArrowRight') playhead = Math.min(DURATION_MS - 1, playhead + 1000);
      if (e.key === 'ArrowLeft') playhead = Math.max(0, playhead - 1000);
      if (e.key === '.') { paused = true; playhead = Math.min(DURATION_MS - 1, playhead + f); }
      if (e.key === ',') { paused = true; playhead = Math.max(0, playhead - f); }
      if (e.key === '0') playhead = 0;
    });
  }

  window.__videoReady = false;
  window.__cinereelDurationMs = DURATION_MS;

  async function init() {
    document.documentElement.style.width = document.body.style.width = W + 'px';
    document.documentElement.style.height = document.body.style.height = H + 'px';
    if (!RENDER_MODE) {
      // Scale the fixed-size stage to fit the browser window for preview.
      const fit = () => {
        const k = Math.min(innerWidth / W, innerHeight / H);
        document.body.style.transformOrigin = '0 0';
        stageScale = k < 1 ? k : 1;
        document.body.style.transform = k < 1 ? `scale(${k})` : '';
      };
      fit(); addEventListener('resize', fit);
    }
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => (img.decode ? img.decode().catch(() => warn(`Image failed to load: ${img.src}`)) : null)));
    splitText();
    const prevBodyTransform = document.body.style.transform, prevScale = stageScale;
    document.body.style.transform = ''; stageScale = 1; // measure at 1:1
    prepareTracks();
    prepareCursor();
    prepareCameras();
    prepareGrain();
    document.body.style.transform = prevBodyTransform; stageScale = prevScale;
    buildReport();
    if (warnings.length) console.warn('[cinereel] ' + warnings.length + ' warning(s):\n  ' + warnings.join('\n  '));
    window.renderFrame(0);
    window.__videoReady = true;
    if (!RENDER_MODE) startPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
