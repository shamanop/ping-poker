#!/bin/bash
cd /home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-v2/capture
for t in "narrow play" "narrow chips" "wide play" "docked play"; do set -- $t
  echo "=== $1 $2 $(date +%T)" >> ../qa1/chain2.log
  timeout 3000 node qa1.js $1 $2 > ../qa1/$1-$2.log 2>&1; tail -1 ../qa1/$1-$2.log >> ../qa1/chain2.log
done; echo "=== done $(date +%T)" >> ../qa1/chain2.log
