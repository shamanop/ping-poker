"""Step G proof (v2 server): the showdown shows NET, never the whole pot as my gain, and lists only pot winners.
1) a real hand played to showdown against the bot: plaque rows == payload winners, each shows the payload's amount;
2) v2-shaped payloads replayed into the page's own handler: loser with a refund is not listed; the win float shows MY net
   (not the pot, nothing when net <= 0); a fold-win shows the amount from the server (no uncalled raise added)."""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = os.path.dirname(os.path.abspath(__file__))
bot = subprocess.Popen(['node', os.path.join(HERE, 'bot.js'), 'ua1', 'POKERPING', '20000'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
c = Checks()
def sd(pg, payload): pg.evaluate("p => PingSocket.listeners('showdown_result').forEach(f => f(p))", payload)
def fmt(pg, u): return pg.evaluate("u => Money.format(u, Money.modeFor(Money.pref, 'chips'))", u)
def rows(pg): return pg.evaluate("[...document.querySelectorAll('#showdown-content .sd-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
def float_text(pg):
    pg.wait_for_timeout(500)
    return pg.evaluate("[...document.querySelectorAll('.win-float')].map(e => e.textContent)")
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); fr = Frames(pg)
    sign_in(pg, 'chris'); set_pref(pg, 'chips')
    pg.locator('button', has_text='JOIN').first.click(); pg.wait_for_selector('#lb-buyin-input', timeout=8000)
    pg.fill('#lb-buyin-input', '20000'); pg.click('#lb-sit'); pg.wait_for_selector('#player-seats .seat', timeout=15000)
    pg.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', p => { window.__sd = p })")
    # 1) real showdown: check/call down
    for _ in range(40):
        if pg.evaluate("!!window.__sd"): break
        try: pg.wait_for_function("(window.__gs && window.__gs.legalActions && !document.getElementById('btn-check-call').disabled) || !!window.__sd", timeout=60000)
        except Exception: break
        if pg.evaluate("!!window.__sd"): break
        pg.click('#btn-check-call'); pg.wait_for_timeout(500)
    real = pg.evaluate("window.__sd")
    c.ok('a real showdown_result arrived', real is not None)
    if real:
        pg.wait_for_timeout(400)
        c.ok('payload carries net (map by name) and winners with amount/net', isinstance(real.get('net'), dict) and all('amount' in w and 'net' in w for w in real['winners']))
        r = rows(pg)
        c.eq('plaque rows == payload winners', len(r), len(real['winners']))
        c.ok('each row shows the payload amount', all(fmt(pg, w['amount']) in r[i] for i, w in enumerate(real['winners'])) if len(r) == len(real['winners']) else False)
    pg.wait_for_timeout(5500)
    me = pg.evaluate("window.__gs.players[window.__gs.you.idx].name")
    # 2a) I lost 100 and got a 50 refund: only ua1 is listed, no win float for me
    sd(pg, {'winners': [{'name': 'ua1', 'handName': 'Pair', 'cards': ['Ah', 'Ad'], 'amount': 300, 'net': 100}], 'pot': 300, 'net': {me: -100, 'ua1': 100}, 'returned': {me: 50}, 'nextMs': 3000, 'reveals': []})
    r = rows(pg)
    c.eq('refund-only seat is not a winner row', len(r), 1)
    c.ok('row names ua1, not me', 'ua1' in r[0] and me not in r[0])
    c.ok('row shows amount 300 and net +100', fmt(pg, 300) in r[0] and 'net +' + fmt(pg, 100) in r[0])
    c.eq('no win float when my net <= 0', float_text(pg), [])
    pg.evaluate("document.getElementById('showdown-overlay').classList.add('hidden')"); pg.wait_for_timeout(300)
    # 2b) I won: pot 300, my net +100 -> float shows +100, not +300
    sd(pg, {'winners': [{'name': me, 'handName': 'Pair', 'cards': ['Ah', 'Ad'], 'amount': 300, 'net': 100}], 'pot': 300, 'net': {me: 100, 'ua1': -100}, 'returned': {}, 'nextMs': 3000, 'reveals': []})
    ft = float_text(pg)
    c.eq('win float shows my NET', ft, ['+' + fmt(pg, 100)])
    # 2c) fold-win: amount from the server (the uncalled raise already returned)
    pg.wait_for_timeout(4000)
    sd(pg, {'winners': [{'name': me, 'handName': 'Everyone folded', 'cards': [], 'amount': 150, 'net': 75}], 'pot': 150, 'net': {me: 75, 'ua1': -75}, 'returned': {me: 200}, 'nextMs': 3000})
    r = rows(pg)
    c.ok('fold-win row shows the server amount 150, not amount + returned', fmt(pg, 150) in r[0] and fmt(pg, 350) not in r[0])
    b.close()
finally:
    bot.terminate()
c.done('showdown.py')
