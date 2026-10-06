#!/bin/bash
# usage: tools/lv-run.sh <name> <cfg.json|-> <sim.js> <sim args...>      (levers agent, Part 3)
# Copies the current engine + sims to shaman E:\bricklord-test\coldcall-levers (never C:), runs <sim.js> with 24 threads and the cfg file
# (merged over CFG by the sim's --cfg), pulls <name>.json (and the printed text as <name>.txt) back to cold-call/levers-runs/.
W=/home/frank/.openclaw/workspace/projects/ping-coldcall-pull
name=$1; cfg=$2; sim=$3; shift 3
D=E:/bricklord-test/coldcall-levers
scp -q $W/games/coldcall-engine.js $W/games/coldcall-sim.js $W/tools/levers-pull.js shaman:$D/games/ 2>/dev/null || scp -q $W/games/coldcall-engine.js $W/games/coldcall-sim.js shaman:$D/games/ || exit 1
CA=""
if [ "$cfg" != "-" ]; then scp -q "$cfg" shaman:$D/$name.cfg.json || exit 1; CA="--cfg @$name.cfg.json"; fi
ssh shaman "set CC_MAX_THREADS=24&& cd /d E:\\bricklord-test\\coldcall-levers&& node games\\$sim $* $CA --threads 24 --json --out $name.json" > $W/cold-call/levers-runs/$name.txt 2>&1
scp -q shaman:$D/$name.json $W/cold-call/levers-runs/ 2>/dev/null
tail -c 1500 $W/cold-call/levers-runs/$name.txt | head -c 1500 | cut -c1-400 | tail -12
