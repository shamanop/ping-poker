#!/bin/bash
# P6 w3b: one leg on a clean export. qa/p6-w3b/run_leg.sh <export> <port> <name> <WxH> <play|chips> [docked]
# Fresh data dir per leg, COLDCALL_TEST=1, RIG off. The browser part runs under the shared chrome flock. Server killed by PID.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; EXPORT="$1"; PORT="$2"; NAME="$3"; VP="$4"; MODE="$5"; DOCK="${6:-}"
SC="/home/frank/.openclaw/workspace/projects/ping-v2-core/_scratch/p6/w3b/chain"; DATA="$SC/data-$NAME"; rm -rf "$DATA"; mkdir -p "$DATA"
SRVLOG="$DATA/server.log"
(cd "$EXPORT" && unset NODE_ENV RIG && COLDCALL_TEST=1 DATA_DIR="$DATA" PORT="$PORT" exec node server.js > "$SRVLOG" 2>&1) &
PID=$!; trap 'kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null' EXIT INT TERM
for i in $(seq 1 120); do grep -q "server running on port" "$SRVLOG" 2>/dev/null && break; kill -0 $PID 2>/dev/null || { echo "server died"; tail -5 "$SRVLOG"; exit 2; }; sleep 0.5; done
echo "server pid $PID port $PORT data $DATA"
flock /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/_scratch/locks/chrome.lock timeout ${LEGTIMEOUT:-3000} node "$HERE/leg.js" --base "http://127.0.0.1:$PORT" --data "$DATA" --export "$EXPORT" --viewport "$VP" --mode "$MODE" --name "$NAME" ${DOCK:+--docked} ${QUICK:+--quick} > "$SC/leg-$NAME.log" 2>&1
RC=$?; echo "leg $NAME exit $RC"; tail -3 "$SC/leg-$NAME.log"; exit $RC
