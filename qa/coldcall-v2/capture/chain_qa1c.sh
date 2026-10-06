#!/bin/bash
cd /home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-v2/capture
rm -f ../qa1/chain3.log; rm -f ../qa1/script-*.json
for t in "narrow play" "narrow chips" "wide play" "wide chips" "docked play" "docked chips"; do set -- $t
  echo "=== $1 $2 $(date +%T)" >> ../qa1/chain3.log
  timeout 3000 node qa1.js $1 $2 > ../qa1/$1-$2.log 2>&1; tail -1 ../qa1/$1-$2.log >> ../qa1/chain3.log
done; echo "=== done $(date +%T)" >> ../qa1/chain3.log
