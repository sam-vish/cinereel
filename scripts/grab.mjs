#!/usr/bin/env node
// grab.mjs — capture a live product page as rebuild material.
//
//   node grab.mjs <url> <out-dir> [--width 1920] [--height 1080] [--wait 1500]
//
// Writes:
//   <out>/full.png          full-page screenshot (reference for the rebuild)
//   <out>/viewport.png      first screen
//   <out>/tokens.json       CSS custom properties on :root, most-used colors, fonts, radii, shadows
//   <out>/page.html         serialized DOM (copy markup and class names from it)
// It does not produce a render-ready scene. Rebuild the screens as clean DOM using this as the spec.
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { loadPlaywright, args } from './lib.mjs';

const a = args(process.argv.slice(2));
const [url, outArg] = a._;
if (!url || !outArg) { console.error('usage: node grab.mjs <url> <out-dir>'); process.exit(1); }
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await (await browser.newContext({
  viewport: { width: Number(a.width || 1920), height: Number(a.height || 1080) }, deviceScaleFactor: 1,
})).newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(url, { waitUntil: 'load' }));
await page.waitForTimeout(Number(a.wait || 1500));

await page.screenshot({ path: join(out, 'viewport.png') });
await page.screenshot({ path: join(out, 'full.png'), fullPage: true });

const tokens = await page.evaluate(() => {
  const count = (map, k) => { if (k) map[k] = (map[k] || 0) + 1; };
  const vars = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules || [])) {
      if (r.selectorText && /(^|,)\s*(:root|html|body)\b/.test(r.selectorText)) {
        for (const p of Array.from(r.style)) if (p.startsWith('--')) vars[p] = r.style.getPropertyValue(p).trim();
      }
    }
  }
  const colors = {}, bgs = {}, fonts = {}, radii = {}, shadows = {}, sizes = {};
  const els = Array.from(document.querySelectorAll('body *')).slice(0, 4000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) {
      count(colors, cs.color); count(fonts, cs.fontFamily); count(sizes, `${cs.fontSize}/${cs.fontWeight}`);
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') count(bgs, cs.backgroundColor);
    if (cs.borderRadius !== '0px') count(radii, cs.borderRadius);
    if (cs.boxShadow !== 'none') count(shadows, cs.boxShadow);
  }
  const top = (m, n) => Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => ({ value: k, uses: v }));
  return {
    title: document.title,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    cssVariables: vars,
    textColors: top(colors, 8), backgrounds: top(bgs, 8), fonts: top(fonts, 4),
    typeScale: top(sizes, 10), radii: top(radii, 5), shadows: top(shadows, 4),
  };
});
writeFileSync(join(out, 'tokens.json'), JSON.stringify(tokens, null, 2));
writeFileSync(join(out, 'page.html'), await page.content());
await browser.close();
console.log(`✓ ${out}: viewport.png, full.png, tokens.json (${Object.keys(tokens.cssVariables).length} css vars, fonts: ${tokens.fonts.map((f) => f.value.split(',')[0]).join(' | ')}), page.html`);
