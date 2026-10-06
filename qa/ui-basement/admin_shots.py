"""Admin console shots + legibility audit: python3 qa/ui-basement/admin_shots.py <before|after> <WxH>. Needs the claimed admin account `chris` (tests/e2e/claim.js)."""
import os, sys, time, json
from playwright.sync_api import sync_playwright
UIB = os.path.dirname(os.path.abspath(__file__)); base = os.environ.get('E2E_BASE', 'http://127.0.0.1:4720')
tag, size = sys.argv[1], sys.argv[2]; w, h = map(int, size.split('x'))
out = os.path.join(UIB, tag); os.makedirs(out, exist_ok=True); aud = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--no-sandbox']); p = b.new_page(viewport={'width': w, 'height': h})
    p.on('pageerror', lambda e: print('PAGEERROR', str(e)[:200]))
    p.goto(base + '/'); p.wait_for_selector('#lb-name', timeout=15000); p.fill('#lb-name', 'chris'); p.fill('#lb-pin', '4321'); p.click('#lb-submit')
    p.wait_for_selector('#lb-create-btn', timeout=15000); p.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())"); time.sleep(0.5)
    p.evaluate("AdminConsole.open()"); p.wait_for_selector('.adm-tab', timeout=8000)
    for i, t in enumerate(['bank', 'accounts', 'table']):
        p.click('.adm-tab[data-t=%s]' % t); time.sleep(1.2)
        path = os.path.join(out, '%s_admin_%d-%s.jpg' % (size, i + 1, t)); p.screenshot(path=path, type='jpeg', quality=58); print('shot', os.path.relpath(path, UIB))
        a = p.evaluate(open(os.path.join(UIB, 'audit.js')).read()); aud[t] = a
        print('  audit %s: %d text nodes, %d under size, %d under 4.5:1: %s' % (t, a['n'], len(a['small']), len(a['low']), [(x['name'], x['txt'], x.get('fs'), x.get('cr')) for x in a['small'][:5] + a['low'][:5]]))
    b.close()
json.dump(aud, open(os.path.join(out, '%s_admin_audit.json' % size), 'w'), indent=1)
