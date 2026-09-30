# Storyboards

Write the beat sheet before the timeline. It is 10 lines, and it prevents the most expensive
mistake: a technically perfect video with no story.

## The spine

Every launch video answers four questions in order:

1. **What is this?** A cold open with the product name or promise, in under 3 seconds.
2. **Why should I care?** The pain, or the transformation, in one line.
3. **Does it actually work?** Real UI doing real things. This is most of the runtime.
4. **What do I do now?** The end card: name, URL, CTA.

If a shot doesn't serve one of these, cut it.

## Structures (at 120 bpm: 1 beat = 0.5s, 1 bar = 2s)

### 15s: social teaser (30 beats)
| Beats | Scene | Content |
|---|---|---|
| 0–6 | open | Logo pop + 3–5 word promise |
| 6–24 | product | ONE hero interaction: push-in, cursor, result |
| 24–30 | end | Name + URL |

### 30s: standard launch (60 beats)
| Beats | Scene | Content |
|---|---|---|
| 0–6 | open | Kinetic headline, logo |
| 6–10 | problem | One pain line (optional: old-way visual) |
| 10–26 | feature 1 | Dashboard / core screen: push → pull → push, data animates |
| 26–38 | feature 2 | Signature interaction (typing, AI answer, automation firing) |
| 38–48 | montage | 3–5 fast shots on the beat (1–2 bars each): integrations, mobile, settings |
| 48–60 | end | Riser → impact on b48 → name, URL, CTA |

### 45–60s: explainer with VO (90–120 beats)
The same spine with 3 feature scenes. Each feature scene gets one VO line that lands **just
before** its visual (lead the eye by ~0.3s), plus a social-proof beat (logos or a metric) before
the end card.

### Vertical 9:16 (Reels / Shorts)
Stage 1080×1920. Put the hook in the first 1.5s with no slow intro. Crop UI into tall
cards: use the camera to frame one column of the desktop layout, or build mobile screens.
Keep text inside the middle 70% of the height (UI chrome overlaps the edges).

## Beat sheet format

Show this in chat (or keep it as a comment at the top of `timeline.js`):

```
NORTHSTAR — 16s @120bpm (32 beats)
b0–7    intro   logo pop (pop) · "Your revenue, finally legible." word blur-in (whoosh-soft)   cam: still
b6.5–19 dash    KPIs count up (ticks) → pull back → bars grow + line draws → cursor → Export
                (click) → toast (chime)                        cam: 1.42×KPIs → 1.0 → 1.14×toast
b18.5–27 ask    type question (keys) → answer card (whoosh-soft) → insight glow (shimmer)
                riser b23.4 →                                   cam: 1.08 → 1.0 drift
b26.5–32 outro  mark (IMPACT on b27) · name mask-reveal · url (tick)
```

## Shot ideas by product type

| Product | Hero shots |
|---|---|
| Analytics / dashboards | count-ups, chart draw, filter click → chart re-draws (`addClass`) |
| AI assistant / copilot | typing a question, streaming answer rows, highlighted insight |
| Dev tools | terminal typing, green checks cascading, diff lines revealing |
| Automation / workflow | nodes appearing in sequence, connector lines drawing, a "run" click → statuses flipping |
| Design / creative | canvas elements snapping into place, before/after `wipe` transition |
| Commerce / fintech | card tap → success toast, balance count-up, receipt sliding in |
| Mobile apps | phone frame centred, screens swapping with `slideLeft`, thumb-tap ripples |

## Invented products

When the user says "invent it", commit to a real-feeling product: a name, a one-line promise, a
realistic domain with 3 screens, believable numbers (not 99.99%), and consistent brand tokens.
State the invented facts in the handoff so the user can swap them.
