#!/bin/bash
cd /home/isabelle/.openclaw/workspace/ping-poker-v2/qa/uiaudit3/work
echo "{\"testplayer\":7000}" > bank.json; rm -f ledger.json
PORT=4461 BANK_FILE=$PWD/bank.json LEDGER_FILE=$PWD/ledger.json exec node server.js
