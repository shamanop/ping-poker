"""S08: admin console. A seated bot player: the Bank / At table / Play $ columns vs __audit; bank adjust by delta (seat untouched); Play $ set touches the wallet only.
Usage: python3 s08_admin.py [desk|phone]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks(); tag = '%d' % (int(time.time()) % 100000)
def open_admin(p, tab='accounts'):
    p.evaluate("AdminConsole.open()"); p.wait_for_selector('.adm-tab'); p.click('.adm-tab[data-t=%s]' % tab); p.wait_for_timeout(900)
def row_cols(p, key):
    return p.evaluate("(k) => { const r = document.querySelector('tr[data-k=\"' + k + '\"]'); return r ? [...r.querySelectorAll('td')].map(t => t.innerText.trim()) : null }", key)
with sync_playwright() as pw:
    B = Bots(); host, tgt = 'ah' + tag, 'at' + tag
    B.bot(host); B.bot(tgt)
    r = B.req(host, 'table_create', {'settings': {'name': 'Adm', 'mode': 'chips', 'buyIn': {'min': 100, 'max': 1000000, 'default': 2000}, 'blinds': {'sb': 25, 'bb': 50}, 'autoStart': False, 'actionTimerSec': 0}}, 'table_created')
    tid = r['table']['id']; B.req(host, 'table_join', {'tableId': tid, 'buyIn': 2000}, 'table_joined'); B.req(tgt, 'table_join', {'tableId': tid, 'buyIn': 3000}, 'table_joined')
    s = Sess(pw, view, 'admin'); p = s.page
    try:
        p.on('dialog', lambda d: d.accept())
        s.sign_in('chris'); s.dismiss_modals(); s.hook = None
        p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
        open_admin(p); key = tgt.lower()
        c.ok('target row present', p.locator('tr[data-k="%s"]' % key).count() == 1)
        a = audit(); cols = row_cols(p, key); print('row', cols)
        nn = [nums(t) for t in cols]
        flat = [x for n in nn for x in n]
        c.ok('row shows the bank (%s)' % a['bank'][key], a['bank'][key] in flat, str(cols))
        c.ok('row shows the at-table stack (%s)' % seat_bal(a, key), seat_bal(a, key) in flat, str(cols))
        print(s.shot('s08_admin_row_%s' % view))
        # bank adjust: typed = shown + 500 through the pencil
        row = 'tr[data-k="%s"]' % key
        p.click(row + ' [data-a=bal]'); p.wait_for_selector('#adm-edit')
        shown = nums(p.input_value('#adm-edit'))[0] if nums(p.input_value('#adm-edit')) else None
        print('edit box prefilled with', repr(p.input_value('#adm-edit')), 'server bank', a['bank'][key])
        c.eq('edit box is prefilled with the BANK balance (not bank + table)', shown, a['bank'][key])
        p.fill('#adm-edit', str(a['bank'][key] + 500)); p.click(row + ' [data-a=bal-ok]'); time.sleep(1.5)
        a2 = audit(); c.eq('bank +500 on the server', a2['bank'][key] - a['bank'][key], 500); c.eq('seat untouched by the adjust', seat_bal(a2, key), seat_bal(a, key))
        res = [d for e, d in p.evaluate('window.__ev') if e == 'admin_result']; print('admin_result', res[-1:] )
        c.ok('admin_result ok', res and res[-1].get('ok'))
        # a negative that would take the bank below zero must be refused (typed 0 is fine; a huge delta down is not reachable from the box, so use the socket)
        p.evaluate("PingSocket.emit('admin_adjust', {key: '%s', delta: -99999999, cur: 'chips', reason: 'sweep'})" % key); time.sleep(1.0)
        res = [d for e, d in p.evaluate('window.__ev') if e == 'admin_result']; print('over-draw ->', res[-1:])
        a3 = audit(); c.eq('over-draw changed nothing', a3['bank'][key], a2['bank'][key]); c.ok('over-draw refused', res and res[-1].get('ok') is False)
        # Play $ set only touches the wallet
        p.click(row + ' [data-a=play]'); p.wait_for_selector('#adm-edit'); p.fill('#adm-edit', '123'); p.click(row + ' [data-a=play-ok]'); time.sleep(1.5)
        a4 = audit(); print('wallet after set', a4['wallet'][key], 'seat', seat_bal(a4, key))
        c.ok('Play $ set: wallet moved to a figure matching the typed 123 in the console\'s unit', a4['wallet'][key] in (123, 12300), str(a4['wallet'][key]))
        c.eq('Play $ set: seat and bank untouched', (seat_bal(a4, key), a4['bank'][key]), (seat_bal(a3, key), a3['bank'][key]))
        cols2 = row_cols(p, key); print('row after', cols2)
        # the table pane
        p.click('.adm-tab[data-t=tables]') if p.locator('.adm-tab[data-t=tables]').count() else None; time.sleep(.8)
        print(s.shot('s08_admin_tables_%s' % view))
        c.eq('drift', audit().get('drift'), [])
        print('page errors', s.errors[:4])
    finally:
        s.close(); B.close()
sys.exit(c.done('s08 ' + view))
