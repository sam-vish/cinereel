# Motion principles

The difference between "AI motion slop" and something that looks designed is almost entirely
timing discipline. These are the rules the runtime's defaults are built on. Break them on purpose,
not by accident.

## 1. Durations

| Motion | Duration | Why |
|---|---|---|
| Small UI element enters (chip, badge, toast) | 0.35–0.5s | Reads as responsive, not sluggish |
| Card / panel enters | 0.5–0.7s | Big things need slightly more time to feel physical |
| Headline word stagger | 0.6–0.8s each, 0.08–0.14s apart | Fast enough to read as one gesture |
| Scene transition | 0.4–0.6s | Longer feels like a slideshow |
| Camera push / pull | 0.8–1.6s | Slower than elements: the camera is heavy |
| Count-up | 1.0–1.6s with `expoOut` | Most of the number arrives early, the tail settles |
| Cursor travel | 0.6–0.9s | Humans move fast, then decelerate onto targets |
| Hold after a key moment | ≥ 0.8s | The viewer needs to read it |
| End card hold | ≥ 2.5s | Long enough to screenshot the URL |

A launch video is not a UI prototype: things can move 20–40% slower than they would in the real
product, because the viewer is watching rather than using it.

## 2. Easing

- **`emphasized`** (default enter): fast start, long settle. This is the "expensive" curve.
  Use it for most entrances.
- **`expoOut`**: even more front-loaded. Use it for count-ups, bars, and mask reveals.
- **`smooth`**: gentle, for exits and fades.
- **`backOut` / `popIn`**: overshoot. Use it only for small, playful things (icons, toasts,
  logo marks). Never use it on large panels, where it looks cheap.
- **`spring`**: for a single hero moment, not as a default.
- **`expoInOut` / `cubicInOut`**: camera moves between framings.
- **`linear`**: only for continuous motion (typing, drift). Never for enters.

Exits should be shorter than enters and less dramatic. Attention should go to what's arriving.

## 3. Stagger and hierarchy

- Stagger siblings in reading order (top→bottom, left→right). Use `reverse: true` only when
  the motion direction demands it.
- Keep the total stagger for a group under ~0.6s. A long cascade reads as lag.
- The most important element moves first **or** last, never in the middle of a group.
- Only one thing should be the focus at a time. If two groups animate together, one of them
  should be a subtle fade.

## 4. Camera

- **Every scene moves.** A static full-frame UI for more than ~1.5s reads as a screenshot.
  Minimum: a slow `scale 1.06 → 1.0` drift across the scene.
- Pattern that always works: **push in on the detail → pull back to context → push to the next
  detail**. Match the push to the moment that detail animates.
- Push-in scale is 1.3–1.8 for UI detail. Beyond 2.0, text blurs at 1080p, so render
  `--scale 2` if you need to go tighter.
- Keep the camera still while the cursor is travelling to a small target. Double motion is hard
  to follow.
- Tiny rotation (±1–2°) on a pull-back adds depth. Don't rotate while text is being read.
- Crossfading scenes with different camera scales looks like a cinematic zoom. Pair
  `in: 'zoom'` with an outgoing scene that ends slightly pushed in.

## 5. Cut rhythm

- Cut (scene change) on the **beat**, ideally on a bar line (`"bar4"`, `"b16"`).
- Place big moments (logo, key stat, hero feature) on the downbeat. Put small ticks on half-beats.
- Early in the video, shots can run 3–5s. In a montage section, 1–2 beats per shot works.
  Slow back down for the end card.
- Anticipation: start the riser 1.5–2 beats before the cut it resolves into, and put the
  impact exactly on the cut.

## 6. Text on screen

- Headlines ≥ 72px on a 1080p stage (≥ 96px for a cold open). Body UI can be product-sized
  because the camera will push in on it.
- Max ~7 words per kinetic headline, one idea each.
- Let text sit fully readable for at least `words × 0.3s + 0.5s`.
- Animate words in with `blurIn` or `fadeUp` plus `data-split="words"`. Use chars only for very
  short, loud words.
- Gradient or accent color goes on **one** word: the payoff word.

## 7. Making UI feel alive

Pick 2–3 per product scene, not all of them:
- numbers count up (`countUp`)
- charts grow or draw (`barGrow`, `draw`, `fillX`)
- cursor clicks something, and something responds (toast `popIn`, `addClass` tab switch)
- typing into a search/AI box (`type`) followed by a result card
- a key element gets `glow` or `pulse` right when the voiceover or copy mentions it

Real product behaviour sells better than decoration. If the product has a signature interaction,
that is the hero shot.

## 8. Common failures

| Looks like | Cause | Fix |
|---|---|---|
| Slideshow | Static camera, fade-only transitions | Camera move in every scene; vary transition types |
| Chaotic | Everything animates at once | One focus per moment; stagger groups; mute secondary motion |
| Floaty / slow | `linear` or `sineInOut` enters, long durations | `emphasized` / `expoOut`, shorter durations |
| Cheap | Overshoot on big panels, rainbow accents | Overshoot only on small things; one accent color |
| Off-beat | Raw-second timings | Beat-addressed times + corrected `meta.bpm` / `beatOffset` |
| Unreadable | Text moves while being read | Hold text still; camera pauses on reads |
