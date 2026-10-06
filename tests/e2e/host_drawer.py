"""Step C proof, caller 3: host drawer blinds editor. Asserts the table_update payload in units, that the 'Blinds set'
note only appears after the server confirmed, and S2-8: an external blinds change flows into untouched boxes but never
overwrites a box the host is editing. Setup as in buyin.py. Uses account by8 (fresh each run: claim it first)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import subprocess
NAME = 'hd%d' % (int(time.time()) % 1000000)
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'claim.js'), NAME], env=dict(os.environ, NODE_PATH=os.environ.get('NODE_PATH', '/home/isabelle/.cache/node_modules')), check=True, stdout=subprocess.DEVNULL)

c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg)
    sign_in(pg, NAME); set_pref(pg, 'usd')
    # create a Play $ table as host, sit down
    pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form'); pg.click('#lb-create-submit')
    pg.wait_for_selector('#lb-sit', timeout=8000); pg.click('#lb-sit')
    pg.wait_for_selector('#host-btn', timeout=10000); pg.click('#host-btn'); pg.wait_for_selector('#host-sb')
    sbv = lambda: pg.input_value('#host-sb'); bbv = lambda: pg.input_value('#host-bb')
    c.eq('drawer starts at the table blinds ($0.25/$0.50)', (sbv(), bbv()), ('0.25', '0.50'))
    pg.fill('#host-sb', '0.5'); pg.fill('#host-bb', '1'); fr.clear()
    pg.click('#host-blinds-save'); pg.wait_for_timeout(1500)
    ups = fr.of('table_update')
    c.eq('one table_update', len(ups), 1)
    if ups: c.eq('patch blinds in units', ups[0]['patch'], {'blinds': {'sb': 50, 'bb': 100}})
    c.ok('"Blinds set" shown after the server confirmed', 'Blinds set to' in pg.inner_text('#host-blinds-msg'))
    # S2-8: external change reaches untouched boxes
    tid = pg.evaluate("document.querySelector('#host-drawer h4 small').textContent.split('/').pop().trim()")
    pg.evaluate("t => PingSocket.emit('table_update', {tableId: t, patch: {blinds: {sb: 100, bb: 200}}})", tid)
    pg.wait_for_timeout(3500)
    c.eq('untouched boxes follow the external change', (sbv(), bbv()), ('1', '2'))
    # editing one box: a later external change must not revert or clobber it
    pg.fill('#host-sb', '1.5'); pg.press('#host-sb', 'Tab')
    pg.evaluate("t => PingSocket.emit('table_update', {tableId: t, patch: {blinds: {sb: 200, bb: 400}}})", tid)
    pg.wait_for_timeout(3500)
    c.eq('edited box keeps its value across polls (blur renders 1.50)', sbv(), '1.50')
    fr.clear(); pg.fill('#host-bb', '3'); pg.click('#host-blinds-save'); pg.wait_for_timeout(1500)
    ups = fr.of('table_update')
    c.eq('Set after editing sb then bb sends both typed values', [u['patch'] for u in ups], [{'blinds': {'sb': 150, 'bb': 300}}])
    # bad input: nothing sent
    fr.clear(); pg.fill('#host-sb', 'abc'); pg.click('#host-blinds-save'); pg.wait_for_timeout(300)
    c.eq('garbage blind sends nothing', fr.of('table_update'), [])
    c.ok('garbage blind shows a message', pg.inner_text('#host-blinds-msg').strip() != '')
    # ui defect 3: at 1280x720 the drawer stays inside the viewport and scrolls
    pg.set_viewport_size({'width': 1280, 'height': 720}); pg.wait_for_timeout(500)
    g = pg.evaluate("(() => { const d = document.getElementById('host-drawer'); const r = d.getBoundingClientRect(); return {bottom: r.bottom, h: innerHeight, oy: getComputedStyle(d).overflowY} })()")
    c.ok('host drawer bottom inside the 720px viewport (%s)' % g, g['bottom'] <= g['h'] + 0.5 and g['oy'] in ('auto', 'scroll'))
    shot(pg, 'host_drawer', '#host-drawer')
    b.close()
c.done('host_drawer.py')
