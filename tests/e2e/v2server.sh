#!/bin/bash
# Start a throwaway v2 server for the F-I proofs: exports origin/v2-tables (or $V2_REF) to /tmp/p4b-v2tables, overlays THIS
# worktree's public/ (and coldcall from the export), fresh data dir, port 3581 (3580-3599 are ours). Never touches ../wt-tables.
# Usage: tests/e2e/v2server.sh            -> prints the data dir; stop: re-running the script restarts it
set -e
cd "$(dirname "$0")/../.."
WT=$(pwd); REF=${V2_REF:-origin/v2-tables}; X=/tmp/p4b-v2tables; PORT=${PORT:-3581}
# stop OUR previous server only: the listener on $PORT whose cwd is the export dir (never another builder's process)
for pid in $(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2); do
  case "$(readlink /proc/$pid/cwd)" in /tmp/p4b-v2tables*) kill $pid;; esac
done
for i in 1 2 3 4 5 6 7 8 9 10; do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
git fetch -q origin
rm -rf "$X"; mkdir -p "$X"; git archive "$REF" | tar -x -C "$X"
ln -s "$WT/node_modules" "$X/node_modules"
[ -d "$X/public/games/coldcall" ] && cp -r "$X/public/games/coldcall" /tmp/p4b-coldcall && rm -rf "$X/public" || rm -rf "$X/public"
cp -r "$WT/public" "$X/public"
[ -d /tmp/p4b-coldcall ] && cp -r /tmp/p4b-coldcall "$X/public/games/coldcall" && rm -rf /tmp/p4b-coldcall
D=$(mktemp -d /tmp/p4b-v2data.XXXX)
(cd "$X" && DATA_DIR=$D PORT=$PORT RIG=${RIG:-1} setsid nohup node server.js > $D/server.log 2>&1 < /dev/null &)
sleep 3; echo "$D"; echo "ref $(git rev-parse --short "$REF")"; tail -3 "$D/server.log"
