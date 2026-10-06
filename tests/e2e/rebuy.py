"""Step C proof, caller 6: rebuy amount (bust panel). The legacy server does not send the `rebuy` descriptor or take an
amount, so the bust_out event is replayed into the page's own handlers (PingSocket.listeners) with the v2 shape
{balance, rebuy:{allowed,fund,balance,min,max,default}}. Asserts the amount in the emitted `rebuy` equals what the button
promised, for usd / chips pref, plus bounds and bad input. Server-side charge is NOT checked here (needs P3)."""
import os, sys, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
NAME = 'rb%d' % (int(time.time()) % 1000000)
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'claim.js'), NAME], env=dict(os.environ, NODE_PATH=os.environ.get('NODE_PATH', '/home/isabelle/.cache/node_modules')), check=True, stdout=subprocess.DEVNULL)

def bust(pg, payload):
    pg.evaluate("p => PingSocket.listeners('bust_out').forEach(f => f(p))", payload)

c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg)
    sign_in(pg, NAME)
    pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form'); pg.click('#lb-create-submit')   # Play $ table, buy-in 500..50000 default 10000
    pg.wait_for_selector('#lb-sit'); pg.click('#lb-sit'); pg.wait_for_selector('#host-btn', timeout=10000)
    for pref, typed, want in [('usd', '30', 3000), ('chips', '4500', 4500)]:
        set_pref(pg, pref)
        bust(pg, {'balance': 20000, 'rebuy': {'allowed': True, 'fund': 'play', 'balance': 20000, 'min': 500, 'max': 50000, 'default': 10000}})
        pg.wait_for_selector('#rebuy-input', state='visible')
        c.eq('%s: default rebuy shown (button promises the box)' % pref, pg.inner_text('#btn-rebuy').lower(), 'rebuy $100' if pref == 'usd' else 'rebuy 10,000')
        c.eq('%s: max is capped by the balance (bank 20000)' % pref, pg.evaluate("document.querySelector('#bust-amt .amt-ends span:last-child').textContent"), '$200' if pref == 'usd' else '20,000')
        pg.fill('#rebuy-input', typed)
        c.ok('%s: button label follows the typed amount' % pref, pg.inner_text('#btn-rebuy').replace(',', '').endswith(typed))
        fr.clear(); pg.click('#btn-rebuy'); pg.wait_for_timeout(300)
        c.eq('%s: typed %r -> rebuy.amount' % (pref, typed), [f.get('amount') for f in fr.of('rebuy')], [want])
        pg.evaluate("document.getElementById('bust-panel').classList.add('hidden')")
    # preset + bad amount
    set_pref(pg, 'chips')
    bust(pg, {'balance': 20000, 'rebuy': {'allowed': True, 'fund': 'play', 'balance': 20000, 'min': 500, 'max': 50000, 'default': 10000}})
    pg.wait_for_selector('#rebuy-input', state='visible')
    pg.locator('#bust-amt .amt-pre', has_text='Max').click(); fr.clear(); pg.click('#btn-rebuy'); pg.wait_for_timeout(300)
    c.eq('Max preset sends the capped max', [f.get('amount') for f in fr.of('rebuy')], [20000])
    bust(pg, {'balance': 20000, 'rebuy': {'allowed': True, 'fund': 'play', 'balance': 20000, 'min': 500, 'max': 50000, 'default': 10000}})
    pg.wait_for_selector('#rebuy-input', state='visible')
    for bad in ['abc', '1', '25000']:
        pg.fill('#rebuy-input', bad); fr.clear(); pg.click('#btn-rebuy', force=True); pg.wait_for_timeout(250)
        c.eq('bad %r sends no rebuy' % bad, fr.of('rebuy'), [])
        c.ok('bad %r shows a message' % bad, pg.inner_text('#bust-amt .amt-msg').strip() != '')
    # a bank below the minimum: no rebuy button, broke message
    bust(pg, {'balance': 100, 'rebuy': {'allowed': True, 'fund': 'play', 'balance': 100, 'min': 500, 'max': 50000, 'default': 10000}})
    c.ok('bank below min hides the rebuy button', pg.evaluate("document.getElementById('btn-rebuy').classList.contains('hidden')"))
    b.close()
c.done('rebuy.py')
