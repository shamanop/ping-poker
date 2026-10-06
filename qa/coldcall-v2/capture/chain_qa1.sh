#!/bin/bash
# full QA r1 matrix, one browser at a time: node qa1.js <size> <currency>
cd /home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-v2/capture
mkdir -p ../qa1
for s in narrow wide docked; do for c in play chips; do
  echo "=== $s $c $(date +%T)" >> ../qa1/chain.log
  timeout 3000 node qa1.js $s $c > ../qa1/$s-$c.log 2>&1
  tail -1 ../qa1/$s-$c.log >> ../qa1/chain.log
done; done
echo "=== done $(date +%T)" >> ../qa1/chain.log
