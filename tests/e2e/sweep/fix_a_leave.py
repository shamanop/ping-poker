"""P5 fix A (Q03, Q08). One browser at a time.
 (a) a fresh browser signs in while the account holds a disconnected seat: RESUME opens the table, no buy-in form, bank unchanged.
 (b) a busted seat that comes back through the lobby gets the rebuy panel and no stale board.
 (c) the Leave control exists, is visible at 1440x900, and a leave mid-hand returns bank + stack minus committed (audit()).
Usage: E2E_BASE=http://127.0.0.1:4710 python3 fix_a_leave.py [chips|play]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
mode = sys.argv[1] if len(sys.argv) > 1 else 'chips'
c = Checks(); BOARD = ['2c', '7d', '9h', 'Jc', '4s']
def bal(a, k): return a['bank'].get(k) if mode == 'chips' else a['wallet'].get(k)
def row(a, tid, k):
    r = [r for r in a['rooms'] if r['id'] == tid]; return ([p for p in r[0]['players'] if p['key'] == k] or [None])[0] if r else None
def away(sc):
    return wait_for(lambda: (row(audit(), sc.tid, sc.hero_key) or {}).get('connected') is False, 12, 1)
def resume(pw, sc, tag):
    s2 = Sess(pw, 'desk', tag); s2.sign_in(sc.hero_name); s2.dismiss_modals(); time.sleep(1.2)
    c.ok(tag + ': lobby offers RESUME', s2.page.locator('button', has_text='RESUME').count() >= 1)
    s2.page.locator('button', has_text='RESUME').first.click()
    return s2
def watch(s2, secs=8):
    """Wait up to secs for the table; report whether a buy-in form (#lb-sit) showed up on the way."""
    seen, t0 = False, time.time()
    while time.time() - t0 < secs:
        if s2.page.locator('#lb-sit').count(): seen = True
        if s2.page.evaluate("!!document.querySelector('#player-seats .seat') && document.getElementById('game-screen').classList.contains('active')"): return True, seen
        time.sleep(.25)
    return False, seen

with sync_playwright() as pw:
    # ---- (a) resume a disconnected seat
    sc = Scene(pw, 'desk', mode, 2000, [('b1', 2000, 'call')], settings={'actionTimerSec': 0})
    s2 = None
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); k = sc.hero_key
        a0 = audit(); b0, t0 = bal(a0, k), seat_bal(a0, k)
        sc.s.close(); c.ok('(a) server marks the seat disconnected', away(sc))
        s2 = resume(pw, sc, 'a')
        inside, seen_form = watch(s2)
        c.ok('(a) RESUME opens the table', inside)
        c.ok('(a) no buy-in form was offered', not seen_form and s2.page.locator('#lb-sit').count() == 0)
        time.sleep(1); a1 = audit()
        c.eq('(a) bank unchanged', bal(a1, k), b0); c.eq('(a) seat unchanged', seat_bal(a1, k), t0)
        c.ok('(a) seat is connected again', (row(a1, sc.tid, k) or {}).get('connected') is True)
        print(s2.shot('fixa_a_resume'))
    finally:
        if s2: s2.close()
        sc.close()
    # ---- (b) busted seat comes back through the lobby
    sc = Scene(pw, 'desk', mode, 1000, [('b1', 3000, 'call')], settings={'actionTimerSec': 0, 'rebuys': True, 'buyIn': {'min': 100, 'max': 1000000, 'default': 1000}}, rig=None)
    sc.B.rig_many(sc.host, [[[['Ks', 'Kd'], ['As', 'Ad']], BOARD]])
    s2 = None
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.start()
        c.ok('(b) hero all-in loses', play_hero(sc, lambda gs: 'allin')); time.sleep(1.5)
        k = sc.hero_key; a1 = audit(); b1 = bal(a1, k)
        sc.s.close(); c.ok('(b) busted seat is away', away(sc))
        s2 = resume(pw, sc, 'b')
        inside, seen_form = watch(s2)
        time.sleep(1.5)
        ui = s2.page.evaluate("""(() => { const b = document.getElementById('bust-panel'), r = document.getElementById('btn-rebuy');
          return {open: !b.classList.contains('hidden'), btn: !!r && !r.classList.contains('hidden'), board: document.querySelectorAll('#community-cards > *').length, hero: document.querySelectorAll('#hero-cards-wrap .card, #hero-cards-wrap img').length}; })()""")
        print('(b) after rejoin', ui)
        c.ok('(b) no buy-in form for a seat you hold', not seen_form)
        c.ok('(b) the rebuy panel is open with a Rebuy button', ui['open'] and ui['btn'], str(ui))
        c.eq('(b) no stale board', ui['board'], 0)
        c.eq('(b) no stale hole cards', ui['hero'], 0)
        c.eq('(b) nothing charged by the rejoin', bal(audit(), k), b1)
        print(s2.shot('fixa_b_bust_rejoin'))
    finally:
        if s2: s2.close()
        sc.close()
    # ---- (c) Leave control, mid-hand leave money
    sc = Scene(pw, 'desk', mode, 2000, [('b1', 2000, 'call')], settings={'actionTimerSec': 0})
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); k = sc.hero_key
        a_s = audit(); start_tot = bal(a_s, k) + seat_bal(a_s, k)
        dialogs = []; sc.p.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
        vis = sc.p.evaluate("""(() => { const b = document.getElementById('btn-leave-table'); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
          return {w: r.width, h: r.height, x: r.x, right: r.right, display: cs.display, vis: cs.visibility, text: b.innerText.trim(), inView: r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight}; })()""")
        print('(c) leave control', vis)
        c.ok('(c) Leave control exists and is visible at 1440x900', vis and vis['w'] > 20 and vis['h'] > 12 and vis['display'] != 'none' and vis['inView'], str(vis))
        c.ok('(c) it is labelled "Leave table"', vis and 'leave table' in vis['text'].lower(), str(vis))
        print(sc.s.shot('fixa_c_header', '.g-head'))
        if not vis: raise SystemExit(c.done('fix_a_leave ' + mode + ' (no Leave control, rest skipped)'))
        sc.start(); c.ok('(c) hero on turn', sc.wait_turn(30))
        a1 = audit(); hp = row(a1, sc.tid, k); pre = bal(a1, k)
        print('(c) before leave: wallet/bank', pre, 'seat acct', seat_bal(a1, k), 'start', start_tot)
        print('(c) at leave: stack', hp['chips'], 'handBet', hp['handBet'])
        sc.p.click('#btn-leave-table'); time.sleep(2.5)
        c.ok('(c) confirm text says what happens', dialogs and 'stack goes back to your bank' in dialogs[0] and 'fold' in dialogs[0], str(dialogs))
        c.ok('(c) back in the lobby', sc.p.evaluate("document.getElementById('lobby-root').classList.contains('on')"))
        a2 = audit(); print('(c) after leave:', bal(a2, k), 'seat', seat_bal(a2, k))
        c.eq('(c) seat account emptied', seat_bal(a2, k), 0)
        extra = bal(a2, k) - pre - hp['chips']      # Play $: the one-off bronze tier reward (social.js TIER_REWARD 2500) can land in the same window
        c.ok('(c) bank = bank + stack (committed chips stay in the pot)', extra == 0 or (mode == 'play' and extra == 2500), 'extra %s' % extra)
        c.eq('(c) drift', a2.get('drift'), [])
    finally:
        sc.close()
sys.exit(c.done('fix_a_leave ' + mode))
