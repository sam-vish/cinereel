#!/usr/bin/env node
// probe.mjs — load the project exactly as the renderer will, then:
//   1. surface every timeline warning (missing selectors, bad times, unknown anims)
//   2. write build/cues.json — the single audio contract (SFX hits, VO lines, music spec)
//
// Usage: node probe.mjs <project-dir> [--strict]
//   --strict   exit 1 when there are warnings (use before a final render)
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openProject, args } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const a = args(process.argv.slice(2));
const project = resolve(a._[0] || '.');
const runtimePath = join(here, '..', 'assets', 'runtime', 'cinereel-runtime.js');

let session;
try {
  session = await openProject(project, { runtimePath });
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
const { report, errors, close } = session;
await close();

mkdirSync(join(project, 'build'), { recursive: true });
writeFileSync(join(project, 'build', 'cues.json'), JSON.stringify(report, null, 2));

const m = report.meta;
console.log(`▸ ${m.title || 'untitled'} — ${m.width}×${m.height} @ ${m.fps}fps, ${m.duration}s, ${m.bpm}bpm`);
console.log(`▸ scenes: ${report.scenes.map((s) => `${s.id}[${(s.start / 1000).toFixed(2)}–${(s.end / 1000).toFixed(2)}]`).join('  ')}`);
const counts = {};
for (const c of report.cues) counts[c.sfx] = (counts[c.sfx] || 0) + 1;
console.log(`▸ sfx cues: ${report.cues.length} (${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'})`);
console.log(`▸ vo lines: ${report.vo.length}   music: ${report.audio.music ? 'yes' : 'no'}`);

// Scene coverage: black gaps are almost always a bug.
const gaps = [];
let cursor = 0;
for (const s of [...report.scenes].sort((x, y) => x.start - y.start)) {
  if (s.start > cursor + 34) gaps.push(`${(cursor / 1000).toFixed(2)}–${(s.start / 1000).toFixed(2)}s`);
  cursor = Math.max(cursor, s.end);
}
if (cursor < m.duration * 1000 - 34) gaps.push(`${(cursor / 1000).toFixed(2)}–${m.duration}s`);
const warnings = [...report.warnings, ...gaps.map((g) => `No scene visible during ${g} (black frames)`), ...errors];

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} issue(s):`);
  for (const w of warnings) console.log('  - ' + w);
  if (a.strict) process.exit(1);
} else {
  console.log('✓ timeline clean');
}
console.log(`✓ wrote ${join(project, 'build', 'cues.json')}`);
