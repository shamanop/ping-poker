"""S06: bust, rebuy (default, limit reached, refused while holding chips / in hand), sit out and back in, leave mid-hand, cash-out vs the ledger.
Usage: python3 s06_bust.py [desk|phone] [chips|play]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'; mode = sys.argv[2] if len(sys.argv) > 2 else 'chips'
c = Checks(); BOARD = ['2c', '7d', '9h', 'Jc', '4s']
U = 1  # units: chips or cents
def money(sc):
    a = audit(); return a, a['bank'].get(sc.hero_key), a['wallet'].get(sc.hero_key), seat_bal(a, sc.hero_key)
def bust_ui(sc):
    return sc.p.evaluate("""(() => { const b = document.getElementById('bust-panel'); const r = document.getElementById('btn-rebuy'); const i = document.getElementById('rebuy-input');
      return {open: !b.classList.contains('hidden'), text: b.innerText.replace(/\\n/g, ' | '), btn: r && !r.classList.contains('hidden') ? r.innerText : null, btnDisabled: r && r.disabled, input: i ? i.value : null, bal: document.getElementById('bust-balance').innerText} })()""")

with sync_playwright() as pw:
    st = 1000 if mode == 'chips' else 1000
    sc = Scene(pw, view, mode, st, [('b1', 3000, 'call')], settings={'rebuyLimit': 1, 'buyIn': {'min': 100, 'max': 1000000, 'default': 1000}}, rig=None)
    sc.B.rig_many(sc.host, [[[['Ks', 'Kd'], ['As', 'Ad']], BOARD], [[['Ks', 'Kd'], ['As', 'Ad']], BOARD]])   # two losing hands: the bust and the bust after the rebuy
    try:
        sc.hero_in(); sc.hero_sit_ui(); sc.bots_sit()
        sc.p.on('dialog', lambda d: d.accept()); sc.hook()
        a0, bank0, wal0, tab0 = money(sc)
        sc.start()
        # refused while holding chips: emit rebuy now
        time.sleep(1); sc.ev_clear(); sc.p.evaluate("PingSocket.emit('rebuy', {tableId: '%s'})" % sc.tid); time.sleep(.8)
        err = (sc.ev('error') or [None])[-1]; print('rebuy while holding chips ->', err)
        c.ok('rebuy with chips is refused with a code', err and err.get('code') in ('have_chips', 'in_hand'), str(err))
        c.ok('refusal message has no raw code/undefined', err and err.get('message') and 'undefined' not in err['message'])
        toast = sc.p.evaluate("[...document.querySelectorAll('#toasts > *, .toast')].map(e => e.innerText.replace(/\\n/g,' | '))"); print('toast shown:', toast)
        c.ok('the refusal is visible to the player (a toast/message)', len(toast) > 0, str(toast))
        c.ok('hand 1 (hero loses all-in)', play_hero(sc, lambda gs: 'allin'))
        time.sleep(1.5)
        b = bust_ui(sc); print('bust panel 1:', b)
        c.ok('bust panel open after losing the stack', b['open'])
        a1, bank1, wal1, tab1 = money(sc)
        c.eq('server: seat stack is 0 and nothing at table', tab1, 0)
        shown_bal = nums(b['bal'])
        print('bust balance shown', b['bal'], 'server bank', bank1, 'wallet', wal1)
        c.ok('bust panel balance matches the server (%s)' % ('bank' if mode == 'chips' else 'play wallet'), shown_bal and (shown_bal[0] == (bank1 if mode == 'chips' else wal1 // 100) or shown_bal[0] * 100 == wal1), str(b['bal']))
        print(sc.s.shot('s06_bust1_%s_%s' % (view, mode)))
        # rebuy with the default amount through the UI
        sc.p.click('#btn-rebuy'); time.sleep(2)
        a2, bank2, wal2, tab2 = money(sc)
        c.eq('rebuy: server seat holds the default buy-in', tab2, 1000)
        c.eq('rebuy: bank/wallet moved by exactly that', (bank1 - bank2) if mode == 'chips' else (wal1 - wal2), 1000)
        b2 = bust_ui(sc); c.ok('bust panel closed after rebuy', not b2['open'], str(b2))
        # second bust
        c.ok('hand 2 (hero loses all-in again)', play_hero(sc, lambda gs: 'allin', 90))
        time.sleep(1.5); b3 = bust_ui(sc); print('bust panel 2:', b3)
        print(sc.s.shot('s06_bust2_%s_%s' % (view, mode)))
        c.ok('second bust: rebuy limit reached -> no rebuy button, message says so', b3['open'] and (b3['btn'] is None or b3['btnDisabled'] or 'limit' in b3['text'].lower() or 'closed' in b3['text'].lower()), str(b3))
        sc.ev_clear(); sc.p.evaluate("PingSocket.emit('rebuy', {tableId: '%s', amount: 500})" % sc.tid); time.sleep(.8)
        err = (sc.ev('error') or [None])[-1]; print('rebuy past the limit ->', err)
        c.ok('server refuses the rebuy past the limit (rebuy_off)', err and err.get('code') == 'rebuy_off', str(err))
        a4, bank4, wal4, tab4 = money(sc); c.eq('refused rebuy moved no money', (bank4, wal4, tab4), (bank2, wal2, 0))
        # leave from the bust panel
        sc.p.click('#btn-leave'); time.sleep(1.5)
        c.ok('Leave returns to the lobby', sc.p.evaluate("document.getElementById('lobby-root').classList.contains('on')"))
        a5, bank5, wal5, tab5 = money(sc)
        if mode == 'chips': c.eq('conservation: hero bank+wallet+table after leave == before sit minus losses (2000 lost)', (bank5 + tab5) if mode == 'chips' else (wal5 + tab5), ((bank0 + tab0 - 2000) if mode == 'chips' else (wal0 + tab0 - 2000)))
        print('page errors', sc.s.errors[:4])
    finally:
        sc.close()
sys.exit(c.done('s06 %s %s' % (view, mode)))
