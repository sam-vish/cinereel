#!/usr/bin/env bash
# cinereel.sh — full pipeline: probe → audio → mix → contact sheet → render.
#
#   bash cinereel.sh <project> [--provider auto|elevenlabs|synth] [--scale 2] [--no-audio]
#                              [--sheet-only] [--from S --to S] [--force-audio]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${1:?usage: cinereel.sh <project-dir> [options]}"; shift
PROVIDER=auto; SCALE=1; NOAUDIO=0; SHEET=0; FROM=""; TO=""; FORCE=""
while [[ $# -gt 0 ]]; do case $1 in
  --provider) PROVIDER=$2; shift 2;; --scale) SCALE=$2; shift 2;;
  --no-audio) NOAUDIO=1; shift;; --sheet-only) SHEET=1; shift;;
  --from) FROM=$2; shift 2;; --to) TO=$2; shift 2;; --force-audio) FORCE=--force; shift;;
  *) echo "unknown option $1"; exit 1;; esac; done

echo "━━ 1/5 probe"; node "$HERE/probe.mjs" "$PROJECT"
echo "━━ 2/5 contact sheet"; python3 "$HERE/contact_sheet.py" "$PROJECT"
[[ $SHEET == 1 ]] && exit 0
AUDIO_ARGS=()
if [[ $NOAUDIO == 0 ]]; then
  echo "━━ 3/5 audio assets"; python3 "$HERE/build_audio.py" "$PROJECT" --provider "$PROVIDER" $FORCE
  echo "━━ 4/5 mix"; python3 "$HERE/mix_audio.py" "$PROJECT"
  AUDIO_ARGS=(--audio build/mix.wav)
else echo "━━ 3-4/5 audio skipped"; fi
echo "━━ 5/5 render"
RANGE=(); [[ -n $FROM ]] && RANGE+=(--from "$FROM"); [[ -n $TO ]] && RANGE+=(--to "$TO")
node "$HERE/render.mjs" "$PROJECT" --scale "$SCALE" ${AUDIO_ARGS[@]+"${AUDIO_ARGS[@]}"} ${RANGE[@]+"${RANGE[@]}"}
