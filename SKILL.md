---
name: cinereel
description: Produce motion-designed SaaS launch videos, product explainers, and app promo reels (MP4 with music, sound effects, optional voiceover) from real UI screens — Claude Design canvases, live sites, Next.js repos, or screenshots. Animates individual DOM elements (count-ups, bar charts, typing, cursor clicks, camera pushes) on a single beat-locked timeline that also drives the audio, so every click, whoosh and cut lands on the frame. Uses ElevenLabs for music/SFX/VO when ELEVENLABS_API_KEY is set, with a built-in synth fallback. Use this skill whenever the user wants a launch video, product video, demo reel, feature announcement video, "motion design" for an app, an animated walkthrough of a dashboard, or to turn designs/screens into a video — even if they don't say "motion graphics".
---

# cinereel

**One clock. Picture and sound read the same timeline.**

A launch video is a set of real UI screens (HTML/CSS) animated by `timeline.js`. The same
timeline produces the audio cue sheet, so SFX are placed sample-accurately on the frames that
trigger them, and beat-addressed events (`"b12"`) re-time themselves when the music's real tempo
is known. Rendering is deterministic: headless Chromium calls `renderFrame(t)` for each frame and
pipes it straight into FFmpeg.

```
screens (DOM) ─┐
               ├─ timeline.js ─┬─ cinereel-runtime.js ─ render.mjs ─┐
storyboard ────┘               └─ probe.mjs → cues.json             ├─ video.mp4
                                   └ build_audio.py → mix_audio.py ─┘
```

`<skill>` below means this skill's directory.

## 0. Setup (once per machine)

```bash
bash <skill>/scripts/setup.sh
```
This checks Node 18+, FFmpeg, Python (numpy, scipy, pillow, requests), Playwright and Chromium.
`ELEVENLABS_API_KEY` in the environment enables generated music, SFX and VO. Without it the
pipeline still renders, using synthesized SFX and a placeholder beat-locked music bed. Say so
plainly in the handoff.

## 1. Intake

Gather these. Ask only for what is missing, in one message, and fill the rest with defaults:

| Need | Default |
|---|---|
| Product + one-line promise | — (required) |
| Source screens: Claude Design canvas / URL / repo / screenshots / "invent them" | invent 3 screens |
| Length | 30s (15s for socials, 45–60s for explainers) |
| Aspect | 16:9 1920×1080 (9:16 1080×1920 for Reels/Shorts, 1:1 1080×1080 for feed) |
| Vibe / reference video | "confident, minimal, Apple-keynote-ish" |
| Voiceover | none. If wanted, get the script tone and an ElevenLabs voice id |
| Brand tokens (colors, fonts, logo) | pull from the source screens |

A reference video link is useful. Describe its pacing (cut frequency, camera behaviour, type
style), but do not copy its assets.

## 2. Scaffold

```bash
cp -r <skill>/assets/template ./<slug>-reel
```
The template is a complete, working 16s video (Northstar analytics). Keep its stage
primitives (`.scene`, `.cr-camera`, `#cr-overlay`, the two script tags) and replace everything
else. Do not copy the runtime into the project: the renderer serves the skill's copy.

## 3. Screens: rebuild as real DOM

Read `references/source-adapters.md` for the input type you have. For a live URL, start with
`node <skill>/scripts/grab.mjs <url> ./<slug>-reel/ref`, which captures screenshots plus the
site's real tokens (CSS variables, colors, fonts, type scale). The non-negotiables:

- Every element you will animate is its own DOM node with an `id` or a stable class. That
  is the whole trick: a flat screenshot can only be panned, while DOM can be choreographed.
- Use exact pixel layouts (fixed `1920×1080` stage). Do not use viewport units.
- Match the product's design system: the tokens from the source, or a component library the user
  names. Real products look better than invented ones, so prefer their actual screens.
- Self-host fonts in `./fonts` with `@font-face` when possible. CDN fonts work but make renders
  depend on the network.
- Never put CSS `transform`, `transition`, or `animation` on an element the timeline animates.
  Wrap it in a container instead.

## 4. Storyboard, then timeline

Read `references/storyboard.md` and draft a **beat sheet**: a compact table of scene, beats,
what the viewer sees, camera, and sound. Show it to the user when the brief was loose; skip
straight to building when they gave a detailed brief.

Then write `timeline.js`. Read `references/timeline-schema.md` for the full API and
`references/motion-principles.md` for timing and easing. Key habits:

- Address time in **beats** (`"b12"`, `"bar3"`) or scene-relative (`"dash+0.4"`), not raw seconds.
- Every scene gets a camera move. Static full-screen UI reads as a slideshow.
- Put `sfx` on the events that deserve sound. Not everything should make noise (see
  `references/audio-direction.md`).

## 5. Probe and fix

```bash
node <skill>/scripts/probe.mjs ./<slug>-reel
```
This fixes every warning: unmatched selectors, black gaps, events past the end, and unknown
anims. `build/cues.json` is the audio contract.

## 6. Look before rendering

```bash
python3 <skill>/scripts/contact_sheet.py ./<slug>-reel
```
**View `build/contact_sheet.png` yourself** and judge it as a motion designer. Check for text
clipped by the camera, empty frames, overlapping elements, unreadable type at thumbnail size,
and SFX ticks that cluster or leave long silent stretches. Fix, then re-run. This takes seconds,
while a full render takes minutes.

For fine timing, render a single moment with
`node <skill>/scripts/render.mjs ./<slug>-reel --stills 4.2,4.4,4.6`.
For a live look, open `video.html` via any static server: it previews in real time with
scrubbing keys.

## 7. Audio

```bash
python3 <skill>/scripts/build_audio.py ./<slug>-reel            # --provider synth to skip the API
```
- Music is generated at the exact duration, then **beat-analysed**. If it prints `BEAT DRIFT`,
  set `meta.bpm` / `meta.beatOffset` to the detected values, re-run `probe.mjs`, and re-run
  `build_audio.py`. The music is cached, so this costs nothing, and beat-addressed events snap
  to the real track. The detected tempo is folded to the timeline's octave, so a half-time
  reading never halves your edit. Measured result after correction: beats land within one frame
  of the track's kicks; uncorrected, a 1% tempo mismatch drifts ~370 ms over 16s.
- SFX are generated once per unique name, cached, and trimmed of leading silence. The trimming
  matters: generated SFX often start with 20–150ms of air, which makes hits feel late.
- Any ElevenLabs failure (no credits, network, 4xx) falls back to synth for that asset and says
  so. Tell the user which assets are placeholders.
- VO needs `audio.voice` (or `ELEVENLABS_VOICE_ID`). Overlapping lines are reported.
- Harsh SFX: set `audio.tone: 'soft'`, or lower per-sound `gain` in `audio.sfx`.

## 8. Mix and render

```bash
bash <skill>/scripts/cinereel.sh ./<slug>-reel                 # probe → sheet → audio → mix → render
bash <skill>/scripts/cinereel.sh ./<slug>-reel --from 6 --to 12 # iterate on one section
bash <skill>/scripts/cinereel.sh ./<slug>-reel --scale 2        # 4K master (sharper UI text)
```
The mix places every cue sample-accurately, ducks music under VO, varies pitch/gain slightly
on repeated hits, and normalises loudness to −14 LUFS for YouTube. Output: `build/video.mp4`.

A 30s 1080p render takes roughly 1.5–3 minutes. Use `--from/--to` while iterating and render
the full piece once it's right.

## 9. Handoff

Report: the MP4 path, duration/resolution, which audio came from ElevenLabs vs synth, any
beat-drift correction applied, and 2–3 specific suggestions (e.g. "the ask scene would land
harder with a VO line at b19"). Present the video and the contact sheet as files.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `__videoReady` never set | `timeline.js` threw a syntax error, or the runtime `<script>` is missing or ordered before timeline.js |
| Element never appears | Enter anims (`fadeUp`…) hold it at opacity 0 until `at`. Check `at` in the probe output |
| Element jumps / flickers | It has a CSS transform or transition. Move that to a wrapper |
| Camera focus lands off-centre | The focus target changes size or position during the scene. Focus on a stable parent |
| Cursor misses the button | The target moves with the camera, which is fine. If it is inside a scaled scene, use `offset: [dx, dy]` |
| Hits feel early or late | Run build_audio again (trims silence). Check `sfxOffset` on the track. Check beat drift |
| Fonts look wrong in render | Self-host them. CDN fonts that fail silently fall back to system fonts |
| Render slow | `--from/--to`, lower `meta.fps` to 24 for drafts, close other Chromium instances |
