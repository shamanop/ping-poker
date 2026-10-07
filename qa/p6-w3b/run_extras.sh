#!/bin/bash
# P6 w3b extras: qa/p6-w3b/run_extras.sh <export> <port> <name> [only]   (the driver starts and stops its own server; chrome flock held for the whole run)
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="/home/frank/.openclaw/workspace/projects/ping-v2-core/_scratch/p6/w3b/chain"; DATA="$SC/data-$3"; rm -rf "$DATA"; mkdir -p "$DATA"
flock /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/_scratch/locks/chrome.lock timeout ${LEGTIMEOUT:-3000} node "$HERE/extras.js" --export "$1" --port "$2" --data "$DATA" ${4:+--only $4} > "$SC/extras-$3.log" 2>&1
echo "extras exit $?"; tail -3 "$SC/extras-$3.log"
