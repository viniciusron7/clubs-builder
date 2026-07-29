#!/bin/sh
set -eu

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT="${CDP_PORT:-9333}"
PROFILE="$(mktemp -d /tmp/clubs-builder-chrome.XXXXXX)"
LOG="/tmp/clubs-builder-chrome.log"

"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --disable-breakpad \
  --disable-crash-reporter \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-port="$CDP_PORT" \
  '--remote-allow-origins=*' \
  --user-data-dir="$PROFILE" \
  about:blank >"$LOG" 2>&1 &
CHROME_PID=$!
trap 'kill "$CHROME_PID" 2>/dev/null || true' EXIT INT TERM

attempt=0
until curl -fsS "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    cat "$LOG"
    exit 1
  fi
  sleep 0.05
done

CDP_URL="http://127.0.0.1:$CDP_PORT" node "$(dirname "$0")/browser-smoke.mjs"
