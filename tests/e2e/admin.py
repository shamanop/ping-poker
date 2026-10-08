"""Step C proof, caller 4: admin console amounts (accounts tab chips / Cash, table tab blinds).
Asserts the units that arrive at the server for usd / chips / auto prefs. The bank edit is `admin_adjust {key, delta, cur:'chips'}`
with delta = typed - the BANK balance shown in the row (read from the row). Frames only: a legacy server ignores admin_adjust.
Setup as buyin.py (chris + by1..by6)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def open_admin(pg, tab):
    pg.evaluate("AdminConsole.open()"); pg.wait_for_selector('.adm-tab')
    pg.click('.adm-tab[data-t=%s]' % tab); pg.wait_for_timeout(700)

V2 = os.environ.get('E2E_V2') == '1'   # against a v2 server the adjust is applied: the row must then show the typed bank
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg)
    pg.on('dialog', lambda d: d.accept())
    sign_in(pg, 'chris')
    for i, (pref, typed_play, want_play) in enumerate([('chips', '4000', 4000), ('usd', '40', 4000), ('auto', '2.5', 250)]):
        set_pref(pg, pref); open_admin(pg, 'accounts')
        row = 'tr[data-k=by1]'
        pg.click(row + ' [data-a=bal]'); pg.wait_for_selector('#adm-edit')
        shown = pg.evaluate("(() => { const t = document.querySelector('tr[data-k=by1] .adm-bal').textContent.trim(); const r = Money.parse(t.replace('\\u2013', '0'), Money.modeFor(Money.pref, 'chips')); return r.ok ? r.units : 0 })()")
        want_chips = shown + 1000 * (i + 1)   # always a real change (rerunnable): typed in the text form of this pref
        typed_chips = ('%.2f' % (want_chips / 100)) if pref == 'usd' else str(want_chips)
        pg.fill('#adm-edit', typed_chips); fr.clear(); pg.click(row + ' [data-a=bal-ok]'); pg.wait_for_timeout(500)
        got = [(f.get('key'), f.get('delta'), f.get('cur')) for f in fr.of('admin_adjust')]
        c.eq('%s: chips typed %r (bank shows %d) -> admin_adjust.delta' % (pref, typed_chips, shown), got, [('by1', want_chips - shown, 'chips')])
        if V2:
            pg.wait_for_timeout(1500)
            c.eq('%s: server applied the adjust, row shows the typed bank' % pref, pg.evaluate("(() => { const r = Money.parse(document.querySelector('tr[data-k=by1] .adm-bal').textContent.trim(), Money.modeFor(Money.pref, 'chips')); return r.ok ? r.units : null })()"), want_chips)
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
