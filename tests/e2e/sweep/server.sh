#!/bin/bash
# Start (or restart) a throwaway v2 server from this repo on PORT (default 4700; 4700-4719 only), RIG=1, fresh data dir.
# Prints the data dir. Stop: tests/e2e/sweep/server.sh stop
cd "$(dirname "$0")/../../.."
PORT=${PORT:-4700}
case "$PORT" in 47[01][0-9]) ;; *) echo "port $PORT outside 4700-4719"; exit 2;; esac
for pid in $(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2); do
  [ "$(readlink /proc/$pid/cwd)" = "$(pwd)" ] && kill $pid
done
for i in 1 2 3 4 5 6 7 8 9 10; do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
[ "$1" = stop ] && exit 0
D=$(mktemp -d "${TMPDIR:-/home/frank/.openclaw/workspace/projects/ping-v2-core/runs}/sweep-data.XXXX" 2>/dev/null || mktemp -d)
(DATA_DIR=$D PORT=$PORT RIG=1 AUTO_START_MS=${AUTO_START_MS:-2000} HAND_DELAY_MS=${HAND_DELAY_MS:-2500} AUTH_SIGNUP_LIMIT=${AUTH_SIGNUP_LIMIT:-5000} setsid nohup node server.js > $D/server.log 2>&1 < /dev/null &)
for i in 1 2 3 4 5 6 7 8 9 10; do ss -ltn | grep -q ":$PORT " && break; sleep 1; done
echo "$D" | tee /tmp/sweep-datadir-$PORT; tail -3 $D/server.log
