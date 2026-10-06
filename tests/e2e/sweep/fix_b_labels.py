"""P5 fix B proofs: Q01 blind badges vs posted blinds, Q04 bonus window units, Q07 create refusal units, Q06 seats stepper cap, Q05 busted seat label.
Usage: E2E_BASE=http://127.0.0.1:4715 python3 fix_b_labels.py [desk|phone]   (one browser at a time, exit 1 on any failed check)"""
import re, sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks(); tag = '%d' % (int(time.time()) % 100000)

SEATS = """(() => ({gs: window.__gs, seats: [...document.querySelectorAll('#player-seats .seat')].map(e => ({
  name: (e.querySelector('.seat-name') || {}).textContent, tag: ((e.querySelector('.seat-tag') || {}).textContent || '').trim(), status: ((e.querySelector('.seat-status') || {}).textContent || '').trim()}))}))()"""

def badges(label, bots, sit_out=None):
    """Hero + idle bots, nobody acts: the seat tags in the DOM must be the seats whose roundBet equals the posted blind."""
    with sync_playwright() as pw:
        sc = Scene(pw, view, 'chips', 2000, [(n, 2000, 'none') for n in bots], rig=None, tag=tag + label[:2])
        try:
            sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit()
            if sit_out: sc.B.emit(sc.bn(sit_out), 'sit_out', {'roomId': sc.tid}); time.sleep(.4)
            sc.start(); c.ok(label + ': hand started', sc.wait_status('playing', 15)); time.sleep(.8)
            r = sc.p.evaluate(SEATS); gs = r['gs']; pl = gs['players']
            by_name = {s['name']: s['tag'] for s in r['seats']}
            want = {p['name']: ('SB' if p['roundBet'] == gs['sb'] else 'BB' if p['roundBet'] == gs['bb'] else '') for p in pl}
            print(label, 'posted:', {p['name']: p['roundBet'] for p in pl}, 'dom tags:', by_name)
            c.eq(label + ': seat badges = seats that posted %s/%s' % (gs['sb'], gs['bb']), by_name, want)
            print(sc.s.shot('fix_b_badges_' + label[:2]))
        finally: sc.close()

def bonus_text(p):
    return p.evaluate("(() => ({days: [...document.querySelectorAll('.pj-day .da')].map(e => e.textContent.trim()), claim: ((document.querySelector('.pj-modal .claim') || {}).textContent || '').trim()}))()")

def bonus():
    with sync_playwright() as pw:
        s = Sess(pw, view, 'bonus'); p = s.page
        try:
            s.sign_up('bn' + tag); p.wait_for_selector('.pj-modal .pj-day', timeout=8000); time.sleep(.6)
            want = ['$100', '$125', '$150', '$200', '$250', '$350', '$1,000']
            for pref in ('auto', 'chips', 'usd'):
                if pref != 'auto':
                    p.keyboard.press('Escape'); time.sleep(.6)
                    p.evaluate("Money.setPref('%s')" % pref); time.sleep(.3)
                    p.click('#sh-bonus'); p.wait_for_selector('.pj-modal .pj-day', timeout=6000); time.sleep(.5)
                t = bonus_text(p); print('bonus pref', pref, t)
                c.eq('bonus window day amounts, pref %s' % pref, t['days'], want)
                c.eq('bonus window claim button, pref %s' % pref, t['claim'], 'CLAIM $100')
            print(s.shot('fix_b_bonus'))
        finally: s.close()

def create_refusals():
    with sync_playwright() as pw:
        s = Sess(pw, view, 'create'); p = s.page
        try:
            s.sign_up('cf' + tag); s.dismiss_modals(); time.sleep(.5)
            p.click('#lb-create-btn'); p.wait_for_selector('#lb-form'); s.dismiss_modals()
            # Q06: stepper from 8 (the default) must stay at 8
            seats = lambda: p.inner_text('#lb-seats b').strip()
            for _ in range(3): p.click('#lb-seats button[aria-label="More seats"]'); time.sleep(.1)
            c.eq('seats stepper after 3 presses of + from the default', seats(), '8')
            for _ in range(8): p.click('#lb-seats button[aria-label="Fewer seats"]'); time.sleep(.05)
            c.eq('seats stepper stops at 2', seats(), '2')
            for _ in range(10): p.click('#lb-seats button[aria-label="More seats"]'); time.sleep(.05)
            c.eq('seats stepper stops at 8', seats(), '8')
            # Q07 Play $: min buy-in $0.10 with $0.25/$0.50 blinds
            p.fill('#lb-bmin', '0.10'); p.press('#lb-bmin', 'Tab'); time.sleep(.3)
            p.click('#lb-create-submit'); time.sleep(1.8)
            e = p.evaluate("[...document.querySelectorAll('#lb-createerr')].map(x => x.textContent.trim()).filter(Boolean).concat([...document.querySelectorAll('#toasts > *, .toast')].map(x => x.innerText.trim()))")
            print('Play $ refusal:', e)
            refs = [x for x in e if 'you have' in x]   # the form's error line and any toast
            c.ok('Play $ create refusal reads dollars (every message)', bool(refs) and all('at least $0.50' in x and 'you have $0.10' in x for x in refs), str(e))
            print(s.shot('fix_b_create_play'))
            # Q07 Chips: min buy-in 10 chips with 25/50 blinds
            p.locator('#lb-form button', has_text='Chips').first.click(); time.sleep(.4)
            p.fill('#lb-bmin', '10'); p.press('#lb-bmin', 'Tab'); time.sleep(.3)
            p.click('#lb-create-submit'); time.sleep(1.8)
            e = p.evaluate("[...document.querySelectorAll('#lb-createerr')].map(x => x.textContent.trim()).filter(Boolean).concat([...document.querySelectorAll('#toasts > *, .toast')].map(x => x.innerText.trim()))")
            print('Chips refusal:', e)
            refs = [x for x in e if 'you have' in x]
            c.ok('Chips create refusal reads chips (every message)', bool(refs) and all('at least 50' in x and 'you have 10' in x and '$' not in x for x in refs), str(e))
            print(s.shot('fix_b_create_chips'))
        finally: s.close()

BOARD = ['2c', '3d', '4h', '9s', 'Jd']
def busted():
    with sync_playwright() as pw:
        sc = Scene(pw, view, 'chips', 1000, [('b1', 3000, 'call')], settings={'rebuyLimit': 1, 'buyIn': {'min': 100, 'max': 1000000, 'default': 1000}}, rig=None, tag=tag + 'bu')
        sc.B.rig_many(sc.host, [[[['Ks', 'Kd'], ['As', 'Ad']], BOARD]])
        try:
            sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.hook()
            sc.start(); c.ok('hero loses the stack', play_hero(sc, lambda gs: 'allin')); time.sleep(2)
            r = sc.p.evaluate(SEATS); mine = [s for s in r['seats'] if s['name'].lower() == sc.hero_name.lower()]
            print('busted seats:', r['seats'])
            c.ok('busted hero seat found', len(mine) == 1)
            if mine:
                c.ok('busted seat is labelled Out of chips', 'out of chips' in mine[0]['status'].lower(), repr(mine[0]['status']))
                c.ok('busted seat is not labelled Joining', 'joining' not in mine[0]['status'].lower(), repr(mine[0]['status']))
            print(sc.s.shot('fix_b_busted'))
        finally: sc.close()

def joining():
    """A seat with chips that sits down mid-hand waits for the next deal: that one keeps "Joining"."""
    with sync_playwright() as pw:
        sc = Scene(pw, view, 'chips', 2000, [('b1', 2000, 'none')], rig=None, tag=tag + 'jn')
        try:
            sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit(); sc.start(); sc.wait_status('playing', 15)
            late = sc.bn('late'); sc.B.bot(late); r = sc.B.req(late, 'table_join', {'tableId': sc.tid, 'buyIn': 2000}, 'table_joined'); time.sleep(1)
            seats = sc.p.evaluate(SEATS)['seats']; l = [s for s in seats if s['name'].lower() == late.lower()]
            print('late seat:', l)
            c.ok('a seat with chips waiting for the next deal reads Joining', l and 'joining' in l[0]['status'].lower(), str(l))
        finally: sc.close()

try:
    badges('headsup', ['b1'])
    badges('three', ['b1', 'b2'])
    badges('sitout', ['b1', 'b2', 'b3'], sit_out='b2')
    bonus()
    create_refusals()
    busted()
    joining()
finally:
    pass
sys.exit(c.done('fix_b_labels'))
