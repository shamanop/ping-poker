#!/usr/bin/env python3
"""Builds the tables of REPORT.md from out/<tag>-*.json and out/extras.json: python3 report.py <sha> [outdir]  -> prints markdown (the narrative parts are written by hand)."""
import json, sys, glob, os
sha = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
legs = []
for spec in [('540', 'play'), ('540', 'chips'), ('1440', 'play'), ('1440', 'chips'), ('360d', 'play'), ('360d', 'chips')]:
    f = os.path.join(out, f'{sha}-{spec[0]}-{spec[1]}.json')
    legs.append((spec, json.load(open(f)) if os.path.exists(f) else None))
print('| leg | rounds | forced bonuses hit (n) | decisions (pick / take / hang / timeout) | buys | fast-click cases | fails | result |')
print('|---|---|---|---|---|---|---|---|')
for spec, d in legs:
    name = f'{spec[0]} {spec[1]}'
    if not d: print(f'| {name} | - | - | - | - | - | - | did not run |'); continue
    if not d.get('finished'): print(f'| {name} | - | - | - | - | - | - | did not finish |'); continue
    c = d.get('counts', {}); forced = ', '.join(f'{k}:{v["n"]}' for k, v in d.get('forced', {}).items()) or '-'
    dec = d.get('decisions', {}); buys = ', '.join(f'{b["id"]}{"" if b.get("ok") else "(!)"}' for b in d.get('buys', [])) or '-'
    cs = d.get('cases', {}); cases = ', '.join(f'{k}:{"ok" if v.get("ok") else "FAIL"}' for k, v in cs.items()) or '-'
    print(f'| {name} | {c.get("rounds")} ({c.get("actions")} actions) | {forced} | {dec.get("pick")} / {dec.get("take")} / {dec.get("hang")} / {dec.get("timeout")} | {buys} | {cases} | {len(d.get("fails", []))} | {"PASS" if d.get("pass") else ("FAIL" if d.get("fatal") is None else "FATAL")} |')
print()
for spec, d in legs:
    if not d or not d.get('finished'): continue
    e = d.get('end') or {}
    print(f'- {spec[0]} {spec[1]}: end sums {e.get("sumByCurrency")}, escrows non-zero {e.get("escrowsNonZero")}, pool:coldcall:office {[p["v"] for p in e.get("pool", [])]}, screen {e.get("screen")} = wallet_get {e.get("wallet_get")} = ledger {e.get("ledger")}; big win {d.get("big")}; start balance {e.get("startBalance")}')
    if d.get('dockInfo'): print(f'  - docked window: {json.dumps(d["dockInfo"])}')
print()
for spec, d in legs:
    if not d: continue
    for f in d.get('fails', []):
        r = [x for x in d['rounds'] if x.get('i') == f.get('round')]
        r = r[0] if r else {}
        print(f'- FAIL {spec[0]} {spec[1]} round {f.get("round")}: {f.get("what")} | {json.dumps({k: v for k, v in f.items() if k not in ("round", "what")})[:500]} | round row: kind {r.get("kind")} label {r.get("label")} before {r.get("before")} cost {r.get("cost")} win {r.get("win")} after {r.get("after")} meter {r.get("meter")}')
