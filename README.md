# cinereel

Motion-designed SaaS launch videos from real UI, as a Claude skill.

**One clock. Picture and sound read the same timeline.** Screens are real DOM, animated by a
beat-addressed `timeline.js`. The same timeline produces the audio cue sheet, so every click,
whoosh and cut lands on its frame, and fixing the music's tempo re-times the whole edit.

## Install

1. Add the skill (upload `cinereel.skill`, or drop this folder into your skills directory).
2. Once per machine: `bash scripts/setup.sh`. It checks Node 18+, FFmpeg, Python
   (numpy, scipy, pillow, requests), Playwright and Chromium.
3. Optional: `export ELEVENLABS_API_KEY=...` for generated music, SFX and voiceover.
   Without it, everything still renders with built-in synth SFX and a placeholder beat.

## Use

Ask Claude: *"Make a 30s launch video for <product> from these screens."*
Manual pipeline:

```bash
cp -r assets/template ./my-reel            # a working 16s example to start from
node scripts/probe.mjs ./my-reel           # validate timeline, export audio cues
python3 scripts/contact_sheet.py ./my-reel # QA stills + cue strip
bash scripts/cinereel.sh ./my-reel         # audio → mix → render → build/video.mp4
```

## What's inside

| Path | Role |
|---|---|
| `assets/runtime/cinereel-runtime.js` | deterministic motion engine (scenes, camera, 20+ anims, cursor, grain) |
| `assets/template/` | complete example project |
| `scripts/probe.mjs` | loads the page like the renderer; warnings + `cues.json` |
| `scripts/render.mjs` | Chromium frames → FFmpeg, stills mode, partial renders, 4K |
| `scripts/build_audio.py` | ElevenLabs music/SFX/VO with caching, silence trim, beat analysis, synth fallback |
| `scripts/mix_audio.py` | sample-accurate placement, VO ducking, −14 LUFS |
| `scripts/contact_sheet.py` | QA sheet |
| `scripts/grab.mjs` | screenshots + design tokens from a live URL |
| `references/` | timeline API, motion principles, storyboards, audio direction, source adapters |

Built by Sameer Vish.
