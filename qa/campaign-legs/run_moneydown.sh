#!/bin/bash
# money_down on a clean export. qa/campaign-legs/run_moneydown.sh <export> <port> <name> <WxH> <play|chips>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; EXPORT="$1"; PORT="$2"; NAME="$3"; VP="$4"; MODE="$5"
SC="/home/frank/.openclaw/workspace/projects/ping-v2-core/_scratch/campaign/legs"; DATA="$SC/data/$NAME-md"; rm -rf "$DATA"; mkdir -p "$DATA" "$SC/logs" "$SC/shots" "$SC/out"
SRVLOG="$SC/logs/server-$NAME-md.log"; PLAYENV=""; [ "$MODE" = "play" ] && PLAYENV="1000000"
(cd "$EXPORT" && unset NODE_ENV RIG && exec env CAMPAIGN_TEST=1 ${PLAYENV:+SIGNUP_PLAY_CENTS=$PLAYENV} DATA_DIR="$DATA" PORT="$PORT" node server.js > "$SRVLOG" 2>&1) &
PID=$!; trap 'kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null' EXIT INT TERM
for i in $(seq 1 120); do grep -q "server running on port" "$SRVLOG" 2>/dev/null && break; kill -0 $PID 2>/dev/null || { echo "server died"; tail -5 "$SRVLOG"; exit 2; }; sleep 0.5; done
echo "server pid $PID port $PORT data $DATA"
flock /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/_scratch/locks/chrome.lock timeout ${LEGTIMEOUT:-300} node "$HERE/moneydown.js" --base "http://127.0.0.1:$PORT" --data "$DATA" --viewport "$VP" --mode "$MODE" --name "$NAME" --out "$SC/out/$NAME-moneydown.json" --shots "$SC/shots" > "$SC/logs/moneydown-$NAME.log" 2>&1
RC=$?; echo "moneydown $NAME exit $RC"; tail -4 "$SC/logs/moneydown-$NAME.log" | cut -c1-400; exit $RC
