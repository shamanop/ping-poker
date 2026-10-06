"""UI wave 1 capture: walks the fixed state list in a real chromium against a throwaway server and writes small JPEGs.
Usage: E2E_BASE=http://127.0.0.1:4720 python3 qa/ui-basement/shots.py <before|after> <WxH> [players=2] [states=all]
  players = seats at the table including the hero (2..8); states = all | a comma list of state names
Output: qa/ui-basement/<tag>/<WxH>_p<players>_<NN>-<state>.jpg    (the same names before and after, so the contact sheets line up)
Only ids / data attributes are used to drive the page, so the same script runs on both sides of the restyle."""
import os, sys, time, json
UIB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(UIB, '..', '..', 'tests', 'e2e', 'sweep'))
os.environ.setdefault('SWEEP_SHOTS', '/tmp/uib-raw')
import lib
tag, size = sys.argv[1], sys.argv[2]
players = int(sys.argv[3]) if len(sys.argv) > 3 else 2
want = (sys.argv[4] if len(sys.argv) > 4 else 'all').split(',')
W, H = map(int, size.split('x'))
lib.VIEWS['x'] = (W, H)
from lib import *
OUT = os.path.join(UIB, tag); os.makedirs(OUT, exist_ok=True)
order = ['signin', 'lobby', 'bonus', 'create', 'buyin', 'seat', 'waiting', 'host', 'preselect', 'myturn', 'raise', 'showdown', 'bust', 'bank', 'chat', 'settle', 'profile']
missing = []
AUDITS = {}
GEOMS = {}

def snap(sc_or_page, name, full=False):
    if want != ['all'] and name not in want: return
    n = order.index(name) + 1
    path = os.path.join(OUT, '%s_p%d_%02d-%s.jpg' % (size, players, n, name))
    page = sc_or_page
    try:
        page.screenshot(path=path, type='jpeg', quality=58, full_page=full)
        print('shot', os.path.relpath(path, UIB))
        if os.environ.get('GEOM'):
            g = page.evaluate(open(os.path.join(UIB, 'geom.js')).read())
            GEOMS[name] = g
            print('  geom %s: overlaps %s | offscreen %s | small targets %s' % (name, [(o['a'], o['b'], o['px']) for o in g['overlaps']], g['offscreen'][:6], g['smallTargets'][:6]))
        if os.environ.get('AUDIT'):
            a = page.evaluate(open(os.path.join(UIB, 'audit.js')).read())
            AUDITS[name] = a
            print('  audit %s: %d text nodes, %d under size, %d under 4.5:1, %d on art' % (name, a['n'], len(a['small']), len(a['low']), a['img']))
    except Exception as e:
        missing.append(name); print('MISSING', name, e)

def settle_ui(page, ms=900): time.sleep(ms / 1000)

def run():
    with sync_playwright() as pw:
        bots = [('b%d' % (i + 1), 2000, 'none') for i in range(players - 1)]
        sc = Scene(pw, 'x', 'chips', 2000, bots, hero_host=True, settings={'name': 'Basement Nights'},
                   rig=None)
        p = sc.p
        try:
            # 1. sign-in screen (before any account)
            sc.s.goto(); p.wait_for_selector('#lb-name', timeout=15000); time.sleep(0.8)
            snap(p, 'signin')
            # sign up, the bonus modal opens on its own
            up = p.locator('.seg button[data-tab="up"], .lb-seg button[data-tab="up"]')
            up.first.click() if up.count() else None
            p.fill('#lb-name', sc.hero_name); p.fill('#lb-pin', '4321'); p.click('#lb-submit')
            try: p.wait_for_selector('.pj-modal', timeout=8000); time.sleep(1.2)
            except Exception: pass
            snap(p, 'bonus')
            sc.s.dismiss_modals(); time.sleep(0.5)
            p.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', d => { (window.__sd = window.__sd || []).push(d) }); PingSocket.on('bust_out', d => { window.__bust = d })")
            # a listed table by a bot so the lobby has a card to JOIN
            try:
                sc.B.req(sc.bn('b1'), 'table_create', {'settings': dict(sc.base_settings, name='The Back Room', visibility='listed')}, 'table_created')
            except Exception as e: print('listed table:', e)
            p.wait_for_selector('#lb-create-btn', timeout=10000); time.sleep(1.5)
            snap(p, 'lobby')
            # profile card
            try:
                p.click('.sh-acct'); p.wait_for_selector('.lb-modal', timeout=4000); time.sleep(0.6); snap(p, 'profile')
                p.keyboard.press('Escape'); time.sleep(0.4)
                if p.locator('.lb-modal').count(): p.evaluate("document.querySelectorAll('.lb-scrim').forEach(e=>e.remove())")
            except Exception as e: missing.append('profile'); print('profile', e)
            # create form
            p.click('#lb-create-btn'); p.wait_for_selector('#lb-create-submit', timeout=8000); time.sleep(0.8)
            snap(p, 'create', full=False)
            p.locator('#lobby-root button', has_text='Back to lobby').first.click(); time.sleep(0.5)
            # buy-in modal from a lobby card (the fund picker lives here)
            try:
                p.locator('#lobby-root button', has_text='Join').first.click(); p.wait_for_selector('#lb-buyin-input', timeout=6000); time.sleep(0.9)
                snap(p, 'buyin'); p.click('#lb-cancel'); time.sleep(0.4)
            except Exception as e: missing.append('buyin'); print('buyin', e)
            sc.hero_create()
            # the host lands on the share screen, which carries the buy-in
            p.wait_for_selector('#lb-buyin-input', timeout=8000); time.sleep(0.9)
            snap(p, 'seat')
            p.fill('#lb-buyin-input', '2000'); p.click('#lb-sit'); p.wait_for_selector('#player-seats .seat', timeout=15000)
            p.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', d => { (window.__sd = window.__sd || []).push(d) }); PingSocket.on('bust_out', d => { window.__bust = d })")
            sc.hook(); time.sleep(1.4)
            snap(p, 'waiting')
            # everyone sits; rig: hero KK vs AA (a loser the hero will bust on)
            holes = [['Ks', 'Kd'], ['As', 'Ad']] + [[c1, c2] for c1, c2 in [('Qs', 'Qd'), ('Js', 'Jd'), ('Ts', 'Td'), ('9s', '9d'), ('8s', '8d'), ('7s', '7d')]][:players - 2]
            sc.B.rig(sc.host, holes, ['2c', '7h', '9h', 'Jc', '4s'])
            sc.bots_sit()
            for n, st, pol in sc.bots_spec: sc.B.policy(sc.bn(n), 'none')
            time.sleep(1.0)
            # host drawer
            try:
                p.click('#host-btn'); p.wait_for_selector('#host-drawer', timeout=4000); time.sleep(0.6); snap(p, 'host')
                p.evaluate("(document.getElementById('host-start')||{click(){}}).click()"); time.sleep(0.8)
                p.evaluate("(document.getElementById('host-close')||{click(){}}).click()"); time.sleep(0.3)
            except Exception as e: missing.append('host'); print('host', e)
            # hand runs, bots on 'none': hero is either on turn or pre-selecting
            t0 = time.time(); first = None
            while time.time() - t0 < 25:
                if sc.my_turn(): first = 'turn'; break
                if p.evaluate("document.getElementById('action-bar').classList.contains('preselect')"): first = 'pre'; break
                time.sleep(0.2)
            print('first state:', first)
            def go_calls():
                for n, st, pol in sc.bots_spec: sc.B.policy(sc.bn(n), 'call')
            if first == 'pre':
                time.sleep(0.5); snap(p, 'preselect'); go_calls()
                sc.wait_turn(25)
            else:
                pass
            time.sleep(0.8)
            if sc.my_turn():
                snap(p, 'myturn')
                try:
                    p.locator('#raise-box .amt-pre').nth(1).click(); time.sleep(0.4)
                except Exception as e: print('preset', e)
                snap(p, 'raise')
            if first == 'turn':
                p.click('#btn-check-call'); time.sleep(0.7)
                for _ in range(20):
                    if p.evaluate("document.getElementById('action-bar').classList.contains('preselect')"): break
                    time.sleep(0.25)
                time.sleep(0.4); snap(p, 'preselect'); go_calls(); time.sleep(0.5)
                sc.wait_turn(25)
            # chat message while the hand is live
            try:
                if not p.is_visible('#chat-input'):
                    p.click('#btn-rail-toggle'); time.sleep(0.6)
                p.fill('#chat-input', 'nice hand, see you at the river'); p.press('#chat-input', 'Enter'); time.sleep(0.6)
                snap(p, 'chat')
                if p.evaluate("document.getElementById('game-screen').classList.contains('rail-open')"): p.click('#btn-rail-toggle'); time.sleep(0.4)
            except Exception as e: missing.append('chat'); print('chat', e)
            # go all in until the showdown
            def allin(gs): return 'allin'
            t0 = time.time(); n0 = len(p.evaluate('window.__sd || []')); last = None; shown = False
            while time.time() - t0 < 90:
                if len(p.evaluate('window.__sd || []')) > n0: break
                if sc.my_turn():
                    gs = sc.gs(); sig = (gs['handNum'], gs['street'], gs['currentBet'], gs['pot'])
                    if sig != last:
                        last = sig
                        try:
                            p.locator('#raise-box button', has_text='ALL-IN').first.click(); time.sleep(0.3); p.click('#btn-raise'); time.sleep(0.5)
                        except Exception:
                            p.click('#btn-check-call')
                time.sleep(0.25)
            time.sleep(1.2)
            snap(p, 'showdown')
            # bust panel
            for _ in range(30):
                if not p.evaluate("document.getElementById('bust-panel').classList.contains('hidden')"): break
                time.sleep(0.3)
            time.sleep(4.0); snap(p, 'bust')
            # bank
            try:
                p.click('#bank-btn'); time.sleep(1.4); snap(p, 'bank'); p.click('#bank-close'); time.sleep(0.4)
            except Exception as e: missing.append('bank'); print('bank', e)
            # end night -> settle up
            try:
                p.evaluate("document.getElementById('host-btn').click()"); p.wait_for_selector('#host-end', timeout=4000); p.evaluate("document.getElementById('host-end').click()"); time.sleep(0.5)
                p.evaluate("document.getElementById('host-end-confirm').click()"); p.wait_for_selector('.lb-settle', timeout=15000); time.sleep(1.0)
                snap(p, 'settle')
            except Exception as e: missing.append('settle'); print('settle', e)
        finally:
            sc.close()
    json.dump({'missing': missing}, open(os.path.join(OUT, '%s_p%d_missing.json' % (size, players)), 'w'))
    if GEOMS: json.dump(GEOMS, open(os.path.join(OUT, '%s_p%d_geom.json' % (size, players)), 'w'), indent=1)
    if AUDITS: json.dump(AUDITS, open(os.path.join(OUT, '%s_p%d_audit.json' % (size, players)), 'w'), indent=1)
    print('missing:', missing)

run()
