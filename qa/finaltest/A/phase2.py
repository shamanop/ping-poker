#!/usr/bin/env python3
"""FINAL TEST A phase 2: one real chromium 1920x1080 human (Hume) vs 2 scripted bots, 3 hands. Own server :3111 only."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); URL = 'http://127.0.0.1:3111/'
EXPECTED = sys.argv[1]
LOG = open(f'{D}/phase2.log', 'w')
def log(*a):
    s = f'[{time.time()-T0:5.1f}s] ' + ' '.join(str(x) for x in a); print(s, flush=True); LOG.write(s + '\n'); LOG.flush()
T0 = time.time()
console, reqfail, http, pageerr = [], [], [], []
bots = None
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1920, 'height': 1080}); p = ctx.new_page()
    p.on('console', lambda m: (console.append((m.type, m.text[:200])), log('[console]', m.type, m.text[:160])) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: (pageerr.append(str(e)[:300]), log('[pageerror]', str(e)[:200])))
    p.on('requestfailed', lambda r: (reqfail.append(r.url), log('[reqfail]', r.url[-80:], r.failure)))
    p.on('response', lambda r: (http.append((r.status, r.url)), log('[http>=400]', r.status, r.url[-80:])) if r.status >= 400 else None)
    p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
    p.fill('#player-name', 'Hume'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    p.click('#btn-join')
    p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
    log('human joined lobby')
    bots = subprocess.Popen(['node', f'{D}/bots.js', EXPECTED], cwd=D, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(40):
        n = p.evaluate("() => (document.getElementById('lobby-count')||{}).textContent")
        if '3' in (n or ''): break
        p.wait_for_timeout(250)
    log('lobby-count text:', n)
    p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
    p.wait_for_timeout(1200)
    shots = 0
    def shot(name):
        global shots
        p.screenshot(path=f'{D}/shot-{name}.png'); shots += 1; log('shot', name)
    S = "() => { const gs = state.gameState; return { st: gs && gs.status, cur: gs && gs.currentPlayerIdx, my: state.myIdx, street: gs && gs.street, hand: gs && gs.handNum, sd: !document.getElementById('showdown-overlay').classList.contains('hidden'), ctl: !document.getElementById('btn-check-call').disabled, stacks: gs && gs.players.map(x => x.name + ':' + x.chips + (x.folded ? 'F' : '')).join(' '), pot: gs && gs.pot, ph: gs && gs.players.length } }"
    plan = {1: 'call', 2: 'raise', 3: 'fold'}
    done_hands = {}; last_log = ''; acted_hand = set(); sd_seen = set(); t0 = time.time(); shot_done = set()
    hand_info = {}
    while time.time() - t0 < 240:
        g = p.evaluate(S)
        h = g['hand']
        if h and h not in hand_info: hand_info[h] = {'start': time.time(), 'stacks0': g['stacks']}; log(f'HAND {h} start: {g["stacks"]}')
        if g['sd'] and h not in sd_seen:
            sd_seen.add(h); p.wait_for_timeout(700)
            txt = p.evaluate("() => document.getElementById('showdown-content').innerText.replace(/\\n+/g,' | ').slice(0,300)")
            log(f'HAND {h} RESULT overlay: {txt}  dur={time.time()-hand_info[h]["start"]:.1f}s')
            hand_info[h]['overlay'] = txt; hand_info[h]['dur'] = time.time() - hand_info[h]['start']
            if h == 1 and 'sd' not in shot_done: shot('2-showdown'); shot_done.add('sd')
            if h >= 3: p.wait_for_timeout(500); shot('4-final'); break
        if g['ctl'] and g['st'] == 'playing' and g['cur'] == g['my']:
            key = (h, g['street'])
            act = plan.get(h, 'call')
            if h == 1 and 'turn' not in shot_done: p.wait_for_timeout(400); shot('1-my-turn'); shot_done.add('turn')
            if act == 'raise' and g['street'] == 'preflop' and 'raise' not in acted_hand:
                acted_hand.add('raise')
                p.click('#raise-presets .pre:nth-child(2)'); p.wait_for_timeout(250)
                if 'rz' not in shot_done: shot('3-raise-preset'); shot_done.add('rz')
                before = p.evaluate("() => state.gameState.players[state.myIdx].chips")
                p.click('#btn-raise'); log(f'HAND {h} human raised (chips before {before}) raise-input={p.evaluate("() => document.getElementById(\"raise-input\").value")}')
            elif act == 'fold':
                log(f'HAND {h} human folds at {g["street"]}'); p.click('#btn-fold')
            else:
                p.click('#btn-check-call')
            p.wait_for_timeout(900)
        else:
            p.wait_for_timeout(250)
    log('hands seen', sorted(hand_info), 'screens', shots)
    final = p.evaluate(S); log('final state', json.dumps(final))
    dom_stacks = p.evaluate("() => document.getElementById('player-seats').innerText.replace(/\\n+/g,' | ').slice(0,400)")
    log('DOM seats text:', dom_stacks)
    json.dump({'hands': {str(k): {kk: vv for kk, vv in v.items() if kk != 'start'} for k, v in hand_info.items()}, 'console': console, 'pageerrors': pageerr, 'reqfail': reqfail, 'http_err': http, 'final': final, 'dom_seats': dom_stacks}, open(f'{D}/phase2-result.json', 'w'), indent=1)
    bots.terminate(); ctx.close(); b.close()
log('DONE')
