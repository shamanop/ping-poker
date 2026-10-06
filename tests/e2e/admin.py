"""Step C proof, caller 4: admin console amounts (accounts tab chips / Play $, table tab blinds).
Asserts the units that arrive at the server for usd / chips / auto prefs. The bank edit is `admin_adjust {key, delta, cur:'chips'}`
with delta = typed - the BANK balance shown in the row (read from the row). Frames only: a legacy server ignores admin_adjust.
Setup as buyin.py (chris + by1..by6)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def open_admin(pg, tab):
    pg.evaluate("AdminConsole.open()"); pg.wait_for_selector('.adm-tab')
    pg.click('.adm-tab[data-t=%s]' % tab); pg.wait_for_timeout(700)

c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg)
    pg.on('dialog', lambda d: d.accept())
    sign_in(pg, 'chris')
    for pref, typed_chips, want_chips, typed_play, want_play in [('chips', '12345', 12345, '4000', 4000), ('usd', '123.45', 12345, '40', 4000), ('auto', '500', 500, '2.5', 250)]:
        set_pref(pg, pref); open_admin(pg, 'accounts')
        row = 'tr[data-k=by1]'
        pg.click(row + ' [data-a=bal]'); pg.wait_for_selector('#adm-edit')
        shown = int(pg.evaluate("document.querySelector('tr[data-k=by1] .adm-bal').textContent").replace(',', '').replace('\u2013', '0') or 0)
        pg.fill('#adm-edit', typed_chips); fr.clear(); pg.click(row + ' [data-a=bal-ok]'); pg.wait_for_timeout(500)
        got = [(f.get('key'), f.get('delta'), f.get('cur')) for f in fr.of('admin_adjust')]
        c.eq('%s: chips typed %r (bank shows %d) -> admin_adjust.delta' % (pref, typed_chips, shown), got, [('by1', want_chips - shown, 'chips')])
        pg.click(row + ' [data-a=play]'); pg.wait_for_selector('#adm-edit')
        pg.fill('#adm-edit', typed_play); fr.clear(); pg.click(row + ' [data-a=play-ok]'); pg.wait_for_timeout(500)
        got = [f.get('cents') for f in fr.of('admin_set_play')]
        c.eq('%s: play typed %r -> admin_set_play.cents' % (pref, typed_play), got, [want_play])
        pg.evaluate("AdminConsole.close()")
    # bad amounts send nothing
    set_pref(pg, 'chips'); open_admin(pg, 'accounts'); pg.click('tr[data-k=by1] [data-a=bal]'); pg.wait_for_selector('#adm-edit')
    for bad in ['abc', '-5', '999999999999', '']:
        pg.fill('#adm-edit', bad); fr.clear(); pg.click('tr[data-k=by1] [data-a=bal-ok]'); pg.wait_for_timeout(250)
        c.eq('bad chips %r sends nothing' % bad, fr.of('admin_adjust'), [])
    pg.evaluate("AdminConsole.close()")
    # table tab: blinds in units; typed text survives the 4 s refresh
    for pref, sb, bb, want in [('chips', '50', '100', (50, 100)), ('usd', '1', '2', (100, 200))]:
        set_pref(pg, pref); open_admin(pg, 'table')
        pg.fill('#adm-sb', sb); pg.fill('#adm-bb', bb); fr.clear()
        pg.wait_for_timeout(4500)  # one overview refresh happens while the boxes hold typed text
        c.eq('%s: typed blinds survive a refresh' % pref, (pg.input_value('#adm-sb'), pg.input_value('#adm-bb')), (sb, bb))
        pg.click('#adm-blinds'); pg.wait_for_timeout(900)
        got = [f['patch']['blinds'] for f in fr.of('table_update')]
        c.eq('%s: blinds payload units' % pref, got, [{'sb': want[0], 'bb': want[1]}])
        shot(pg, 'admin_table', '.adm-pane.on')
        pg.evaluate("AdminConsole.close()")
    b.close()
c.done('admin.py')
