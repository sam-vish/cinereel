import { loadPlaywright } from './lib.mjs';
const { chromium } = await loadPlaywright();
try { const b = await chromium.launch({ args: ['--no-sandbox'] }); await b.close(); process.exit(0); }
catch { process.exit(1); }
