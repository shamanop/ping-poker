"""Quick probe: load the site, sign up, print console errors and page errors, optional screenshot. python3 probe.py [WxH] [shot.jpg]"""
import os, sys, time
from playwright.sync_api import sync_playwright
base = os.environ.get('E2E_BASE', 'http://127.0.0.1:4720'); wh = sys.argv[1] if len(sys.argv) > 1 else '1440x900'
w, h = map(int, wh.split('x'))
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--no-sandbox']); p = b.new_page(viewport={'width': w, 'height': h})
    p.on('pageerror', lambda e: print('PAGEERROR', str(e)[:300])); p.on('console', lambda m: print('CONSOLE', m.type, m.text[:300]) if m.type in ('error', 'warning') else None)
    p.goto(base + '/'); p.wait_for_selector('#lb-name', timeout=15000)
    p.click('.seg button[data-tab="up"]'); p.fill('#lb-name', 'probe%d' % (int(time.time()) % 10000)); p.fill('#lb-pin', '4321'); p.click('#lb-submit'); time.sleep(3)
    print('create btn', p.locator('#lb-create-btn').count())
    if len(sys.argv) > 2: p.screenshot(path=sys.argv[2], type='jpeg', quality=60)
    b.close()
