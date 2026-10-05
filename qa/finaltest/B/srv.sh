#!/bin/bash
D=/home/isabelle/.openclaw/workspace/ping-poker-v2
B=$D/qa/finaltest/B
case $1 in
 start) cd $D; PORT=3112 BANK_FILE=$B/bank.json LEDGER_FILE=$B/ledger.json nohup node server.js >> $B/server.log 2>&1 & echo $! > $B/pid; sleep 1;;
 stop) kill $(cat $B/pid);;
 kill9) kill -9 $(cat $B/pid);;
esac
