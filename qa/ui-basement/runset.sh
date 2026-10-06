#!/bin/bash
# Run the whole capture set for one tag against a fresh server: qa/ui-basement/runset.sh <before|after>
# One chromium at a time; the server is restarted between runs so accounts and tables never pile up.
cd "$(dirname "$0")/../.."
TAG=$1; export NODE_PATH=$PWD/node_modules E2E_BASE=http://127.0.0.1:4720
for run in "1440x900 2" "1280x720 2" "390x844 2" "390x844 3" "390x844 6" "390x844 8" "844x390 2" "844x390 6"; do
  qa/ui-basement/server.sh > /dev/null; node tests/e2e/claim.js chris > /dev/null
  echo "== $run"; GEOM=${GEOM:-} AUDIT=${AUDIT:-} timeout 420 python3 qa/ui-basement/shots.py $TAG $run 2>&1 | grep -E "^shot|MISSING|missing|first state|Error|error|geom|audit"
done
if [ "$TAG" = after ]; then
  qa/ui-basement/server.sh > /dev/null; node tests/e2e/claim.js chris ua1 ua2 > /dev/null; node tests/e2e/fund.js 5000 chris ua1 ua2 > /dev/null
  for sz in 1440x900 1280x720; do python3 qa/ui-basement/admin_shots.py after $sz 2>&1 | grep -E "^shot|audit"; done
fi
qa/ui-basement/server.sh stop
echo DONE
