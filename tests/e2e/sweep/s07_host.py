"""S07: host tools in the browser: pause/resume mid-hand, blinds change mid-hand, kick mid-hand, end night and the settle-up screen, with the server's numbers as truth.
Usage: python3 s07_host.py [desk|phone] [chips|play]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'; mode = sys.argv[2] if len(sys.argv) > 2 else 'chips'
c = Checks(); BOARD = ['2c', '7d', '9h', 'Jc', '4s']
cur = 'bank' if mode == 'chips' else 'wallet'
def bal(a, key): return a['bank'].get(key) if mode == 'chips' else a['wallet'].get(key)
def drawer_open(sc):
    if not sc.p.locator('#host-drawer').count(): sc.p.click('#host-btn'); sc.p.wait_for_selector('#host-drawer')
def room(a, tid): return [r for r in a['rooms'] if r['id'] == tid][0]

with sync_playwright() as pw:
    sc = Scene(pw, view, mode, 2000, [('b1', 2000, 'call'), ('b2', 2000, 'call')], hero_host=True)
    try:
        sc.hero_in(); sc.hook()
        sc.hero_create(); sc.hero_sit_ui(); sc.bots_sit(); sc.hook()
        keys = [sc.hero_key, sc.bn('b1').lower(), sc.bn('b2').lower()]
        a_start = audit(); start_bal = {k: bal(a_start, k) + seat_bal(a_start, k) for k in keys}
        print('start totals', start_bal)
        c.ok('host button visible to the host', sc.p.locator('#host-btn').count() == 1)
        drawer_open(sc); sc.p.click('#host-start'); time.sleep(1.5)
        c.ok('hand 1 started from the drawer', sc.wait_turn(20))
        # ---- pause mid-hand
        drawer_open(sc); sc.ev_clear(); sc.p.click('#host-pause'); time.sleep(1.2)
        gs = sc.gs(); print('paused flag', gs.get('paused'), 'status', gs.get('status'))
        c.ok('pause: game_state.paused', bool(gs.get('paused')))
        c.ok('pause: hero cannot act (buttons disabled / legalActions null)', (not sc.my_turn()) and not gs.get('legalActions'), str(gs.get('legalActions')))
        banner = sc.p.evaluate("document.body.innerText.toLowerCase().includes('paused')"); c.ok('pause: the page says the table is paused', banner)
        print(sc.s.shot('s07_paused_%s_%s' % (view, mode)))
        t0 = gs['pot']; time.sleep(4); c.eq('pause: nothing moved for 4 s', sc.gs()['pot'], t0)
        drawer_open(sc); sc.p.click('#host-pause'); time.sleep(1.2)
        c.ok('resume: hero can act again', sc.wait_turn(10))
        # ---- blinds change mid-hand: current hand keeps its blinds, the next hand uses the new ones
        sb0, bb0 = sc.gs()['sb'], sc.gs()['bb']
        drawer_open(sc); sc.ev_clear()
        unit_div = 1 if mode == 'chips' else 100
        sc.p.fill('#host-sb', '50' if mode == 'chips' else '0.50'); sc.p.fill('#host-bb', '100' if mode == 'chips' else '1.00'); sc.p.click('#host-blinds-save'); time.sleep(1.5)
        msg = sc.p.evaluate("document.getElementById('host-blinds-msg') && document.getElementById('host-blinds-msg').innerText"); print('blinds msg:', msg)
        gs = sc.gs(); c.eq('blinds change mid-hand: this hand keeps sb/bb', (gs['sb'], gs['bb']), (sb0, bb0))
        # finish the hand: hero folds, bots call down (b2 stays in the hand for the kick below)
        c.ok('hero folds hand 1', play_hero(sc, lambda gs: 'fold', 60))
        time.sleep(1.0); a_h1 = audit()
        c.eq('after hand 1: ledger drift', a_h1.get('drift'), [])
        # ---- hand 2: new blinds applied?
        t0 = time.time(); got = None
        while time.time() - t0 < 20:
            g = sc.gs()
            if g and g.get('status') == 'playing' and g['handNum'] >= 2: got = (g['sb'], g['bb']); break
            time.sleep(.3)
        print('hand 2 blinds', got); c.eq('next hand uses the new blinds', got, (50 if mode == 'chips' else 50, 100))
        c.ok('hand 2: hero on turn', sc.wait_turn(20))
        # ---- kick b2 mid-hand
        a_pre = audit(); r_pre = room(a_pre, sc.tid); committed_b2 = [p for p in r_pre['players'] if p['key'] == keys[2]][0]
        print('b2 before kick', committed_b2)
        drawer_open(sc)
        row = sc.p.locator('#host-drawer .lb-seat', has_text=sc.bn('b2')); c.eq('b2 listed in the drawer', row.count(), 1)
        sc.ev_clear(); row.locator('button', has_text='Kick').click(); time.sleep(1.5)
        a_k = audit(); r_k = room(a_k, sc.tid)
        c.ok('kicked seat is out of the room on the server', keys[2] not in [p['key'] for p in r_k['players']] or [p for p in r_k['players'] if p['key'] == keys[2]][0].get('folded'), str(r_k['players']))
        print('after kick, bank b2', bal(a_k, keys[2]), 'was total', start_bal[keys[2]])
        c.ok('kick: money conserved (drift [] and ledger ok)', a_k.get('drift') == [] and all(v.get('ok') for v in a_k['ledger'].values() if isinstance(v, dict)))
        print(sc.s.shot('s07_kick_%s_%s' % (view, mode)))
        # finish hand 2: hero checks/calls
        play_hero(sc, lambda gs: 'fold', 60); time.sleep(2.0)
        a_k2 = audit()
        b2_final = bal(a_k2, keys[2]) + seat_bal(a_k2, keys[2])
        print('b2 final', b2_final, 'lost at most hand-2 committed', start_bal[keys[2]] - b2_final)
        if mode == 'chips': c.ok('kicked player holds everything except what they put in the pot', 0 <= start_bal[keys[2]] - b2_final <= 400, str(b2_final))   # (Cash wallets also receive achievement mints, so only chips are exact)
        # ---- end night
        drawer_open(sc); sc.p.click('#host-end'); sc.p.wait_for_selector('#host-end-confirm'); sc.ev_clear(); sc.p.click('#host-end-confirm'); 
        c.ok('settle-up screen appears', wait_for(lambda: sc.p.evaluate("!!document.querySelector('.lb-settle')"), 25))
        time.sleep(1.0)
        rows = sc.p.evaluate("[...document.querySelectorAll('.lb-net')].map(e => ({key: e.dataset.key, text: e.innerText.replace(/\\n/g, ' | '), amt: e.querySelector('.amt').innerText}))")
        print('settle rows', rows)
        a_end = audit()
        sds = list({d['handNo']: d for d in (sc.p.evaluate('window.__sd') or [])}.values())   # the page listener is registered twice: dedupe by hand
        names = {sc.hero_key: sc.hero_name, keys[1]: sc.bn('b1'), keys[2]: sc.bn('b2')}
        for k in keys:
            net_server = bal(a_end, k) + seat_bal(a_end, k) - start_bal[k]
            if mode == 'play': net_server = sum((sd.get('net') or {}).get(names[k], 0) for sd in sds)   # wallets also get achievement mints: use the hands' own nets
            r = [x for x in rows if x['key'] == k]
            shown = None
            if r:
                t = r[0]['amt'].replace('$', '').replace(',', '').replace('+', '').strip(); neg = t.startswith('-') or t.startswith('−')
                t = t.lstrip('-−'); shown = int(round(float(t) * (100 if mode == 'play' else 1))) * (-1 if neg else 1) if t.replace('.', '').isdigit() else 0
            c.eq('settle-up net for %s == server bank delta' % k, shown, net_server)
        if mode == 'chips': c.eq('settle-up nets sum to 0 on the server', sum(bal(a_end, k) + seat_bal(a_end, k) - start_bal[k] for k in keys), 0)
        c.eq('nobody left at the table after the night', sum(seat_bal(a_end, k) for k in keys), 0)
        print(sc.s.shot('s07_settle_%s_%s' % (view, mode)))
        print('page errors', sc.s.errors[:4])
    finally:
        sc.close()
sys.exit(c.done('s07 %s %s' % (view, mode)))
