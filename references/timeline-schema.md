# timeline.js reference

`timeline.js` assigns one object, `window.CINEREEL`. It is plain JS, so comments and
computed values are fine. It must not depend on the DOM.

Contents: [Time values](#time-values) · [meta](#meta) · [scenes](#scenes) · [camera](#camera) ·
[tracks](#tracks) · [anims](#anims) · [cursor](#cursor) · [audio](#audio) · [HTML contract](#html-contract)

## Time values

Anywhere a time is accepted (`start`, `end`, `at`, cursor `at`, audio `at`):

| Form | Meaning |
|---|---|
| `2.5` | absolute seconds |
| `"b12"`, `"b12.5"` | beat 12 → `beatOffset + 12 × 60/bpm` |
| `"bar3"`, `"bar3.5"` | bar 3 (× `beatsPerBar`) |
| `"dash"`, `"dash+0.4"`, `"dash-0.2"` | scene start ± seconds |
| `"dash.end-0.5"` | scene end ± seconds |
| `"+0.2"` *(tracks only)* | 0.2s after the **previous track's last element finishes** |
| `"@0.1"` *(tracks only)* | 0.1s after the **previous track started** (parallel chains) |

Durations (`dur`, `stagger`) are seconds, or `"b1"` for one beat.
Camera key `at` is **scene-relative** (seconds or `"b2"` beats). Use `abs:` for absolute.

## meta

```js
meta: {
  title: 'Product — launch',
  width: 1920, height: 1080,  // stage size in CSS px (1080×1920 vertical, 1080×1080 square)
  fps: 30,                    // 24 for drafts / filmic, 60 for very fast UI motion
  duration: 30,               // seconds — the audio mix is cut to exactly this
  bpm: 120, beatOffset: 0,    // beat grid; build_audio prints corrected values
  beatsPerBar: 4,
  accent: '#7c5cff',          // → CSS var --cr-accent (glow, cursor ripple)
  grain: 0.06,                // film grain opacity, or false
}
```

## scenes

```js
{ id: 'dash',               // matches <section class="scene" data-scene="dash">
  start: 'b6.5', end: 'b19', // or dur: 6
  label: 'Dashboard tour',   // shown in contact sheet (optional)
  in:  { type: 'zoom', dur: 0.6, ease: 'emphasized' },   // or just 'zoom'
  out: { type: 'fade', dur: 0.4 },
  sfx: 'whoosh', sfxOffset: -0.08, sfxGain: -12,          // hit on the cut
  camera: [ ... ] }
```
Transition types: `none` `cut` `fade` `slideUp` `slideLeft` `zoom` `blur` `wipe`.
Defaults: first scene enters with `none`, last exits with `none`, and all others use `fade`.
Scenes can overlap in time for crossfades. Later DOM order draws on top.
A scene is `visibility:hidden` outside `[start, end)`.

## camera

Keys inside a scene. The scene needs a direct child `.cr-camera` wrapping its content.

```js
camera: [
  { at: 0,   scale: 1.4, focus: '#kpis' },            // centre #kpis at 1.4×
  { at: 1.4, scale: 1.4, focus: '#kpis' },            // hold
  { at: 2.3, scale: 1.0, ease: 'expoInOut' },         // pull back to full frame
  { at: 'b8', scale: 1.6, focus: '#chart', offset: [0, -40] },
  { at: 5, scale: 1.1, x: -120, y: 30, rotate: -1.5 },  // manual framing
]
```
The `ease` on a key applies to the move *arriving* at that key (default `cubicInOut`).
Before the first key the camera holds that key's framing, and after the last it holds the last.
`focus` is measured once at load, at scale 1, so focus on elements whose layout doesn't move.

## tracks

One entry animates every element matched by `target`:

```js
{ target: '.kpi', anim: 'fadeUp', at: 'dash+0.15', dur: 0.6,
  stagger: 0.07, reverse: false,          // per-element delay; reverse order
  ease: 'emphasized',                     // override the anim's default
  origin: 'left center',                  // transform-origin override
  sfx: 'tick', sfxEach: true,             // one hit per element (default: first only)
  sfxGain: -14, sfxOffset: 0.03,          // dB; seconds relative to the element's start
  ...animParams }
```
Several tracks may target the same element. Their effects compose (an element can `fadeUp`,
then `pulse`, then `fadeOut`).

## anims

**Enter.** These hold the element hidden or offset before `at`, then animate it in:

| anim | params | default ease |
|---|---|---|
| `fadeIn` | — | smooth |
| `fadeUp` / `fadeDown` | `distance` (28) | emphasized |
| `slideLeft` / `slideRight` | `distance` (64) | emphasized |
| `scaleIn` | `from` (0.9) | emphasized |
| `popIn` | `from` (0.6) | backOut (overshoot) |
| `blurIn` | `amount` (14px) | smooth |
| `maskReveal` | `direction`: right/left/down/up | expoOut |
| `barGrow` | — (grows from bottom) | expoOut |
| `fillX` | — (progress bars, from left) | expoOut |

**Exit.** These leave the element in the end state after the window:
`fadeOut`, `fadeOutUp` (`distance`), `scaleOut` (`to`), `blurOut` (`amount`).

**Emphasis.** These only act inside `[at, at+dur]`:
`pulse` (`amount` 0.06), `press` (0.06), `glow` (`amount` 1, uses `--cr-accent`),
`shake` (`amount` 8px), `float` (`amount` 6px, `speed`).

**Move.** These hold their end state:
`moveBy` (`x`, `y`), `scaleTo` (`to`), `rotateTo` (`to` degrees).

**Content**

| anim | params |
|---|---|
| `countUp` | `from` (0), `to`, `decimals`, `prefix`, `suffix`, `separator` (',' or false). The element shows `from` before `at` |
| `type` | `text` (defaults to element text), `placeholder`, `caret` (true), `caretHold` (0.9s). The default `dur` is 45ms per char. With `sfx`, it adds a keystroke every `sfxEvery` (2) chars. Use `sfxMode:'once'` for a single hit. It works on inputs too |
| `draw` | Draws an SVG `<path>` stroke |
| `addClass` | `class`, `until` (time). The class is present in `[at, until)`. Use it for tab switches and active states |
| `swapText` | `text`. The new text appears from `at` |

**Text splitting:** `data-split="words"` or `"chars"` wraps each word or char in
`.cr-w` / `.cr-c` spans at load. Target them with `'#headline .cr-w'` plus `stagger`.

**Eases:** `linear` `sineInOut` `quadOut` `cubicOut` `cubicInOut` `quartOut` `expoOut`
`expoInOut` `backOut` `spring` `smooth` `emphasized` `snappy`, or a cubic-bezier array
`[x1, y1, x2, y2]`.

## cursor

```js
cursor: {
  start: [1200, 840],                 // px, default bottom-right-ish
  show: ['b12.5', 'b18.5'],           // optional; default ≈ first event − 0.35s → last + 0.9s
  fill: '#fff', stroke: '#111',
  events: [
    { at: 'b13', to: '#export', dur: 0.8, ease: 'emphasized', offset: [0, 4], arc: 1 },
    { at: 'b15', click: true, press: '#export', sfx: 'click' },   // press = auto button dip
    { at: 'b16', to: [960, 700], dur: 0.6 },
  ],
}
```
Move targets are resolved live each frame, so the cursor follows elements through camera moves.
Clicks add a ripple, a cursor squeeze, and a `click` SFX by default (`sfx: null` for silence).

## audio

```js
audio: {
  music: { prompt: 'Confident modern tech launch…', mood: 'bright', gain: -15,
           file: null,            // use your own track instead (path relative to where you run)
           trim: 0,               // skip the first N seconds of the track
           bpm: undefined,        // pin the cache key (optional)
           model: 'music_v2' },   // or music: false for no music
  tone: 'soft',                   // soft | neutral | bright — low-pass on the SFX bus
  sfx: {                          // overrides + custom sounds, keyed by name used in tracks
    click: { gain: -12 },
    'logo-hit': { prompt: 'Deep glassy synth hit with a shimmer tail', dur: 2, gain: -9 },
    swoosh2: { file: 'sfx/my-swoosh.wav' },
  },
  cues: [{ at: 'b23.4', sfx: 'riser' }],   // hits not tied to an element
  voice: '<elevenlabs voice id>', voiceModel: 'eleven_multilingual_v2',
  vo: [{ at: 'b2', text: 'Revenue data, finally legible.', gain: -3 }],
  mix: { music: 0, sfx: 0, vo: 0, duck: 8, lufs: -14, vary: true },
}
```
Built-in SFX names (ElevenLabs prompt and synth recipe included): `click` `tick` `type`
`pop` `whoosh` `whoosh-soft` `riser` `impact` `chime` `toggle` `glitch` `shimmer`.
Any other name works. It is generated from `audio.sfx[name].prompt` (or from the name itself),
and the synth picks the closest family. Use `name:variant` (e.g. `pop:2`) to get a separately
generated take of the same sound.

## HTML contract

```html
<section class="scene" data-scene="intro">
  <div class="cr-camera"> …content… </div>
</section>
<div id="cr-overlay"></div>                 <!-- cursor lives here -->
<script src="timeline.js"></script>
<script src="cinereel-runtime.js"></script>  <!-- served from the skill -->
```
The stage CSS must set `html, body { width: <W>px; height: <H>px; overflow: hidden }` and
`.scene { position:absolute; inset:0; opacity:0; visibility:hidden }`.
