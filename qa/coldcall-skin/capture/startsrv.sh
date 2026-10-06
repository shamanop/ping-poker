#!/bin/bash
# dev server on 4610 with the QA hook on, all data in _scratch/srv (fresh each time)
cd /home/frank/.openclaw/workspace/projects/ping-coldcall
rm -rf _scratch/srv && mkdir -p _scratch/srv && echo '{}' > _scratch/srv/bank.json && echo '[]' > _scratch/srv/ledger.json
PORT=4610 COLDCALL_TEST=1 BANK_FILE=$PWD/_scratch/srv/bank.json LEDGER_FILE=$PWD/_scratch/srv/ledger.json \
  node server.js > _scratch/srv/server.log 2>&1 &
echo $! > _scratch/srv/pid
