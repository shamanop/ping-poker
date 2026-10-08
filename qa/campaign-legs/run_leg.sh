#!/bin/bash
# Campaign Trail browser leg on a clean export. qa/campaign-legs/run_leg.sh <export> <port> <name> <WxH> <play|chips> [docked]
# Fresh data dir per leg, real server, CAMPAIGN_TEST=1 (the step "force" hook), RIG off. The browser part runs under the shared chrome flock. Server killed by PID.
# Play $ is 0 on a live sign-up (Chris 10/7): the Play $ leg starts its server with SIGNUP_PLAY_CENTS=1000000 (server.js knob for test harnesses, $10,000.00).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; EXPORT="$1"; PORT="$2"; NAME="$3"; VP="$4"; MODE="$5"; DOCK="${6:-}"
SC="/home/frank/.openclaw/workspace/projects/ping-v2-core/_scratch/campaign/legs"; DATA="$SC/data/$NAME"; rm -rf "$DATA"; mkdir -p "$DATA" "$SC/logs" "$SC/shots" "$SC/out"
SRVLOG="$SC/logs/server-$NAME.log"
PLAYENV=""; [ "$MODE" = "play" ] && PLAYENV="1000000"
(cd "$EXPORT" && unset NODE_ENV RIG && exec env CAMPAIGN_TEST=1 ${PLAYENV:+SIGNUP_PLAY_CENTS=$PLAYENV} DATA_DIR="$DATA" PORT="$PORT" node server.js > "$SRVLOG" 2>&1) &
PID=$!; trap 'kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null' EXIT INT TERM
for i in $(seq 1 120); do grep -q "server running on port" "$SRVLOG" 2>/dev/null && break; kill -0 $PID 2>/dev/null || { echo "server died"; tail -5 "$SRVLOG"; exit 2; }; sleep 0.5; done
echo "server pid $PID port $PORT data $DATA"
flock /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/_scratch/locks/chrome.lock timeout ${LEGTIMEOUT:-1500} node "$HERE/leg.js" --base "http://127.0.0.1:$PORT" --data "$DATA" --viewport "$VP" --mode "$MODE" --name "$NAME" --seed "${SEED:-7}" --out "$SC/out/$NAME.json" --shots "$SC/shots" ${DOCK:+--docked} > "$SC/logs/leg-$NAME.log" 2>&1
RC=$?; echo "leg $NAME exit $RC"; tail -3 "$SC/logs/leg-$NAME.log"; exit $RC
