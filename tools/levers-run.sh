#!/bin/bash
# usage: tools/levers-run.sh <outname> <levers-sim args...>
# Copies the current engine + levers sim from THIS worktree to shaman E:\bricklord-test\coldcall-levers (never C:), runs with 24 threads,
# pulls the json back to cold-call/levers-runs/<outname>.json. For CFG overrides pass --cfg '@file.json' with the file copied first via LEVERS_CFG=path.
W=/home/frank/.openclaw/workspace/projects/ping-coldcall-pull
name=$1; shift
D=E:/bricklord-test/coldcall-levers
ssh shaman "if not exist E:\\bricklord-test\\coldcall-levers\\games mkdir E:\\bricklord-test\\coldcall-levers\\games" >/dev/null 2>&1
scp -q $W/games/coldcall-engine.js $W/games/coldcall-sim.js $W/tools/levers-sim.js $W/tools/pull-sim.js shaman:$D/games/ 2>/dev/null || scp -q $W/games/coldcall-engine.js $W/games/coldcall-sim.js $W/tools/levers-sim.js shaman:$D/games/ || exit 1
[ -n "$LEVERS_CFG" ] && scp -q "$LEVERS_CFG" shaman:$D/cfg.json
ssh shaman "set CC_MAX_THREADS=24&& cd /d E:\\bricklord-test\\coldcall-levers&& node games\\${SIM:-levers-sim.js} $* --threads 24 --out $name.json" 2>&1 | tail -3
mkdir -p $W/cold-call/levers-runs
scp -q shaman:$D/$name.json $W/cold-call/levers-runs/ 2>/dev/null
