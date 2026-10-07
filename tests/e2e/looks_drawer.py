"""Table look picker in the host drawer survives a table_info redraw between pointer-down and click, and the choice reaches the server.
Usage: E2E_BASE=http://127.0.0.1:PORT python3 tests/e2e/looks_drawer.py [phone]"""
import os, sys, time
sys.path.insert(0, os.path.join(os.getcwd(), 'tests/e2e'))
import subprocess
from common import *
VP = {'width': 1280, 'height': 900} if 'phone' not in sys.argv else {'width': 390, 'height': 844}
NAME = 'lk%d' % (int(time.time()) % 1000000)
subprocess.run(['node', 'tests/e2e/claim.js', NAME], check=True, stdout=subprocess.DEVNULL, env=dict(os.environ))
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader']); pg = b.new_page(viewport=VP)
    fr = Frames(pg)
    sign_in(pg, NAME); set_pref(pg, 'chips')
    pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form'); pg.click('#lb-create-submit')
    pg.wait_for_selector('#lb-sit', timeout=8000); pg.click('#lb-sit')
    pg.wait_for_selector('#host-btn', timeout=10000); pg.click('#host-btn'); pg.wait_for_selector('#host-look [data-look=ranch]'); pg.wait_for_timeout(500)
    node = pg.evaluate_handle("document.querySelector('#host-look')")
    opt = pg.locator('#host-look [data-look=ranch]'); opt.scroll_into_view_if_needed(); box = opt.bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.mouse.down()
    n0 = len(fr.of('table_preview'))
    for _ in range(3): pg.evaluate("window.PingSocket.emit('table_preview', { code: document.querySelector('.host-drawer small').textContent.split('/').pop().trim() })"); pg.wait_for_timeout(500)
    pg.mouse.up(); pg.wait_for_timeout(900)
    c.ok('picker node stayed in the page through redraws', pg.evaluate("n => n.isConnected", node))
    c.eq('look patch sent once', [x['patch'] for x in fr.of('table_update') if x and x.get('patch') and 'look' in x['patch']], [{'look': 'ranch'}])
    c.eq('game screen switched', pg.evaluate("document.getElementById('game-screen').dataset.look"), 'ranch')
    c.eq('picker marks ranch', pg.evaluate("document.querySelector('#host-look .on').dataset.look"), 'ranch')
    b.close()
c.done('looks drawer' + (' phone' if 'phone' in sys.argv else ''))
