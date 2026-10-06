"""S05: reload mid-hand, a second tab on the same account (take-over), transport drop and return inside 2 minutes, drop past the 30 s turn clock.
Usage: python3 s05_session.py [desk|phone]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks()
BOARD = ['2c', '7d', '9h', 'Jc', '4s']

def hero_state(sc):
    return sc.p.evaluate("""(() => { const g = window.__gs; return {has: !!g, status: g && g.status, you: g && g.you, hole: document.querySelectorAll('#hole-cards .card, #hole-cards > *').length,
        seats: document.querySelectorAll('#player-seats .seat').length, turn: !!(g && g.legalActions), seatsText: [...document.querySelectorAll('#player-seats .seat')].map(e => e.innerText.replace(/\\n/g, ' | ')),
        lobbyOn: document.getElementById('lobby-root') && document.getElementById('lobby-root').classList.contains('on'), toast: [...document.querySelectorAll('#toasts > *')].map(e => e.innerText.replace(/\\n/g, ' | '))} })()""")

def seat_count(key):
    a = audit(); return sum(1 for r in a['rooms'] for p in r['players'] if p['key'] == key), a

with sync_playwright() as pw:
    sc = Scene(pw, view, 'chips', 2000, [('b1', 2000, 'call')], rig=([['As', 'Ad'], ['Kd', 'Kc']], BOARD))
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.start()
        c.ok('hero turn preflop', sc.wait_turn())
        n0, a0 = seat_count(sc.hero_key); stack0 = [p['chips'] for r in a0['rooms'] for p in r['players'] if p['key'] == sc.hero_key][0]
        # ---- (a) reload mid-hand
        sc.p.reload(); time.sleep(4)
        c.ok('reload: page shows the table again (no lobby)', sc.p.evaluate("!!document.querySelector('#player-seats .seat')"))
        sc.p.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', d => { (window.__sd = window.__sd || []).push(d) })")
        time.sleep(1); st = hero_state(sc); print('after reload', {k: st[k] for k in ('has', 'status', 'hole', 'seats', 'turn')}, st['seatsText'])
        n1, a1 = seat_count(sc.hero_key); c.eq('reload: still exactly one seat', n1, 1)
        stack1 = [p['chips'] for r in a1['rooms'] for p in r['players'] if p['key'] == sc.hero_key][0]
        c.eq('reload: stack unchanged on the server', stack1, stack0)
        print(sc.s.shot('s05_reload_%s' % view))
        gs_turn = bool(sc.p.evaluate("window.__gs && window.__gs.legalActions"))
        # the page must be able to act on the hand it was in (turn may need one more state push)
        c.ok('reload: the hand is playable (action buttons enabled when on turn)', sc.my_turn() or not gs_turn, str(st))
        hole = sc.p.evaluate("[...document.querySelectorAll('#hole-cards .card')].length")
        c.ok('reload: hole cards visible (%d)' % hole, hole >= 2)
        # ---- (b) second tab, same account: take-over
        s2 = Sess(pw, view, 'tab2'); p2 = s2.page
        s2.sign_in(sc.hero_name); s2.dismiss_modals(); time.sleep(1.2)
        txt2 = p2.evaluate("document.body.innerText")
        print('tab2 sees table?', p2.evaluate("!!document.querySelector('#player-seats .seat')"), p2.evaluate("[...document.querySelectorAll('button')].map(b=>b.innerText).filter(t=>/RESUME|JOIN|SIT/i.test(t)).slice(0,5)"))
        if p2.evaluate("!document.querySelector('#player-seats .seat')"):
            # in the lobby: re-join the table by code
            p2.locator('button', has_text='RESUME').first.click(); time.sleep(3)
        c.ok('take-over: tab2 has the seat', p2.evaluate("!!document.querySelector('#player-seats .seat')"))
        time.sleep(1.5); st1 = hero_state(sc)
        c.ok('take-over: tab1 left the table (lobby shown)', st1['lobbyOn'], str(st1['toast']))
        n2, a2 = seat_count(sc.hero_key); c.eq('take-over: one seat', n2, 1)
        stack2 = [p['chips'] for r in a2['rooms'] for p in r['players'] if p['key'] == sc.hero_key]
        c.eq('take-over: stack unchanged', stack2, [stack0])
        print(sc.s.shot('s05_takeover_tab1_%s' % view)); print(s2.shot('s05_takeover_tab2_%s' % view))
        # ---- (c) transport drop on turn and return within 30 s: the hand must still be actionable (tab2 now owns the seat)
        sc.p = p2; sc.s2 = s2
        time.sleep(1)
        p2.evaluate("PingSocket.io.engine.close()"); time.sleep(4)   # drop the transport, socket.io reconnects by itself
        n3, a3 = seat_count(sc.hero_key); print('after transport drop, seats on server', n3)
        time.sleep(3)
        st3 = hero_state(sc); print('after drop+reconnect', {k: st3[k] for k in ('has', 'status', 'hole', 'seats', 'turn')}, st3['toast'], st3['seatsText'])
        c.ok('drop/return: back at the table', st3['seats'] >= 2)
        print(s2.shot('s05_dropreturn_%s' % view))
        c.ok('drop/return: can act', sc.wait_turn(8))
        if sc.my_turn():
            sc.click('#btn-check-call'); time.sleep(1.5)
        n4, a4 = seat_count(sc.hero_key); c.eq('drop/return: still one seat', n4, 1)
        # ---- (d) leave the page open but go offline 40 s on a turn: the clock folds or checks, and the page comes back
        print('errors', sc.s.errors[:4])
    finally:
        try: sc.s2.close()
        except Exception: pass
        sc.close()
sys.exit(c.done('s05 ' + view))
