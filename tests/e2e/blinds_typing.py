"""Host drawer blinds boxes take real key presses, one at a time, while table_info redraws the drawer (Chris 2026-10-06:
"doesnt let you type in more than 1 number before kicking you out"). host_drawer.py uses fill(), which never saw it.
Usage: E2E_BASE=http://127.0.0.1:PORT python3 tests/e2e/blinds_typing.py chips|play [phone]"""
import os, sys, subprocess, time
sys.path.insert(0, os.path.join(os.getcwd(), 'tests/e2e'))
from common import *
MODE = sys.argv[1] if len(sys.argv) > 1 else 'chips'
VP = {'width': 1280, 'height': 900} if 'phone' not in sys.argv else {'width': 390, 'height': 844}
NAME = 'bl%d' % (int(time.time()) % 1000000)
subprocess.run(['node', 'tests/e2e/claim.js', NAME], check=True, stdout=subprocess.DEVNULL, env=dict(os.environ))
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader']); pg = b.new_page(viewport=VP)
    recv = []
    pg.on('websocket', lambda ws: ws.on('framereceived', lambda d: recv.append((time.time(), d[:60])) if isinstance(d, str) and d.startswith('42') else None))
    sign_in(pg, NAME); set_pref(pg, 'usd' if MODE == 'play' else 'chips')
    pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form')
    if MODE == 'chips':
        seg = pg.locator('#lb-form .seg-btn', has_text='Chips')
        if seg.count(): seg.first.click()
    pg.click('#lb-create-submit')
    pg.wait_for_selector('#lb-sit', timeout=8000); pg.click('#lb-sit')
    pg.wait_for_selector('#host-btn', timeout=10000); pg.click('#host-btn'); pg.wait_for_selector('#host-sb')
    pg.wait_for_timeout(800)
    print('start values', pg.input_value('#host-sb'), pg.input_value('#host-bb'))
    for box, digits in ((('#host-sb', '100'), ('#host-bb', '250')) if MODE == 'chips' else (('#host-sb', '1.25'), ('#host-bb', '2.50'))):
        pg.click(box); pg.keyboard.press('Control+a'); t0 = time.time(); n0 = len(recv)
        for ch in digits:
            pg.keyboard.type(ch); pg.wait_for_timeout(350)
            act = pg.evaluate("document.activeElement && document.activeElement.id")
            c.eq('%s keeps focus after %s' % (box, ch), act, box[1:])
        c.eq('%s holds what was typed' % box, pg.input_value(box).replace(',', ''), digits)
    shot(pg, 'blinds_repro_' + MODE + ('_phone' if 'phone' in sys.argv else ''), '#host-drawer')
    pg.click('#host-blinds-save'); pg.wait_for_timeout(1500)
    print('note:', pg.inner_text('#host-blinds-msg'))
    c.ok('blinds set note', 'Blinds set to' in pg.inner_text('#host-blinds-msg'))
    b.close()
c.done('blinds typing ' + MODE)
