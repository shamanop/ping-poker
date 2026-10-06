#!/bin/bash
# live server on 4610 (COLDCALL_TEST=1). One account per run. Forced cases are real engine rounds through the normal spend/credit path.
cd "$(dirname "$0")"
run() { echo "== live $*"; CCNAME=live$RANDOM timeout 3000 node selfcheck.js live "$@" | grep -v "^rounds"; }
run 20
for f in phone close tease big bonus1 bonus2 bonus3; do run 3 $f; done
run 1 - call
run 1 - bonus1
run 1 - bonus2
run 1 - hunt
echo CHAIN-DONE
