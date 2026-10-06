#!/bin/bash
# local smoke: tools/lv-s.sh cfg.json spins [extra args]  -> one-screen summary of --stream
cfg=$1; n=$2; shift 2
CC_MAX_THREADS=${T:-4} nice -n 10 node /home/frank/.openclaw/workspace/projects/ping-coldcall-pull/tools/levers-pull.js --stream $n ${SEED:-1} --cfg @$cfg --json "$@" | node /home/frank/.openclaw/workspace/projects/ping-coldcall-pull/tools/lv-sum.js
