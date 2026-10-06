#!/bin/bash
# usage: probe.sh <tag> <port> <scene> '<cats json>' [url]
cd /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1; T=$1; P=$2; S=$3; C=$4
E='E:/bricklord-test/coldcall-fb5'; EW='E:\bricklord-test\coldcall-fb5'
ssh shaman "mkdir $EW\\rig 2>nul & mkdir $EW\\runs\\$T 2>nul" >/dev/null 2>&1
scp -q qa/coldcall-fb1/fps/rig/{cdp.mjs,launch.mjs,gpuprobe.mjs,page.js,scenes.js,cleanup.ps1} shaman:$E/rig/
echo "{\"tag\":\"$T\",\"base\":\"http://100.104.51.99:$P/games/coldcall/index.html\",\"scene\":\"$S\",\"cats\":$C,\"url\":\"${5:-?nosplash}\"${6:+,\"dump\":$6}${7:+,\"early\":true}${8:+,\"css\":\"$8\"}${9:+,\"winIdx\":$9}${10:+,\"snap\":${10}}${11:+,\"passes\":${11}}${12:+,\"layers\":${12}}${13:+,\"js\":\"${13}\"}${14:+,\"mut\":${14}}}" > _scratch/fb1perf/$T.args.json
scp -q _scratch/fb1perf/$T.args.json shaman:$E/runs/$T/args.json
ssh shaman "cd /d $EW\\rig && node gpuprobe.mjs $EW\\runs\\$T\\args.json" 2>&1 | tee _scratch/fb1perf/res/$T.txt
ssh shaman "rmdir /s /q $EW\\runs\\$T" >/dev/null 2>&1
