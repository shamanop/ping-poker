#!/bin/bash
# Throwaway v2 server for the UI wave-1 captures, from this worktree. Ports 4720-4729 only; data dir in /tmp (removed by `server.sh stop`).
# Usage: qa/ui-basement/server.sh [start|stop]     PORT=4720 by default
cd "$(dirname "$0")/../.."
PORT=${PORT:-4720}
case "$PORT" in 472[0-9]) ;; *) echo "port $PORT outside 4720-4729"; exit 2;; esac
for pid in $(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2); do
  [ "$(readlink /proc/$pid/cwd)" = "$(pwd)" ] && kill $pid
done
for i in 1 2 3 4 5 6 7 8 9 10; do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
if [ "$1" = stop ]; then rm -rf /tmp/uib-data-$PORT; exit 0; fi
rm -rf /tmp/uib-data-$PORT; mkdir -p /tmp/uib-data-$PORT; D=/tmp/uib-data-$PORT
(DATA_DIR=$D PORT=$PORT RIG=1 AUTO_START_MS=${AUTO_START_MS:-2000} HAND_DELAY_MS=${HAND_DELAY_MS:-6000} AUTH_SIGNUP_LIMIT=${AUTH_SIGNUP_LIMIT:-5000} setsid nohup node server.js > $D/server.log 2>&1 < /dev/null &)
for i in 1 2 3 4 5 6 7 8 9 10; do ss -ltn | grep -q ":$PORT " && break; sleep 1; done
echo "$D"; tail -2 $D/server.log
