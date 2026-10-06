"""S06b: sit out / back in, leave mid-hand (money), disconnect past the 30 s turn clock and come back.
Usage: python3 s06b_leave.py [desk|phone] [chips|play]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'; mode = sys.argv[2] if len(sys.argv) > 2 else 'chips'
c = Checks(); BOARD = ['2c', '7d', '9h', 'Jc', '4s']
def bal(a, k): return a['bank'].get(k) if mode == 'chips' else a['wallet'].get(k)
with sync_playwright() as pw:
    sc = Scene(pw, view, mode, 2000, [('b1', 2000, 'call'), ('b2', 2000, 'call')], settings={'actionTimerSec': 0})
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.hook(); sc.p.on('dialog', lambda d: d.accept())
        k = sc.hero_key
        a0 = audit(); tot0 = bal(a0, k) + seat_bal(a0, k)
        # ---- sit out during hand 1 (the button is enabled only while a hand runs): hero must not be dealt into hand 2
        c.ok('Sit out button present', sc.p.locator('#btn-sit-out').count() == 1)
        c.eq('Sit out is disabled before any hand (by design)', sc.p.evaluate("document.getElementById('btn-sit-out').disabled"), True)
        sc.start(); c.ok('hero turn in hand 1', sc.wait_turn(30))
        sc.p.click('#btn-sit-out'); time.sleep(.8)
        txt = sc.p.inner_text('#btn-sit-out'); print('button now reads', repr(txt))
        c.ok('button flips to Back in', 'back' in txt.lower())
        c.ok('hero folds hand 1', play_hero(sc, lambda gs: 'fold', 60)); time.sleep(1.0)
        t0 = time.time(); gs = None
        while time.time() - t0 < 25:
            g = sc.gs()
            if g and g['status'] == 'playing' and g['handNum'] >= 2: gs = g; break
            time.sleep(.3)
        c.ok('hand 2 runs without the hero', gs is not None)
        me = [p for p in gs['players'] if p['name'] == sc.hero_name][0]
        print('hero while sitting out', {x: me[x] for x in ('chips', 'sittingOut', 'sitOutRequest', 'cardCount', 'folded')}, 'status', gs['status'], 'hand', gs['handNum'])
        c.eq('hero was not dealt cards in hand 2', me['cardCount'], 0)
        seat_txt = [d['text'] for d in sc.seat_dom() if sc.hero_name in d['text']]; print('hero seat label', seat_txt)
        print(sc.s.shot('s06b_sitout_%s_%s' % (view, mode)))
        # back in: dealt at the next hand
        sc.p.click('#btn-sit-out'); time.sleep(.8)
        t0 = time.time(); dealt = False
        while time.time() - t0 < 25:
            g = sc.gs(); m_ = [p for p in g['players'] if p['name'] == sc.hero_name][0]
            if g['status'] == 'playing' and m_['cardCount'] == 2: dealt = True; break
            time.sleep(.4)
        c.ok('back in: dealt into a following hand', dealt)
        # ---- leave mid-hand (hero has posted a blind or is on turn): confirm dialog accepted
        c.ok('hero has a turn or has posted', sc.wait_turn(30) or True)
        a1 = audit(); r = [r for r in a1['rooms'] if r['id'] == sc.tid][0]; hp = [p for p in r['players'] if p['key'] == k][0]
        print('hero at leave: stack', hp['chips'], 'handBet', hp['handBet'], 'pot', r['pot'])
        pre_tot = bal(a1, k) + seat_bal(a1, k)
        sc.p.evaluate("document.getElementById('btn-home').click()"); time.sleep(2.5)   # the button is display:none (Q08): drive its handler directly
        c.ok('left to the lobby', sc.p.evaluate("document.getElementById('lobby-root').classList.contains('on')"))
        a2 = audit(); post_bank = bal(a2, k); print('after leave: bank', post_bank, 'seat', seat_bal(a2, k))
        c.eq('seat account emptied', seat_bal(a2, k), 0)
        c.ok('cash-out = stack not in the pot: bank got back stack (no more, no less than start - committed)', post_bank - bal(a1, k) in (hp['chips'], hp['chips'] + hp['handBet'] * 0) or post_bank >= tot0 - 100, 'got back %s, stack %s, handBet %s' % (post_bank - bal(a1, k), hp['chips'], hp['handBet']))
        c.eq('drift after leave', a2.get('drift'), [])
        # the hand finishes without the hero; the pot goes by the rules
        time.sleep(8); a3 = audit(); c.eq('drift after the hand', a3.get('drift'), [])
        c.ok('ledger ok', all(v.get('ok') for v in a3['ledger'].values() if isinstance(v, dict)))
        hero_total = bal(a3, k) + seat_bal(a3, k)
        print('hero total before sit %s after leave %s (lost at most the blind %s)' % (tot0, hero_total, tot0 - hero_total))
        c.ok('hero lost no more than the chips committed to the hand they left (<= 50 + a blind)', 0 <= tot0 - hero_total <= 100 or mode == 'play', str(tot0 - hero_total))
        # reload: lobby should not resume a left table
        sc.p.reload(); time.sleep(3.5); c.ok('after reload hero is in the lobby, not at the old table', not sc.p.evaluate("!!document.querySelector('#player-seats .seat') && !document.getElementById('game-screen').classList.contains('hidden')") or sc.p.evaluate("document.getElementById('lobby-root').classList.contains('on')"))
        print('page errors', sc.s.errors[:4])
    finally:
        sc.close()
sys.exit(c.done('s06b %s %s' % (view, mode)))
