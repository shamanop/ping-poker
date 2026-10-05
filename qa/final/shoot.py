#!/usr/bin/env python3
"""D3 layout QA. Scratch server on 3217 only. Usage: shoot.py WxH [tag]"""
import os, signal, subprocess, sys, time, urllib.request, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'qa', 'final'); PORT = 3217; URL = f'http://localhost:{PORT}/'
W, H = map(int, (sys.argv[1] if len(sys.argv) > 1 else '1440x900').split('x'))
TAG = sys.argv[2] if len(sys.argv) > 2 else str(W)
BANK = os.path.join(OUT, f'bank-{PORT}.json')
if os.path.exists(BANK): os.remove(BANK)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': BANK}, stdout=open(os.path.join(OUT, 'server.log'), 'w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
HELPER = """([name, avatar]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null, last = '';
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => {
    if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
    const key = gs.handNum + gs.street + gs.pot + gs.currentBet; if (key === last) return; last = key;
    const toCall = gs.currentBet - gs.players[my].roundBet;
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? 'call' : 'check' }), window.__botDelay || 400);
  });
  s.on('connect', () => s.emit('join_game', { name, avatar, password: 'ping' }));
  (window.__socks = window.__socks || []).push(s);
})"""
errs = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width': W, 'height': H}); p = ctx.new_page()
        p.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
        p.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:200]))
        p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
        p.screenshot(path=f'{OUT}/landing-{TAG}.png')
        p.fill('#player-name', 'Chris'); p.fill('#password-input', 'ping'); p.wait_for_timeout(200)
        p.click('#btn-join')
        p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
        for nm, av in [('Liam', '🦊'), ('Rob', '🐻'), ('Vinny', '🦁'), ('Matt', '🐺'), ('Adam', '🐯')]:
            p.evaluate(HELPER, [nm, av]); p.wait_for_timeout(250)
        def st(): return p.evaluate("(() => { const g = state.gameState; if (!g) return null; return { street: g.street, status: g.status, cur: g.currentPlayerIdx, my: state.myIdx, n: g.players.filter(x=>x.cardCount>0).length, hand: g.handNum }; })()")
        def wait(cond, to=60):
            t = time.time()
            while time.time() - t < to:
                s = st()
                if s and cond(s): return s
                p.wait_for_timeout(120)
            raise RuntimeError('timeout ' + json.dumps(st()))
        def act_if_turn():
            s = st()
            if s and s['status'] == 'playing' and s['cur'] == s['my']:
                p.click('#btn-check-call'); p.wait_for_timeout(300)
        # reach flop with all 6 dealt and human to act
        t0 = time.time(); got = None
        while time.time() - t0 < 120:
            s = st()
            if s and s['status'] == 'playing' and s['n'] >= 6 and s['street'] == 'flop' and s['cur'] == s['my']:
                got = s; break
            act_if_turn(); p.wait_for_timeout(150)
        print('flop state', got)
        p.wait_for_timeout(900)
        # chat + sticker for visuals
        p.fill('#chat-input', 'GL'); p.press('#chat-input', 'Enter'); p.wait_for_timeout(500)
        p.screenshot(path=f'{OUT}/final-{TAG}.png')
        print('shot final', errs)
        print(p.evaluate("(() => { const q=s=>document.querySelector(s); const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]}; return {pill:r(q('.seat.hero .seat-pill')), tm:r(q('.seat.hero .seat-timer')), l2:r(q('.seat.hero .seat-l2')), chat:r(q('#chat-messages')), chatn:q('#chat-messages').children.length, chatVis:getComputedStyle(q('#chat-messages')).display, topseat:r(q('.seat:not(.hero)')), head:r(q('.g-head'))}; })()"))
        # preset test
        p.click('#raise-presets .pre:nth-child(3)'); p.wait_for_timeout(200)
        print('after Pot preset input=', p.input_value('#raise-input'))
        p.screenshot(path=f'{OUT}/preset-{TAG}.png')
        # act, then wait for a not-your-turn state with slow bots
        p.evaluate("window.__botDelay = 4000")
        p.click('#btn-check-call'); p.wait_for_timeout(300)
        t0 = time.time()
        while time.time() - t0 < 60:
            s = st()
            if s and s['status'] == 'playing' and s['cur'] != s['my'] and s['n'] >= 3: break
            act_if_turn(); p.wait_for_timeout(150)
        p.wait_for_timeout(700)
        p.screenshot(path=f'{OUT}/notturn-{TAG}.png')
        print('notturn', st(), 'precall hidden?', p.evaluate("document.getElementById('bar-pre').classList.contains('hidden')"))
        # arm pre-select
        if p.evaluate("!document.getElementById('pre-call').disabled"): p.click('#pre-call')
        else: p.click('#pre-checkfold')
        p.wait_for_timeout(500)
        p.screenshot(path=f'{OUT}/preselect-{TAG}.png')
        print('pre classes', p.evaluate("[...document.querySelectorAll('.act-pre')].map(b=>b.className)"))
        # bank
        p.click('#bank-btn'); p.wait_for_timeout(900)
        p.screenshot(path=f'{OUT}/bank-{TAG}.png')
        bar = p.evaluate("(() => { const r = document.getElementById('action-bar').getBoundingClientRect(), b = document.getElementById('bank-panel').getBoundingClientRect(); return { barTop: r.top, bankBottom: b.bottom, bankLeft: b.left }; })()")
        print('bank vs bar', bar)
        print('errors', errs)
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
