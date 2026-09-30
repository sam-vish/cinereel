# Source adapters: getting real screens into the stage

Goal: every screen becomes clean, fixed-size HTML inside a `.scene > .cr-camera`, with ids on
everything the timeline will touch. Fidelity to the real product matters more than anything
else. Invented UI is the fallback, not the default.

Pick the section for your input.

## A. Claude Design canvas (`/design` in Claude Code)

The canvas artboards are already real elements, which is why they animate well.

1. Get the artboard markup. Use whatever the design tool exposes in your environment: reading
   or exporting the canvas artifact's files, or asking the design session to output each
   artboard as standalone HTML/JSX. If only JSX/React comes back, port it to static HTML
   (inline the Tailwind classes' resulting styles, or compile them. See section D).
2. One artboard → one `.scene`. Scale the artboard to fit the 1920×1080 stage (usually a
   1440–1600px-wide window centred on a background, like the template's `.window`).
3. Add ids to the elements you'll animate: KPI values, chart bars, buttons, inputs, toasts.
4. Numbers that will count up: leave the element present with its final text. The `countUp`
   anim overwrites it.
5. Keep the canvas's design tokens as CSS variables at `:root`.

If the canvas can't be read directly, screenshot each artboard and follow **section E**.

## B. Live URL (the user's product, or a client's site)

```bash
node <skill>/scripts/grab.mjs https://product.com ./<slug>-reel/ref
```
You get `viewport.png`, `full.png`, `tokens.json` (CSS variables, dominant colors, fonts,
type scale, radii, shadows) and `page.html`. Then:

1. **View the screenshots** and decide which 2–4 regions become scenes.
2. Rebuild those regions as clean HTML using the real tokens and copy. Lift structure and class
   ideas from `page.html`, but don't paste the whole page (scripts, lazy loading, and
   responsive CSS break determinism).
3. Copy the real text: headings, labels, numbers. Believable, specific copy is what makes it look
   like the actual product.
4. For logged-in app screens that you can't reach, ask the user for screenshots (**section E**).

## C. Screens the user describes (or "invent it")

Write the HTML directly. Use `references/storyboard.md` → *Invented products*. A component
library URL from the user (shadcn, Radix themes, or any published design system) should drive the
look: fetch its docs, then reproduce its tokens (radius, border, spacing, type) in the stage CSS.

## D. A Next.js / React repo

Best fidelity for real products.

1. Find the pages or components for the screens you want (dashboard, key feature, settings).
2. Port the JSX to static HTML: replace data with realistic literals, remove hooks and handlers,
   and keep the class names.
3. **Tailwind projects**: compile a stylesheet that covers the stage.
   - Tailwind v4: create `reel.css` with `@import "tailwindcss";` and `@source "./video.html";`,
     plus the project's `@theme` block, then
     `npx @tailwindcss/cli -i reel.css -o build/reel.out.css` and link that file.
   - Tailwind v3: `npx tailwindcss -c <project>/tailwind.config.js --content ./video.html -o build/reel.out.css`.
   - Don't use the Tailwind play CDN for final renders. It compiles at runtime and can race the
     first frame.
4. Copy the project's fonts (`next/font` output or `/public/fonts`) into `./fonts` and declare
   `@font-face`.
5. Icons: inline the SVGs (lucide/heroicons markup), not an icon font.

## E. Screenshots only

Hybrid layering keeps screenshots useful:

1. Put the screenshot in the scene as an `<img>` base layer at its exact pixel size.
2. **Re-create only the parts that should move** as DOM positioned on top, covering the
   originals: the KPI numbers, the chart area, the button that gets clicked, the toast.
   Match font, size, and color by eye (use `tokens.json` if you also have the URL).
3. Hide the underlying static region with a solid patch in the background color, so a count-up
   doesn't show two numbers.
4. The camera can push in on the screenshot freely. Render `--scale 2` if you push past 1.5×.

This looks nearly as good as a full rebuild at a fraction of the work, and it is the right call
for a 15s teaser.

## F. Mobile apps

Build a phone frame (rounded rect 390×844 with a notch, or a clean bezel) and render the app
screens inside it at native size, then scale the frame to ~1.1–1.3 on a 1080p stage. Swap
screens inside the frame with `slideLeft` scenes (or `addClass` on a container), and use a
tap-sized cursor ripple: `cursor.fill` transparent with the ripple only, or a small circle.

## Checklist before writing the timeline

- [ ] Every animated element has an `id` or a unique class
- [ ] No CSS transforms/transitions/animations on animated elements
- [ ] Fonts load locally (or accept a CDN risk for drafts)
- [ ] Images are local files (no hotlinks)
- [ ] Brand tokens are CSS variables; one accent color set as `meta.accent`
- [ ] Copy is real (or clearly invented and reported)
