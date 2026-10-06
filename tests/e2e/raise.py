"""Step F proof (v2 server only): the raise box is an AmountInput bounded by the server's legalActions.
Asserts, with the server's own game_state as the record: default = minRaiseTo; every preset, typed amounts (usd/chips pref), the
slider and a mid-flow mode toggle send exactly what the box shows; the amount the server recorded (roundBet in the next
game_state) equals it; out-of-range typed amounts send nothing; a whole-stack commit that did not come from the All-in preset
asks for confirmation; a game_state while the box is focused and dirty does not rewrite the text (S1-2).
Needs: v2 server on E2E_BASE (tests/e2e/v2server.sh), accounts chris + ua1 funded (claim.js, fund.js)."""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = os.path.dirname(os.path.abspath(__file__))
bot = subprocess.Popen(['node', os.path.join(HERE, 'bot.js'), 'ua1', 'POKERPING', '20000'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
c = Checks()

def la(pg): return pg.evaluate("window.__gs && window.__gs.legalActions")
def wait_turn(pg):
    pg.wait_for_function("window.__gs && window.__gs.legalActions && !document.getElementById('btn-fold').disabled", timeout=120000)
    pg.wait_for_timeout(250)
def box_units(pg):
    return pg.evaluate("(() => { const m = Money.modeFor(Money.pref, window.__unit || 'chips'); const r = Money.parse(document.getElementById('raise-input').value, m); return r.ok ? r.units : null })()")
def my_bet(pg):
    return pg.evaluate("(() => { const g = window.__gs; return g.players[g.you.idx].roundBet })()")
def fold_out(pg, fr):
    fr.clear(); pg.click('#btn-fold'); pg.wait_for_timeout(600)
def act_raise(pg, fr, expect, label, via='click'):
    fr.clear(); pg.evaluate("window.__first = null; PingSocket.once('game_state', gs => { window.__first = gs.players[gs.you.idx].roundBet })")
    if via == 'enter': pg.press('#raise-input', 'Enter')
    else: pg.click('#btn-raise')
    pg.wait_for_timeout(900)
    sent = [f.get('amount') for f in fr.of('player_action') if f.get('action') == 'raise']
    c.eq('%s: raise amount sent' % label, sent, [expect])
    c.eq('%s: server recorded roundBet (first game_state after the action)' % label, pg.evaluate('window.__first'), expect)

try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); fr = Frames(pg)
    sign_in(pg, 'chris'); set_pref(pg, 'chips')
    pg.locator('button', has_text='JOIN').first.click(); pg.wait_for_selector('#lb-buyin-input', timeout=8000)
    pg.fill('#lb-buyin-input', '20000'); pg.click('#lb-sit'); pg.wait_for_selector('#player-seats .seat', timeout=15000)
    pg.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs })")
    wait_turn(pg)
    L = la(pg)
    c.ok('legalActions present on my turn', L and L['canRaise'])
    c.eq('box default = minRaiseTo', box_units(pg), L['minRaiseTo'])
    c.ok('presets include All-in = maxRaiseTo', pg.evaluate("[...document.querySelectorAll('#raise-box .amt-pre')].some(b => /all-in/i.test(b.textContent))"))
    c.eq('slider ends: min stop is minRaiseTo', pg.evaluate("document.getElementById('raise-box').querySelector('.amt-slider').min"), '0')
    # --- every preset sends what the box shows
    n = pg.evaluate("document.querySelectorAll('#raise-box .amt-pre').length")
    for i in range(n):
        wait_turn(pg); L = la(pg)
        if not L['canRaise']: fold_out(pg, fr); continue
        pg.locator('#raise-box .amt-pre').nth(i).click(); pg.wait_for_timeout(150)
        u = box_units(pg); lab = pg.locator('#raise-box .amt-pre').nth(i).inner_text().replace('\n', ' ')
        c.ok('preset %r value inside [min,max]' % lab, u is not None and L['minRaiseTo'] <= u <= L['maxRaiseTo'])
        if u == L['maxRaiseTo']:   # the All-in preset: no confirmation needed, it was explicit
            act_raise(pg, fr, u, 'preset %s' % lab)
        else:
            act_raise(pg, fr, u, 'preset %s' % lab)
        wait_turn(pg); fold_out(pg, fr)
    # --- typed amounts, chips and usd prefs, Enter submits
    for pref, typed, factor in [('chips', None, 1), ('usd', None, 1)]:
        wait_turn(pg); L = la(pg); set_pref(pg, pref); pg.wait_for_timeout(200)
        want = L['minRaiseTo'] + 50
        txt = ('%d' % want) if pref == 'chips' else ('%.2f' % (want / 100))
        pg.fill('#raise-input', txt); pg.wait_for_timeout(100)
        act_raise(pg, fr, want, 'typed %s (%s pref)' % (txt, pref), via='enter')
        wait_turn(pg); fold_out(pg, fr)
    set_pref(pg, 'chips')
    # --- mode toggle mid-flow keeps the number
    wait_turn(pg); L = la(pg); want = L['minRaiseTo'] + 100
    pg.fill('#raise-input', str(want)); set_pref(pg, 'usd'); pg.wait_for_timeout(300)
    c.eq('mode toggle mid-edit keeps units', box_units(pg), want)
    act_raise(pg, fr, want, 'after mode toggle')
    set_pref(pg, 'chips'); wait_turn(pg); fold_out(pg, fr)
    # --- slider: arrow key moves one stop, the sent amount is the box value
    wait_turn(pg); L = la(pg)
    pg.focus('#raise-box .amt-slider'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(150)
    u = box_units(pg); c.ok('slider moved above the minimum, inside bounds', u is not None and L['minRaiseTo'] < u <= L['maxRaiseTo'])
    act_raise(pg, fr, u, 'slider')
    wait_turn(pg); fold_out(pg, fr)
    # --- out of range sends nothing
    wait_turn(pg); L = la(pg)
    for bad, why in [(str(L['minRaiseTo'] - 1), 'below min'), (str(L['maxRaiseTo'] + 1), 'above max'), ('abc', 'garbage')]:
        pg.fill('#raise-input', bad); fr.clear(); pg.click('#btn-raise'); pg.wait_for_timeout(300)
        c.eq('%s sends nothing' % why, fr.of('player_action'), [])
        c.ok('%s shows a message' % why, pg.inner_text('#raise-box .amt-msg').strip() != '')
    # --- whole stack typed (not the All-in preset) asks for confirmation
    pg.fill('#raise-input', str(L['maxRaiseTo'])); fr.clear(); pg.click('#btn-raise'); pg.wait_for_timeout(300)
    c.eq('whole-stack commit waits for confirmation', fr.of('player_action'), [])
    c.ok('confirm row is visible', pg.evaluate("(() => { const e = document.querySelector('#raise-box .amt-confirm'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' })()"))
    # --- S1-2: a game_state while the box is focused and dirty does not rewrite the text
    pg.fill('#raise-input', str(L['minRaiseTo'] + 7)); pg.focus('#raise-input')
    before = pg.input_value('#raise-input')
    pg.evaluate("(() => { const g = JSON.parse(JSON.stringify(window.__gs)); g.pot += 5; PingSocket.listeners('game_state').forEach(f => f(g)) })()")
    pg.wait_for_timeout(300)
    c.eq('game_state does not rewrite a focused dirty box', pg.input_value('#raise-input'), before)
    b.close()
finally:
    bot.terminate()
c.done('raise.py')
