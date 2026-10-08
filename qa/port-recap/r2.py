#!/usr/bin/env python3
"""Recap round 2 browser leg (critic r1 #6 and #7). Usage: python3 qa/port-recap/shoot.py <port> <tables.json> [WxH ...]
Needs a dev server (RIG=1 SIGNUP_PLAY_CENTS=1000000) and `node qa/port-recap/bots.js <port> <tables.json>` running.
One human (Ann) plays the chips table and the Play $ table, then opens the recap from the table bar, the Bank header and the night-end screen."""
import json, os, sys
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); TABLES = sys.argv[2]
SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[3:]] or [(360, 740), (540, 900), (1440, 900)]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'r2')
URL = f'http://127.0.0.1:{PORT}/'
tables = json.load(open(TABLES))
problems = []
seen_kinds = set()
def note(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True)
def overflow(p, tag):
    r = p.evaluate("""() => { const o = document.getElementById('rc-root'); if (!o || !o.classList.contains('open')) return null;
      const bad = []; const vw = document.documentElement.clientWidth;
      const sheet = o.querySelector('.rc-sheet'); const sr = sheet.getBoundingClientRect();
      o.querySelectorAll('.rc-sheet *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > sr.right + 1 || r.left < sr.left - 1) && !e.closest('.rc-scroll') ) bad.push((e.className || e.tagName) + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); });
      const sx = [...o.querySelectorAll('.rc-sheet, .rc-body, .rc-col, .rc-card, .rc-scroll')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
      return { vw, docScroll: document.documentElement.scrollWidth > vw + 1, outside: bad.slice(0, 6), hscroll: sx.slice(0, 6) }; }""")
    if r and (r['docScroll'] or r['outside'] or r['hscroll']):
        problems.append((tag, r)); note('  OVERFLOW', tag, json.dumps(r))
    return r
SIGNIN = """async ([name]) => { const s = window.PingSocket; const wait = (ev) => new Promise(r => s.once(ev, r));
  const p1 = Promise.race([wait('auth_ok'), wait('auth_error')]); s.emit('auth_signup', { name, pin: '1234', avatar: 'a02' }); let r = await p1;
  if (r && r.code === 'name_taken') { const p2 = Promise.race([wait('auth_ok'), wait('auth_error')]); s.emit('auth_login', { name, pin: '1234' }); r = await p2; }
  return !!(r && r.account); }"""
AUTOPLAY = """(tid) => { const s = window.PingSocket; if (window.__auto) s.off('game_state', window.__auto); let last = '';
  window.__hands = window.__hands || 0; if (!window.__shd) { window.__shd = true; s.on('showdown_result', () => { window.__hands++; }); }
  window.__auto = (gs) => { if (gs.status !== 'playing' || gs.paused) return; const me = gs.players.findIndex(p => p.name === 'Ann'); if (me < 0 || gs.currentPlayerIdx !== me) return;
    const sig = gs.handNum + '|' + gs.street + '|' + gs.currentBet + '|' + gs.pot; if (sig === last) return; last = sig; const toCall = gs.currentBet - gs.players[me].roundBet;
    const raise = gs.street === 'preflop' && toCall <= gs.bb && gs.handNum % 4 === 2 && gs.players[me].chips > gs.bb * 6;
    setTimeout(() => s.emit('player_action', raise ? { roomId: tid, action: 'raise', amount: gs.bb * 3 } : { roomId: tid, action: toCall > 0 ? 'call' : 'check' }), 300); };
  s.on('game_state', window.__auto); }"""
def clear_modals(p):
    # a brand-new account gets the daily streak calendar; close it the way a player would (Escape, then its own button)
    for _ in range(3):
        if not p.locator('.pj-modal.open').count(): return
        p.keyboard.press('Escape'); p.wait_for_timeout(200)
        if p.locator('.pj-modal.open').count():
            b = p.locator('.pj-modal.open button').last
            try: b.click(timeout=1500)
            except Exception: pass
            p.wait_for_timeout(300)
def shot(p, name):
    path = f'{OUT}/{name}.jpg'
    p.screenshot(path=path, type='jpeg', quality=62); note('  shot', os.path.basename(path))

def visible(p, sel): return p.evaluate("(s) => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 }", sel)
def leg(b, w, h):
    t = tables['chips']; tag = f'{w}x{h}'
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    p.on('pageerror', lambda e: (problems.append((tag, 'pageerror ' + str(e)[:160])), note('  PAGEERROR', str(e)[:160])))
    p.goto(URL, wait_until='load'); p.wait_for_function("window.PingSocket && window.PingSocket.connected", timeout=10000)
    assert p.evaluate(SIGNIN, ['Ann']), 'sign in failed'
    p.wait_for_timeout(600)
    p.evaluate("([tid]) => window.PingSocket.emit('table_join', { tableId: tid, buyIn: 3000 })", [t['id']])
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=10000)
    p.evaluate(AUTOPLAY, t['id'])
    p.wait_for_function("window.__hands >= 2", timeout=120000); p.wait_for_timeout(400); clear_modals(p)
    # --- #6: a night_get reply (what the Bank / night list asks for) must not hide the Recap buttons of the table we are still seated at
    p.wait_for_selector('#rc-table-btn:not(.hidden)', timeout=5000)
    shot(p, f'{tag}-1-table-recap-button')
    got = p.evaluate("""async (nid) => { const s = window.PingSocket; const p = new Promise(r => s.once('settle_up', r)); s.emit('night_get', { nightId: nid }); const d = await p; return { ended: d.ended, nightId: d.nightId }; }""", t['nightId'])
    note('  settle_up arrived', got); p.wait_for_timeout(500)
    cur = p.evaluate("() => window.Recap.state.cur"); note('  Recap.state.cur after a settle_up for the LIVE night:', json.dumps(cur))
    if not cur: problems.append((tag, 'a night_get reply cleared the viewer table (state.cur)'))
    p.wait_for_selector('.lb-settle #lb-recap', timeout=5000); shot(p, f'{tag}-2-settle-screen-over-table')
    # the lobby shows the settle screen over the table; go back to the lobby and return to the seat the way the lobby does (table_join -> table_joined)
    p.click('#lb-back'); p.wait_for_timeout(500)
    p.evaluate("([tid]) => window.PingSocket.emit('table_join', { tableId: tid, buyIn: 3000 })", [t['id']])
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active') && !document.getElementById('lobby-root').classList.contains('on')", timeout=10000); p.wait_for_timeout(600); clear_modals(p)
    ok_table = visible(p, '#rc-table-btn'); note('  #rc-table-btn visible back at the table:', ok_table)
    if not ok_table: problems.append((tag, 'Recap table button missing after returning from the settle screen'))
    shot(p, f'{tag}-3-table-after-settle-screen')
    p.click('#bank-btn'); p.wait_for_timeout(700)
    ok_bank = visible(p, '#rc-bank-btn'); note('  #rc-bank-btn visible in the Bank header:', ok_bank)
    if not ok_bank: problems.append((tag, 'Recap Bank button missing'))
    shot(p, f'{tag}-4-bank-header')
    p.click('#rc-bank-btn'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(300)
    shot(p, f'{tag}-5-recap-opens'); overflow(p, tag + '-opens')
    p.keyboard.press('Escape'); p.wait_for_timeout(200); p.click('#bank-close'); p.wait_for_timeout(200)
    # --- #7: the server answers a recap_get with an error whose code is not 'recap': the loading state must end
    p.evaluate("""() => { const s = window.PingSocket; if (!window.__realEmit) window.__realEmit = s.emit.bind(s);
      s.emit = function (ev, ...a) { if (ev === 'recap_get' && window.__swallow) return s; return window.__realEmit(ev, ...a); }; window.__swallow = true; }""")
    p.click('#rc-table-btn'); p.wait_for_selector('#rc-loading', timeout=3000); p.wait_for_timeout(300)
    shot(p, f'{tag}-6-loading'); note('  loading shown')
    p.evaluate("() => window.PingSocket.emitReserved('error', { message: 'Server error', code: 'internal' })")
    p.wait_for_selector('#rc-error', timeout=3000)
    still = p.locator('#rc-loading').count()
    txt = p.inner_text('#rc-error'); note('  after a non-recap error:', repr(txt.replace('\n', ' | ')), 'loading elements:', still)
    if still: problems.append((tag, 'still loading after a non-recap error'))
    shot(p, f'{tag}-7-error-with-retry-close'); overflow(p, tag + '-error')
    p.evaluate("() => { window.__swallow = false; }")
    p.click('#rc-retry'); p.wait_for_selector('.rc-hand', timeout=8000); p.wait_for_timeout(300)
    note('  Try again loaded', p.locator('.rc-hand').count(), 'hands')
    shot(p, f'{tag}-8-retry-loaded')
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    # an error with no answer at all: ends after the client timeout (only at one size, it waits 16 s)
    if w == 1440:
        p.evaluate("() => { window.__swallow = true; }")
        p.click('#rc-table-btn'); p.wait_for_selector('#rc-loading', timeout=3000)
        p.wait_for_selector('#rc-error', timeout=18000); note('  silence ended the loading state:', repr(p.inner_text('#rc-error').replace('\n', ' | ')))
        shot(p, f'{tag}-9-timeout')
        p.click('#rc-err-close'); p.wait_for_timeout(200)
        if p.evaluate("document.getElementById('rc-root').classList.contains('open')"): problems.append((tag, 'Close did not close'))
    ctx.close()
with sync_playwright() as pw:
    b = pw.chromium.launch()
    try:
        for (w, h) in SIZES:
            note('==', w, h); leg(b, w, h)
    finally:
        b.close()
note('PROBLEMS', len(problems))
for pr in problems: note('  ', pr)
sys.exit(1 if problems else 0)
