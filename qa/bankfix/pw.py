#!/usr/bin/env python3
"""Bank panel QA on PORT 3312 (3302 is held by another worker). Scratch files in qa/bankfix/."""
import json, os, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'qa', 'bankfix'); PORT = 3312; URL = f'http://localhost:{PORT}/'
bf, lf = os.path.join(D, 'pw-bank.json'), os.path.join(D, 'pw-ledger.json')
for f in (bf, lf):
    if os.path.exists(f): os.remove(f)
n = int(time.time() * 1000)
# legacy-format data: untagged cash-out/buy-in pairs and mixed-case names (must still load)
ev = lambda t, nm, ty, a, bal: {'t': n - t * 60000, 'name': nm, 'type': ty, 'amount': a, 'balanceAfter': bal, 'tableChips': None, 'handNum': 1, 'room': 'OLD'}
legacy = [ev(120 - i * 2, 'chris' if i % 2 else 'Chris', 'cashout' if i % 2 else 'buyin', 1500, 8500) for i in range(30)]
json.dump({'chris': 8500, 'bob': 9000}, open(bf, 'w')); json.dump(legacy, open(lf, 'w'))
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': bf, 'LEDGER_FILE': lf}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
HELPER = """([name]) => new Promise(res => { const s = io({ forceNew: true }); let my = null; s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => { if (gs.status !== 'playing' || gs.currentPlayerIdx !== my) return; const me = gs.players[my]; setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: gs.currentBet - me.roundBet > 0 ? 'call' : 'check' }), 300); });
  s.on('connect', () => s.emit('join_game', { name, avatar: 'x', password: 'ping' })); (window.__s = window.__s || {})[name] = s; })"""
res = []
def check(c, m): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + m, flush=True)
def join(p, name):
    p.goto(URL, wait_until='load'); p.wait_for_timeout(600)
    p.fill('#player-name', name); p.fill('#password-input', 'ping'); p.click('#btn-join')
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(800)
def strip(p): return p.evaluate("[...document.querySelectorAll('#bank-total .pl')].map(e => e.querySelector('label').textContent + '=' + e.querySelector('b').textContent).join(' | ')")
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}); p = ctx.new_page()
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        join(p, 'chris')
        p.click('#bank-btn'); p.wait_for_timeout(1500); p.screenshot(path=f'{D}/01-legacy-open.png')
        print(strip(p))
        for i in range(4):
            join(p, ['Chris', 'CHRIS', 'chris', 'Chris'][i]); p.click('#bank-btn'); p.wait_for_timeout(900)
        p.screenshot(path=f'{D}/02-after-refreshes.png')
        rows = p.evaluate("[...document.querySelectorAll('#bank-players .bp-who')].map(e => e.textContent)")
        check(len(rows) == 1, f'one standings row for Chris variants: {rows}')
        # newest feed rows after refreshes: no new pairs
        feed0 = p.evaluate("document.querySelectorAll('#bank-feed .fe').length")
        top = p.evaluate("document.querySelector('#bank-feed .fe')?.textContent")
        print('top of feed after 4 refreshes:', top, '| rows', feed0)
        # second player + auto-start; panel open for a while: no DOM churn
        p.evaluate(HELPER, ['Bob']); p.wait_for_timeout(4500)
        p.click('#bank-close') if p.evaluate("document.getElementById('bank-panel').classList.contains('open')") else None
        p.click('#bank-btn'); p.wait_for_timeout(800)
        p.screenshot(path=f'{D}/03-playing.png')
        # let hands finish & data settle, then count mutations on a quiet interval (waiting_next gap is 5s; use a window with no ledger writes)
        p.evaluate("window.__muts = 0; new MutationObserver(m => { window.__muts += m.length; }).observe(document.getElementById('bank-panel'), { subtree: true, childList: true, characterData: true, attributes: true });")
        p.wait_for_timeout(9000)
        quiet = p.evaluate("window.__muts")
        print('mutations over 9s (2 polls, hand in progress):', quiet)
        check(quiet <= 6, f'panel does not re-render when nothing changed ({quiet} mutations)')
        # scroll position survives refresh
        p.evaluate("const f = document.getElementById('bank-feed'); f.scrollTop = 60;"); p.wait_for_timeout(4500)
        st = p.evaluate("document.getElementById('bank-feed').scrollTop")
        check(st >= 50, f'activity scroll kept across refresh (scrollTop {st})')
        # edit box survives refresh
        p.click('.bp.me .bp-bal b.editable'); p.fill('.bp-edit', '12345'); p.wait_for_timeout(9000)
        check(p.evaluate("document.querySelector('.bp-edit')?.value") == '12345', 'edit box not wiped by refresh')
        p.screenshot(path=f'{D}/04-editing.png')
        p.press('.bp-edit', 'Enter')
        v = p.evaluate("document.querySelector('.bp.me .bp-bal b')?.textContent")
        check(v == '12,345', f'edit shows new value immediately (no flash of old): {v}')
        p.wait_for_timeout(1500)
        v = p.evaluate("document.querySelector('.bp.me .bp-bal b')?.textContent")
        check(v == '12,345', f'edit stays after server refresh: {v}')
        feedtop = p.evaluate("[...document.querySelectorAll('#bank-feed .fe')].slice(0, 3).map(e => e.textContent)")
        print('feed top:', feedtop)
        check(any('Adjusted' in t for t in feedtop), 'adjustment shows in the feed')
        p.wait_for_timeout(500); p.screenshot(path=f'{D}/05-after-edit.png')
        print(strip(p))
        check(not errs, f'no page errors {errs}')
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(5)
print(f'{sum(res)} passed, {len(res) - sum(res)} failed')
