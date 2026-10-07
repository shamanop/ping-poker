#!/bin/bash
# THE PULL flow tests: own server on 4641 (fresh data each start, decision timer from CC_DECISION_MS, default 30000). Never touches 4610 or 4640.
cd "$(dirname "$0")/../../.." || exit 1
D=qa/coldcall-v2/capture; S=_scratch/srv41
[ -f $S/pid ] && kill $(cat $S/pid) 2>/dev/null; sleep 0.5
rm -rf $S && mkdir -p $S && echo '{}' > $S/bank.json && echo '[]' > $S/ledger.json
PORT=4641 COLDCALL_TEST=1 CC_DECISION_MS=${CC_DECISION_MS:-30000} BANK_FILE=$PWD/$S/bank.json LEDGER_FILE=$PWD/$S/ledger.json \
  setsid node -r ./$D/bump_timer.js server.js > $S/server.log 2>&1 &
echo $! > $S/pid
