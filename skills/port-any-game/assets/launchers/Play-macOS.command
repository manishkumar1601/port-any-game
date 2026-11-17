#!/bin/sh
# Double-click launcher: serves ./dist on 127.0.0.1 and opens the browser. Set PAG_NO_OPEN=1 to skip opening it.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then exec node serve-standalone.mjs; fi
# python3 cannot send COOP/COEP, so it is only a fallback for games that do not need them.
if ! grep -q '"needs_coi" *: *true' launch.json && command -v python3 >/dev/null 2>&1; then
  port=$(sed -n 's/.*"port" *: *\([0-9][0-9]*\).*/\1/p' launch.json)
  python3 -m http.server "$port" --bind 127.0.0.1 --directory dist &
  pid=$!
  sleep 1
  if [ "$PAG_NO_OPEN" != "1" ]; then
    if [ "$(uname)" = "Darwin" ]; then open "http://127.0.0.1:$port/"; else xdg-open "http://127.0.0.1:$port/" >/dev/null 2>&1; fi
  fi
  wait "$pid"
  exit $?
fi
echo "Install Node.js from https://nodejs.org to play this game, then run this file again."
exit 1
