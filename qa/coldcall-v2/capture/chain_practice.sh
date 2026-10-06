#!/bin/bash
cd "$(dirname "$0")"
echo "== natural x300"; timeout 3600 node selfcheck.js practice 300 | grep -v "^rounds"
for spec in "phone 40" "close 40" "tease 40" "big 6" "bonus1 8" "bonus2 6" "bonus3 6"; do
  set -- $spec
  echo "== $1 x$2"; timeout 3600 node selfcheck.js practice $2 $1 | grep -v "^rounds"
done
echo CHAIN-DONE
