#!/bin/bash
cd "$(dirname "$0")"
for spec in "phone 40" "close 40" "tease 40" "big 25" "bonus1 12" "bonus2 10" "bonus3 10"; do
  set -- $spec
  echo "== $1 x$2"; timeout 3600 node selfcheck.js practice $2 $1 | grep -v "^rounds"
done
echo CHAIN-DONE
