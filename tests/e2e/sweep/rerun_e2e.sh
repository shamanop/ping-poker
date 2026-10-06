#!/bin/bash
# Re-run every tests/e2e/*.py proof against the sweep server. Usage: tests/e2e/sweep/rerun_e2e.sh  (server must be up on E2E_BASE)
cd "$(dirname "$0")/.."
export E2E_BASE=${E2E_BASE:-http://127.0.0.1:4700} E2E_V2=1 NODE_PATH=$(cd ../.. && pwd)/node_modules
OUT=${OUT:-/tmp/sw-e2e}; mkdir -p $OUT; : > $OUT/results.txt
for s in ${SCRIPTS:-buyin create host_drawer rebuy rebuy_v2 bender admin bank raise showdown ui-audit}; do node sweep/leave_all.js chris ua1 ua2 ua3 by1 by2 by3 by4 by5 by6 > /dev/null 2>&1;
  timeout 600 python3 $s.py > $OUT/$s.log 2>&1; echo "$s exit $? :: $(tail -1 $OUT/$s.log | cut -c1-150)" >> $OUT/results.txt
done
if [ -z "$SCRIPTS" ]; then timeout 600 python3 games_shell.py bender > $OUT/games_shell.log 2>&1; echo "games_shell bender exit $? :: $(tail -1 $OUT/games_shell.log | cut -c1-150)" >> $OUT/results.txt; fi
echo DONE >> $OUT/results.txt
