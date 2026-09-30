#!/usr/bin/env node
// render.mjs — deterministic frame capture → H.264, no intermediate frame files.
//
// Usage:
//   node render.mjs <project> [--out build/video.mp4] [--audio build/mix.wav]
//                   [--scale 1] [--from 0] [--to <sec>] [--crf 16] [--fps <override>]
//   node render.mjs <project> --stills 0.5,3.2,7 [--stills-dir build/stills]
//
// --scale 2 renders a 1920×1080 timeline at 3840×2160 (sharp UI text for 4K uploads).
// --from/--to render a slice (for quick iteration on one scene).
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openProject, args } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const a = args(process.argv.slice(2));
const project = resolve(a._[0] || '.');
const runtimePath = join(here, '..', 'assets', 'runtime', 'cinereel-runtime.js');
const scale = Number(a.scale || 1);

let session;
try { session = await openProject(project, { scale, runtimePath }); }
catch (e) { console.error('✗ ' + e.message); process.exit(1); }
const { page, meta, report, errors, close } = session;

if (report.warnings.length) {
  console.log(`⚠ ${report.warnings.length} timeline warning(s) — run probe.mjs to see them.`);
}

async function frameAt(ms, type = 'jpeg') {
  await page.evaluate((t) => { window.renderFrame(t); void document.body.offsetHeight; }, ms);
  return page.screenshot(type === 'png' ? { type: 'png' } : { type: 'jpeg', quality: Number(a['jpeg-quality'] || 95) });
}

// ── stills mode ──────────────────────────────────────────────
if (a.stills) {
  const dir = resolve(project, a['stills-dir'] || 'build/stills');
  mkdirSync(dir, { recursive: true });
  const times = String(a.stills).split(',').map(Number).filter((n) => !Number.isNaN(n));
  const { writeFileSync } = await import('fs');
  for (const s of times) {
    const buf = await frameAt(s * 1000, 'png');
    const name = `still_${s.toFixed(2).padStart(6, '0')}.png`;
    writeFileSync(join(dir, name), buf);
  }
  await close();
  console.log(`✓ ${times.length} stills → ${dir}`);
  process.exit(0);
}

// ── video mode ───────────────────────────────────────────────
const fps = Number(a.fps || meta.fps || 30);
const from = Number(a.from || 0);
const to = Math.min(Number(a.to || meta.duration), meta.duration);
const total = Math.round((to - from) * fps);
const out = resolve(project, a.out || 'build/video.mp4');
mkdirSync(dirname(out), { recursive: true });

const ff = [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
];
if (a.audio) ff.push('-ss', String(from), '-i', resolve(project, a.audio));
ff.push(
  '-map', '0:v',
  '-c:v', 'libx264', '-preset', a.preset || 'medium', '-crf', String(a.crf || 16),
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart',
);
if (a.audio) ff.push('-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-t', String(to - from));
ff.push(out);

console.log(`▸ rendering ${total} frames (${from}s → ${to}s @ ${fps}fps, ${meta.width * scale}×${meta.height * scale})`);
const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
const encDone = new Promise((ok, bad) => enc.on('close', (c) => (c === 0 ? ok() : bad(new Error('ffmpeg exited ' + c)))));
enc.stdin.on('error', () => {});

const t0 = Date.now();
for (let f = 0; f < total; f++) {
  const ms = (from + f / fps) * 1000;
  const buf = await frameAt(ms);
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
  if ((f + 1) % fps === 0 || f === total - 1) {
    const el = (Date.now() - t0) / 1000;
    const eta = (el / (f + 1)) * (total - f - 1);
    process.stdout.write(`\r  ${f + 1}/${total} frames  ·  ${(el).toFixed(0)}s elapsed  ·  ~${eta.toFixed(0)}s left   `);
  }
}
enc.stdin.end();
process.stdout.write('\n');
await close();
try { await encDone; } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
if (errors.length) console.log('⚠ browser errors during render:\n  ' + errors.join('\n  '));
console.log(`✓ ${out}`);
