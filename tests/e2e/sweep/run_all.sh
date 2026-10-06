#!/bin/bash
# Re-run the whole P5 sweep on a fresh throwaway v2 server (ports 4700-4703 only, play money, data in /tmp). About 35 minutes. Logs: $OUT (default /tmp/sw-run).
# Usage: tests/e2e/sweep/run_all.sh        results: $OUT/summary.txt
cd "$(dirname "$0")/../../.." || exit 1
OUT=${OUT:-/tmp/sw-run}; mkdir -p $OUT; : > $OUT/summary.txt
export NODE_PATH=$PWD/node_modules
# 4700: client proofs (tests/e2e/*.py), accounts chris ua1-3 by1-6 funded
PORT=4700 tests/e2e/sweep/server.sh > $OUT/server4700.txt
E2E_BASE=http://127.0.0.1:4700 node tests/e2e/claim.js chris ua1 ua2 ua3 by1 by2 by3 by4 by5 by6 > /dev/null
E2E_BASE=http://127.0.0.1:4700 node tests/e2e/fund.js 100000 chris ua1 ua2 ua3 by1 by2 by3 by4 by5 by6 > /dev/null
OUT=$OUT/e2e tests/e2e/sweep/rerun_e2e.sh; cat $OUT/e2e/results.txt >> $OUT/summary.txt
# 4701: the sweep scripts (hand delay 5 s so the page can be compared with the server between hands)
PORT=4701 HAND_DELAY_MS=5000 tests/e2e/sweep/server.sh > $OUT/server4701.txt
E2E_BASE=http://127.0.0.1:4701 node tests/e2e/claim.js chris > /dev/null
export E2E_BASE=http://127.0.0.1:4701
cd tests/e2e/sweep
for run in "s01_account.py desk" "s02_hands.py desk chips" "s02_hands.py desk play" "s03_create.py desk" "s05_session.py desk" "s06_bust.py desk chips" "s06_bust.py desk play" \
           "s06b_leave.py desk chips" "s07_host.py desk chips" "s07_host.py desk play" "s08_admin.py desk" "s09_bender.py desk" "s11_phone_geometry.py" "s06c_disconnect.py desk chips"; do
  n=$(echo $run | tr ' ' '_'); timeout 900 python3 $run > $OUT/$n.log 2>&1; echo "$run exit $? :: $(tail -1 $OUT/$n.log | cut -c1-120)" >> $OUT/summary.txt
done
# 4702 has BENDER_ADMIN_TOKEN and takes the wrong-PIN lockout (per name+IP, escalating): last, on its own server
E2E_BASE=http://127.0.0.1:4702 timeout 300 python3 s10_misc.py > $OUT/s10.log 2>&1; echo "s10_misc exit $? :: $(tail -1 $OUT/s10.log | cut -c1-120)" >> $OUT/summary.txt
echo DONE >> $OUT/summary.txt; cat $OUT/summary.txt
