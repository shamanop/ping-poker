#!/bin/bash
# re-run the existing drivers affected by FB1 against this worktree's server (4651; the seeded ones start their own on 4652). Usage: run_legacy.sh > log
cd "$(dirname "$0")/../../.." || exit 1
L=qa/coldcall-fb1/fb1/legacy; export CCPORT=4651
run() { echo "### $*"; flock _scratch/locks/chrome.lock "$@" 2>&1 | grep -v "^$" | cut -c1-600 | tail -12; }
run node $L/flow.js all Play
run node $L/flow.js all chips
for m in play chips; do run node $L/f1_badge.js $m; done
for m in chips play; do run node $L/f1_cross.js $m; done
for s in u8 u14 u15 u16; do run node $L/f1_misc.js $s play; done
run node $L/f1_skiptap.js spin play 3
run node $L/f1_skiptap.js board play 3
run node $L/f1_timer.js
CCPORT=4652 run node $L/f1_u17.js play
CCPORT=4652 run node $L/f1_u17.js chips
for k in drop reload restart; do CCPORT=4652 run node $L/f1_drop.js $k play more; done
echo "### DONE"
