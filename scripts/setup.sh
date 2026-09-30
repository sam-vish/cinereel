#!/usr/bin/env bash
# setup.sh — one-time dependency check for cinereel. Safe to re-run.
set -euo pipefail
ok(){ printf "\033[32m✓\033[0m %s\n" "$*"; }; bad(){ printf "\033[31m✗\033[0m %s\n" "$*"; }
need(){ command -v "$1" >/dev/null 2>&1 || { bad "$1 not found — $2"; exit 1; }; ok "$1"; }

need node   "install Node 18+ (https://nodejs.org)"
need ffmpeg "macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg"
need python3 "install Python 3.9+"

python3 - <<'PY' || { echo "  → pip install numpy scipy pillow requests"; exit 1; }
import importlib, sys
missing=[m for m in ("numpy","scipy","PIL","requests") if importlib.util.find_spec(m) is None]
if missing: print("✗ python packages missing:", ", ".join(missing)); sys.exit(1)
print("\033[32m✓\033[0m numpy scipy pillow requests")
PY

HERE="$(cd "$(dirname "$0")" && pwd)"
if node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null \
   || [ -f "$(npm root -g)/playwright/index.mjs" ]; then
  ok "playwright"
else
  echo "… installing playwright into ~/.cache/cinereel/node"
  mkdir -p "$HOME/.cache/cinereel/node" && (cd "$HOME/.cache/cinereel/node" && npm init -y >/dev/null && npm i playwright@latest >/dev/null)
  ok "playwright"
fi
# Make sure a Chromium build exists for this playwright version.
node "$HERE/check-browser.mjs" || { echo "… downloading Chromium"; npx -y playwright install chromium; }
ok "chromium"

if [ -n "${ELEVENLABS_API_KEY:-}" ]; then ok "ELEVENLABS_API_KEY set (music + SFX + VO via ElevenLabs)";
else echo "• ELEVENLABS_API_KEY not set — cinereel will use its built-in synth for SFX + a placeholder music bed."; fi
