"""Step C proof, caller 5: bank-panel inline edit (type=number replaced by AmountInput). Asserts admin_adjust.delta (typed - shown bank) in units for
chips / usd / auto prefs, that garbage sends nothing and keeps the box open with a message, and that Escape sends nothing.
Opened through the admin console bank tab. Setup as buyin.py (chris + by1..by6)."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

import subprocess
# the bank summary lists accounts that have a bank row: seat by2..by5 at POKERPING first (bots sit and call)
bots = [subprocess.Popen(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bot.js'), n], stdout=subprocess.DEVNULL) for n in ['by2', 'by3', 'by4', 'by5']]
time.sleep(3)
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg)
    sign_in(pg, 'chris')
    pg.evaluate("AdminConsole.open()"); pg.wait_for_selector('.adm-tab'); pg.click('.adm-tab[data-t=bank]')
    cell = lambda n: '#adm-bankhost .bp-stats b.editable[data-name=%s]' % n
    for name, pref, typed, want in [('by2', 'chips', '7777', 7777), ('by3', 'usd', '12.5', 1250), ('by4', 'auto', '300', 300)]:
        set_pref(pg, pref); pg.wait_for_timeout(1500)
        pg.wait_for_selector(cell(name), timeout=8000); shown = int(pg.get_attribute(cell(name), 'data-bank')); pg.click(cell(name)); pg.wait_for_selector('#adm-bankhost .bp-edit')
        pg.fill('#adm-bankhost .bp-edit', typed); fr.clear(); pg.press('#adm-bankhost .bp-edit', 'Enter'); pg.wait_for_timeout(500)
        c.eq('%s typed %r (bank shows %d) -> admin_adjust.delta' % (pref, typed, shown), [(f.get('key'), f.get('delta'), f.get('cur')) for f in fr.of('admin_adjust')], [(name, want - shown, 'chips')])
    # garbage: nothing sent, box stays open with a message
    set_pref(pg, 'chips'); pg.wait_for_timeout(1500)
    pg.wait_for_selector(cell('by5')); pg.click(cell('by5')); pg.wait_for_selector('#adm-bankhost .bp-edit')
    for bad in ['abc', '-3', '99999999999']:
        pg.fill('#adm-bankhost .bp-edit', bad); fr.clear(); pg.press('#adm-bankhost .bp-edit', 'Enter'); pg.wait_for_timeout(250)
        c.eq('bad %r sends nothing' % bad, fr.of('admin_adjust'), [])
        c.ok('bad %r box stays open' % bad, pg.locator('#adm-bankhost .bp-edit').count() == 1)
        c.ok('bad %r shows a message' % bad, pg.inner_text('#adm-bankhost .amt-msg').strip() != '')
    fr.clear(); pg.press('#adm-bankhost .bp-edit', 'Escape'); pg.wait_for_timeout(300)
    c.eq('Escape sends nothing', fr.of('admin_adjust'), [])
    c.eq('Escape closes the box', pg.locator('#adm-bankhost .bp-edit').count(), 0)
    b.close()
for bt in bots: bt.terminate()
c.done('bank.py')
