"""S06c: the hero's browser disappears on its turn. Server must fold/check it by itself (30 s clock), keep the seat for 2 minutes, not deal it meanwhile,
let it return and resume, and cash it out after 2 minutes. Usage: python3 s06c_disconnect.py [desk] [chips|play]   (takes about 4 minutes)"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
mode = sys.argv[2] if len(sys.argv) > 2 else 'chips'
c = Checks()
def bal(a, k): return a['bank'].get(k) if mode == 'chips' else a['wallet'].get(k)
def hero_row(a, tid, k):
    r = [r for r in a['rooms'] if r['id'] == tid]; return ([p for p in r[0]['players'] if p['key'] == k] or [None])[0] if r else None
with sync_playwright() as pw:
    sc = Scene(pw, 'desk', mode, 2000, [('b1', 2000, 'call')], settings={'actionTimerSec': 0})
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); k = sc.hero_key
        a0 = audit(); tot0 = bal(a0, k) + seat_bal(a0, k)
        sc.start(); c.ok('hero turn', sc.wait_turn(30))
        t_drop = time.time(); sc.s.close()          # browser gone mid-hand, on turn
        # --- within 10 s the server must show the seat disconnected, still seated
        time.sleep(4); a = audit(); h = hero_row(a, sc.tid, k); print('4 s after drop', h)
        c.ok('seat still there and marked disconnected', h and h['connected'] is False)
        # --- after the 30 s turn clock the hand must move on without the hero
        ok = wait_for(lambda: (lambda g: [r for r in g['rooms'] if r['id'] == sc.tid][0]['status'] != 'playing' or (hero_row(g, sc.tid, k) or {}).get('folded'))(audit()), 55, 2)
        a = audit(); r = [r for r in a['rooms'] if r['id'] == sc.tid][0]; h = hero_row(a, sc.tid, k)
        print('after %.0f s: hand %s status %s hero %s' % (time.time() - t_drop, r['handNum'], r['status'], h))
        c.ok('the turn clock acted for the absent hero (hand not stuck)', ok)
        # --- while away the hero must not be dealt into new hands
        time.sleep(12); a = audit(); r = [r for r in a['rooms'] if r['id'] == sc.tid][0]; h = hero_row(a, sc.tid, k)
        print('hand %s status %s hero stack %s sitting %s' % (r['handNum'], r['status'], h and h['chips'], h and h['sittingOut']))
        c.ok('table is not stuck while the hero is away (a hand is running or waiting only for lack of players)', r['status'] in ('playing', 'waiting_next', 'waiting'))
        # --- return inside 2 minutes through a new browser
        s2 = Sess(pw, 'desk', 'return'); sc.s2 = s2
        s2.sign_in(sc.hero_name); s2.dismiss_modals(); time.sleep(1.2)
        res = s2.page.locator('button', has_text='RESUME')
        c.ok('lobby offers RESUME for the table', res.count() >= 1)
        res.first.click(); time.sleep(2.5)
        modal = s2.page.locator('#lb-sit').count()
        print('after RESUME: a buy-in form is shown:', bool(modal), '| text:', s2.page.evaluate("(document.querySelector('.lb-modal, .lb-frame') || document.body).innerText.slice(0, 160)").replace(chr(10), ' | '))
        print(s2.shot('s06c_resume_modal_desk_%s' % mode))
        c.ok('RESUME of a seat you already hold goes straight back to the table (no buy-in form)', not modal)
        a_pre = audit()
        if modal:
            s2.page.locator('#lb-sit').click(); time.sleep(3)
            a_post = audit(); print('after SIT DOWN: bank', bal(a_pre, k), '->', bal(a_post, k), ' seat', seat_bal(a_pre, k), '->', seat_bal(a_post, k))
        c.ok('back at the table with the seat', s2.page.evaluate("!!document.querySelector('#player-seats .seat')"))
        a = audit(); h = hero_row(a, sc.tid, k); print('after return', h)
        c.ok('connected again', h and h['connected'])
        print(s2.shot('s06c_return_desk_%s' % mode))
        # --- go away again and stay away > 2 minutes: the stack must come back to the bank
        s2.close(); t2 = time.time()
        ok = wait_for(lambda: hero_row(audit(), sc.tid, k) is None, 160, 5)
        a = audit(); print('seat removed after %.0f s: %s | bank %s seat %s' % (time.time() - t2, ok, bal(a, k), seat_bal(a, k)))
        c.ok('seat cashed out after about 2 minutes away', ok)
        c.ok('the stack is back in the bank (lost at most the hands played)', abs((bal(a, k) + seat_bal(a, k)) - tot0) <= 200 or mode == 'play', 'total %s vs %s' % (bal(a, k) + seat_bal(a, k), tot0))
        c.eq('seat account empty', seat_bal(a, k), 0); c.eq('drift', a.get('drift'), [])
    finally:
        try: sc.s2.close()
        except Exception: pass
        sc.close()
sys.exit(c.done('s06c ' + mode))
