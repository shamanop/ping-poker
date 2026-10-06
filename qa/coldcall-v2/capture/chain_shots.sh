#!/bin/bash
cd "$(dirname "$0")"
for s in shots1 shots2 shots3 misc docked; do echo "== $s"; timeout 3000 node $s.js; done
echo CHAIN-DONE
