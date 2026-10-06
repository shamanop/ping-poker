"""Step H proof (v2 server): bust_out -> rebuy panel -> the server charges exactly what the box promised.
Runs on the POKERPING-style chips table (fund chips) and a created Play $ table (fund play): sit at the minimum, shove every
hand against a calling bot until busted, then check: the panel shows the descriptor's bounds/default, the `rebuy` frame carries
the typed amount + fund, the server seats exactly that stack (next game_state) and the bank/wallet drops by exactly that amount
(`money` event), and an over-limit amount sends nothing."""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = os.path.dirname(os.path.abspath(__file__))
c = Checks()

def my(pg): return pg.evaluate("(() => { const g = window.__gs; return g && g.you ? g.players[g.you.idx] : null })()")
def shove_until_bust(pg):
    for _ in range(80):
        if pg.evaluate("!document.getElementById('bust-panel').classList.contains('hidden')"): return True
        try: pg.wait_for_function("(window.__gs && window.__gs.legalActions && !document.getElementById('btn-check-call').disabled) || !document.getElementById('bust-panel').classList.contains('hidden')", timeout=60000)
        except Exception:
            print('DEBUG stuck:', pg.evaluate("JSON.stringify({la: window.__gs && window.__gs.legalActions, st: window.__gs && window.__gs.status, pl: window.__gs && window.__gs.players.map(p => [p.name, p.chips, p.roundBet]), btn: [document.getElementById('btn-check-call').disabled, document.getElementById('btn-raise').disabled]})"))
            return False
        if pg.evaluate("!document.getElementById('bust-panel').classList.contains('hidden')"): return True
        pg.wait_for_timeout(200)
        if pg.evaluate("!document.getElementById('btn-raise').disabled"):
            pg.locator('#raise-box .amt-pre').last.click(); pg.click('#btn-raise')
        else:
            pg.click('#btn-check-call')
        pg.wait_for_timeout(700)
    return False

def run(pg, fr, label, create):
    bot = None; code = 'POKERPING'
    try:
        pg.wait_for_timeout(1800); pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e => e.remove())")
        pg.evaluate("window.__money = null; PingSocket.on('money', m => { window.__money = m })")
        if create:
            pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form'); pg.click('#lb-create-submit')
            pg.wait_for_selector('#lb-sit', timeout=10000)
        else:
            pg.locator('button', has_text='JOIN').first.click(); pg.wait_for_selector('#lb-buyin-input', timeout=8000)
        pg.fill('#lb-buyin-input', '500'); pg.click('#lb-sit'); pg.wait_for_selector('#player-seats .seat', timeout=15000)
        code = [f.get('tableId') for f in fr.of('table_join')][-1]
        pg.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('bust_out', b => { window.__bust = b })")
        bot = subprocess.Popen(['node', os.path.join(HERE, 'bot.js'), 'ua1', code, '5000' if create else '20000'], stdout=open('/tmp/p4b-bot.log', 'w'), stderr=subprocess.STDOUT)
        c.ok('%s: busted by shoving' % label, shove_until_bust(pg))
        d = pg.evaluate("window.__bust"); rb = d and d.get('rebuy')
        c.ok('%s: bust_out carries the rebuy descriptor' % label, rb and all(k in rb for k in ('allowed', 'fund', 'balance', 'min', 'max', 'default')))
        if not rb: return
        c.eq('%s: fund matches the table' % label, rb['fund'], 'play' if create else 'chips')
        c.ok('%s: rebuy allowed and a button is shown' % label, rb['allowed'] and pg.evaluate("!document.getElementById('btn-rebuy').classList.contains('hidden')"))
        pg.wait_for_selector('#rebuy-input', state='visible')
        want = rb['min'] + 100
        # bad amounts first: over the max and under the min send nothing
        for bad in [str(min(rb['max'], rb['balance']) + 1), str(rb['min'] - 1)]:
            pg.fill('#rebuy-input', bad); fr.clear(); pg.click('#btn-rebuy', force=True); pg.wait_for_timeout(300)
            c.eq('%s: %s sends no rebuy' % (label, bad), fr.of('rebuy'), [])
        pg.fill('#rebuy-input', str(want))
        before = pg.evaluate("(() => { const m = window.__money; return m ? (%s) : null })()" % ("m.bank" if not create else "m.wallet.play"))
        fr.clear(); pg.click('#btn-rebuy'); pg.wait_for_timeout(1500)
        sent = fr.of('rebuy')
        c.eq('%s: rebuy frame amount + fund' % label, [(f.get('amount'), f.get('fund')) for f in sent], [(want, rb['fund'])])
        me = my(pg)
        c.eq('%s: server seated exactly the typed stack' % label, me and me['chips'] + me['roundBet'], want)
        after = pg.evaluate("(() => { const m = window.__money; return m ? (%s) : null })()" % ("m.bank" if not create else "m.wallet.play"))
        c.eq('%s: bank/wallet dropped by exactly the amount (money event)' % label, (before - after) if before is not None and after is not None else None, want)
        c.ok('%s: bust panel closed after the server seated the chips' % label, pg.evaluate("document.getElementById('bust-panel').classList.contains('hidden')"))
    finally:
        if bot: bot.terminate(); time.sleep(1.5)
        try: pg.evaluate("c => PingSocket.emit('table_leave', { tableId: c })", code); pg.wait_for_timeout(800)   # one seat per account: leave before the next table
        except Exception: pass

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, create in [('chips table', False), ('Play $ table', True)]:
        pg = b.new_page(viewport={'width': 1440, 'height': 900}); fr = Frames(pg)
        sign_in(pg, 'chris'); set_pref(pg, 'chips')
        run(pg, fr, label, create)
        pg.close()
    b.close()
c.done('rebuy_v2.py')
