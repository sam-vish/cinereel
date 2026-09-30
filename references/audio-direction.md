# Audio direction

Sound is half the perceived production value, and it is where AI-made videos most often feel
amateur: too many hits, harsh transients, and cues that are a few frames late.

## Principles

1. **Sound the cause, not every effect.** A click, a card landing, a cut, a logo. Not every
   bar in a chart or every word of a headline. Use `sfxEach` sparingly: it suits 3–5 KPI
   cards, not 12 table rows.
2. **Density curve.** Sparse at the open, busiest in the product tour, silence (or a riser)
   before the logo, then one confident impact.
3. **Soft by default.** High-pitched, sharp SFX are the most common complaint. Start with
   `tone: 'soft'` and SFX gains 8–15 dB below the music.
4. **Everything on the grid.** Big hits go on beats. The music does the rhythm, so SFX should
   never fight it.
5. **One sonic family.** Pick a palette (glassy/airy, or warm/wooden, or digital/glitchy) and
   keep all prompts in it.

## Built-in SFX: when to use them

| Name | Use for | Default gain |
|---|---|---|
| `click` | cursor clicks (added automatically) | −9 |
| `tick` | small elements, stat cards, URL reveal | −15 |
| `type` | keystrokes (auto-spaced every 2 chars) | −18 |
| `pop` | toasts, badges, logo mark | −12 |
| `whoosh` | scene cuts, big panels | −13 |
| `whoosh-soft` | headlines, cards, secondary motion | −17 |
| `riser` | 1.5–2 beats before a reveal | −15 |
| `impact` | the logo / end-card downbeat (use once or twice per video) | −10 |
| `chime` | success states | −13 |
| `toggle` | switches, tab changes | −13 |
| `glitch` | tech accents, error states | −17 |
| `shimmer` | highlights, AI "magic" moments | −17 |

## Writing ElevenLabs SFX prompts

Describe the sound as an audio engineer would: **source + character + length cue + space**.

- Good: "Single soft glassy UI tap, rounded, short, dry, close-mic, no reverb"
- Good: "Airy low whoosh passing left to right, smooth, modern motion graphics, no rumble"
- Bad: "cool sound for button" (too vague, random results)
- Bad: "epic cinematic explosion transition" (too big for a UI video)

Always include **dry / no reverb** for UI sounds (reverb smears sync) and a length word
(*single*, *short*, *one*). `duration_seconds` is set from the library or `audio.sfx[name].dur`.
Keep UI sounds at 0.5s; the trim step removes the rest. Raise `influence` (0–1, default 0.55)
for more literal results. If a take is bad, rename it to `name:2` to force a new generation
(each variant is cached separately).

## Music

Prompt formula: **mood + genre + instrumentation + energy arc**. The skill appends the tempo,
length, instrumental, and clean ending.

| Vibe | Prompt |
|---|---|
| Apple-keynote clean | "Minimal modern electronic, soft pulsing synths, crisp light percussion, optimistic, builds gently" |
| Startup energy | "Upbeat indie electronic, punchy drums, bright plucks, confident and forward-moving" |
| Premium / luxury | "Cinematic ambient electronica, deep warm pads, slow heartbeat kick, elegant and restrained" |
| Dev tool / hacker | "Dark minimal techno, tight hi-hats, analog bass, focused and driving" |
| Playful consumer | "Bouncy lo-fi pop, marimba and claps, warm and friendly" |

- Tempo: 100–128 bpm suits most launch videos. Pick it in `meta.bpm` before generating.
- After generation, **always act on BEAT DRIFT**: update `meta.bpm` / `meta.beatOffset`,
  re-probe, and rebuild audio (cached, so no new credits).
- The detected tempo is folded to the timeline's octave (a 60-bpm reading becomes 120) because
  the timeline's bpm defines how dense your events are.
- Your own track: `music: { file: 'music/track.mp3', trim: 1.2 }`. Set `meta.bpm` to its tempo
  and let the analysis find the offset.
- `music: false` for SFX-only videos (they work well for very short loops).

## Voiceover

- Set `audio.voice` to an ElevenLabs voice id (pick one in their Voice Library) or export
  `ELEVENLABS_VOICE_ID`.
- One short sentence per scene, 6–12 words. Speech runs at roughly 2.5 words/second, so a 10-word
  line needs about 4s before the next line.
- Start a line ~0.3s **before** the visual it describes.
- The mixer ducks the music ~8 dB under VO (`mix.duck`). Keep SFX sparse while VO speaks.
- Build reports lines that run into the next one. Move the next line later or shorten the copy.

## Mix

`audio.mix` trims whole buses in dB, applied before loudness normalisation:

```js
mix: { music: 0, sfx: 0, vo: 0, duck: 8, lufs: -14, vary: true }
```
- Music too loud against the SFX: `music: -3`. SFX too present: `sfx: -4`.
- YouTube/Instagram normalise around −14 LUFS, so keep that. Use −16 for podcasts or embedded players.
- `vary` slightly detunes and re-levels repeated hits (keystrokes, ticks) so they don't sound
  machine-gunned.
- Per-cue loudness: `sfxGain` on a track, or `gain` in `audio.cues`.

## Placeholder audio (no API key)

The synth provider produces clean, sample-accurate UI SFX and a basic beat-locked bed at the
exact `meta.bpm` (beat 0 at t = 0). It is good enough to judge timing, not to publish. Say so in
the handoff, and re-run `build_audio.py` with the key set for the final mix. Timings don't
change, because the synth bed is already on the timeline's grid.
