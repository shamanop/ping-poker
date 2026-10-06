"""S02: full hands in a real browser against a rigged deck, hero in the browser, bots for the other seats. For every hand the page's seat stacks,
header money and plaque are compared with the server's own __audit and showdown_result.
Usage: python3 s02_hands.py [phone|desk] [chips|play] [scenario ...]   scenarios: foldwin foldlose showdown split sidepots allin"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'; mode = sys.argv[2] if len(sys.argv) > 2 else 'chips'
only = sys.argv[3:]
c = Checks()
BOARD = ['2c', '7d', '9h', 'Jc', '4s']

def seat_stack(text, name=None):
    """First money-looking segment after the name: '1,975' (chips) or '$19.75' (usd pref) -> integer units."""
    segs = [x.strip() for x in text.split('|')]
    if name in segs: segs = segs[segs.index(name) + 1:]
    for seg in segs:
        if __import__("re").fullmatch(r'\$?-?[\d,]+(\.\d\d)?', seg):
            return int(round(float(seg.replace('$', '').replace(',', '')) * (100 if '$' in seg else 1)))
    return None

def compare(sc, label, key_names):
    """Page seat stacks + header vs the server (audit) right after a hand."""
    a, st = sc.server_stacks()
    t0 = time.time()
    while time.time() - t0 < 4:     # the page counts stacks up/down after a hand: give it up to 4 s, then report how long it took
        dom = sc.seat_dom()
        if all(([seat_stack(d['text'], nm) for d in dom if nm in [x.strip() for x in d['text'].split('|')]] or [None])[0] == st.get(nm.lower()) for nm in key_names): break
        time.sleep(.25)
    print(label, 'seat stacks settled after %.1fs' % (time.time() - t0))
    for nm in key_names:
        want = st.get(nm.lower())
        shown = [seat_stack(d['text'], nm) for d in dom if nm in [x.strip() for x in d['text'].split('|')]]
        c.ok('%s: seat %s shows server stack %s (page %s)' % (label, nm, want, shown), shown and shown[0] == want, str(dom))
    return a, st

def settle_checks(sc, label, nets):
    """nets: {key: net} expected from the rig; compare with showdown_result.net and with the server stacks."""
    sd = sc.p.evaluate('window.__sd')[-1]
    for k, v in nets.items():
        c.eq('%s: showdown_result.net[%s]' % (label, k), (sd.get('net') or {}).get(k), v)
    c.eq('%s: nets sum to 0' % label, sum((sd.get('net') or {}).values()), 0)
    return sd

def run(name, hero_stack, bots, rig, fn, nets, extra=None):
    if only and name not in only: return
    print('--', name, view, mode)
    with sync_playwright() as pw:
        sc = Scene(pw, view, mode, hero_stack, bots, rig=rig)
        try:
            sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.start()
            ok = play_hero(sc, fn); c.ok('%s: hand finished' % name, ok)
            if not ok: print(sc.s.shot('s02_%s_%s_%s_stuck' % (name, view, mode))); return
            time.sleep(1.2)
            sd = sc.p.evaluate('window.__sd')[-1]
            names = [sc.hero_name] + [sc.bn(b[0]) for b in bots]
            nets_k = {(sc.hero_key if k == 'hero' else sc.bn(k).lower()): v for k, v in nets.items()}
            # showdown_result.net is keyed by display name
            nets_n = {(sc.hero_name if k == 'hero' else sc.bn(k)): v for k, v in nets.items()}
            for k, v in nets_n.items(): c.eq('%s: showdown_result.net[%s]' % (name, k), (sd.get('net') or {}).get(k), v)
            c.eq('%s: nets sum to 0' % name, sum((sd.get('net') or {}).values()), 0)
            a, st = compare(sc, name, names)
            ctl = sc.p.evaluate("({fold: document.getElementById('btn-fold').disabled, call: document.getElementById('btn-check-call').disabled, raise: document.getElementById('btn-raise').disabled, la: window.__gs && window.__gs.legalActions})")
            c.ok('%s: action buttons are disabled between hands (fold %s call %s raise %s)' % (name, ctl['fold'], ctl['call'], ctl['raise']), ctl['fold'] and ctl['call'] and ctl['raise'] and not ctl['la'])
            c.eq('%s: ledger drift' % name, a.get('drift'), [])
            c.ok('%s: ledger ok' % name, all(v.get('ok') for v in a['ledger'].values() if isinstance(v, dict)) if isinstance(a.get('ledger'), dict) else True, str(a.get('ledger'))[:200])
            h = sc.p.evaluate("document.getElementById('sh-chips').innerText + ' ' + document.getElementById('sh-play').innerText")
            print(name, 'header', h.replace('\n', ' '), 'server bank/wallet', a['bank'].get(sc.hero_key), a['wallet'].get(sc.hero_key), 'at table', seat_bal(a, sc.hero_key))
            plaque = sc.p.evaluate("document.getElementById('showdown-overlay').innerText")
            print(name, 'plaque:', plaque.replace('\n', ' | ')[:300], '| winners:', [(w['name'], w['amount'], w.get('net')) for w in sd['winners']])
            print(sc.s.shot('s02_%s_%s_%s' % (name, view, mode)))
            if extra: extra(sc, sd, a, st)
            print('page errors', sc.s.errors[:3])
        finally:
            sc.close()

# hero is seat 0 = button/SB heads-up; bots follow
run('foldwin', 2000, [('b1', 2000, 'fold')], ([['As', 'Ks'], ['Qd', 'Qc']], BOARD), lambda gs: 'raise:100', {'hero': 50, 'b1': -50})
run('foldlose', 2000, [('b1', 2000, 'call')], ([['As', 'Ks'], ['Qd', 'Qc']], BOARD), lambda gs: 'fold', {'hero': -25, 'b1': 25})
run('showdown', 2000, [('b1', 2000, 'call')], ([['As', 'Ad'], ['Kd', 'Kc']], BOARD), lambda gs: 'call', {'hero': 50, 'b1': -50})
run('split', 2000, [('b1', 2000, 'call')], ([['2c', '3d'], ['4c', '5d']], ['Ts', 'Js', 'Qs', 'Ks', 'As']), lambda gs: 'call', {'hero': 0, 'b1': 0})
run('sidepots', 1000, [('b1', 300, 'allin'), ('b2', 2000, 'call')], ([['Ks', 'Kd'], ['As', 'Ad'], ['Qs', 'Qd']], BOARD),
    lambda gs: 'allin', {'hero': 400, 'b1': 600, 'b2': -1000})
run('allin', 1500, [('b1', 1500, 'call')], ([['As', 'Ad'], ['Kd', 'Kc']], BOARD), lambda gs: 'allin', {'hero': 1500, 'b1': -1500})
sys.exit(c.done('s02 %s %s' % (view, mode)))
