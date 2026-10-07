#!/bin/bash
# P6 w3a: boot a clean export on a scratch data dir, run smoke.js then errors.js, print one PASS / FAIL line per driver, kill the server by PID.
#   qa/p6-w3a/run.sh [exportDir=/tmp/p6-w3a-e596336] [port=4760]
# Env: DRIVERS="smoke errors" (default both). Exit 1 if either driver failed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
EXPORT="${1:-/tmp/p6-w3a-e596336}"; PORT="${2:-4760}"
SCRATCH="$HERE/../../../_scratch/p6/w3/builder"; mkdir -p "$SCRATCH"; SCRATCH="$(cd "$SCRATCH" && pwd)"
DATA="$(mktemp -d "$SCRATCH/run-XXXXXX")"
SRVLOG="$DATA/server.log"; PID=""
cleanup() { if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null; sleep 1; kill -9 "$PID" 2>/dev/null; fi; }
trap cleanup EXIT INT TERM

[ -f "$EXPORT/server.js" ] || { echo "no server.js in $EXPORT"; exit 2; }
(cd "$EXPORT" && DATA_DIR="$DATA" PORT="$PORT" RIG=1 exec node server.js > "$SRVLOG" 2>&1) &   # exec: $! is node itself, so cleanup kills the server, not just a subshell
PID=$!
for i in $(seq 1 120); do grep -q "server running on port" "$SRVLOG" 2>/dev/null && break; kill -0 "$PID" 2>/dev/null || { echo "server died:"; tail -5 "$SRVLOG"; exit 2; }; sleep 0.5; done
grep -q "server running on port" "$SRVLOG" || { echo "server did not come up in 60 s"; tail -5 "$SRVLOG"; exit 2; }
grep "game recovery:" "$SRVLOG"
echo "server pid $PID, port $PORT, data $DATA"

BASE="http://127.0.0.1:$PORT"; RC=0
for d in ${DRIVERS:-smoke errors}; do
  [ "$d" = none ] && continue   # DRIVERS=none: boot and tear down only
  LOG="$DATA/$d.log"
  if [ "$d" = smoke ]; then node "$HERE/smoke.js" --base "$BASE" --data "$DATA" > "$LOG" 2>&1; else node "$HERE/errors.js" --base "$BASE" > "$LOG" 2>&1; fi
  CODE=$?; LINE="$(grep -E '^(SMOKE|ERRORS) (PASS|FAIL)' "$LOG" | tail -1)"
  if [ "$CODE" -eq 0 ]; then echo "PASS $d: ${LINE:-no summary line} (log $LOG)"; else echo "FAIL $d (exit $CODE): ${LINE:-no summary line} (log $LOG)"; grep '^FAIL ' "$LOG" | head -12; RC=1; fi
done
exit $RC
