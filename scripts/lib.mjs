// lib.mjs — shared helpers for probe.mjs and render.mjs
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve, normalize } from 'path';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';
import vm from 'vm';

export async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const p = join(root, 'playwright', 'index.mjs');
    if (existsSync(p)) return await import(pathToFileURL(p).href);
  } catch {}
  const local = join(process.env.HOME || '.', '.cache', 'cinereel', 'node', 'node_modules', 'playwright', 'index.mjs');
  if (existsSync(local)) return await import(pathToFileURL(local).href);
  console.error('✗ Playwright not found. Run: bash <skill>/scripts/setup.sh');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// Serves the project dir. Requests for /cinereel-runtime.js fall back to the skill's copy
// so projects never ship a stale runtime unless they deliberately vendor one.
export function serve(projectDir, runtimePath) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = normalize(join(projectDir, urlPath === '/' ? 'video.html' : urlPath));
    if (!file.startsWith(resolve(projectDir))) { res.writeHead(403); return res.end(); }
    if ((!existsSync(file) || statSync(file).isDirectory()) && urlPath.endsWith('cinereel-runtime.js')) file = runtimePath;
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

export function readTimeline(projectDir) {
  const file = join(projectDir, 'timeline.js');
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
  const sandbox = { window: {}, console };
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: 'timeline.js' });
  if (!sandbox.window.CINEREEL) throw new Error('timeline.js must assign window.CINEREEL = { ... }');
  return sandbox.window.CINEREEL;
}
export const readTimelineMeta = (dir) => readTimeline(dir).meta || {};

export function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

export async function openProject(projectDir, { scale = 1, runtimePath }) {
  const { chromium } = await loadPlaywright();
  const { server, port } = await serve(projectDir, runtimePath);
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const meta = readTimelineMeta(projectDir);
  const width = meta.width || 1920, height = meta.height || 1080;

  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(scale) || 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  await page.goto(`http://127.0.0.1:${port}/video.html?render=1`, { waitUntil: 'networkidle', timeout: 60000 });
  try {
    await page.waitForFunction(() => window.__videoReady === true, null, { timeout: 30000 });
  } catch {
    await browser.close(); server.close();
    throw new Error('Page never set window.__videoReady.\n  ' + (errors.join('\n  ') || 'No console errors — is cinereel-runtime.js loaded after timeline.js?'));
  }
  await page.evaluate(() => window.__stopPreview && window.__stopPreview());
  const report = await page.evaluate(() => window.__cinereelReport);
  const close = async () => { await browser.close(); server.close(); };
  return { page, report, meta: report.meta, errors, close };
}
