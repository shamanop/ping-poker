import sys, json
from playwright.sync_api import sync_playwright
OUT='/home/isabelle/.openclaw/workspace/ping-poker-v2/qa/uiaudit3/'
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:120])); pg.on('console', lambda m: errs.append(m.text[:120]) if m.type=='error' else None)
    pg.goto('http://localhost:4461/'); pg.wait_for_timeout(800)
    pg.fill('#name-input','chris') if pg.query_selector('#name-input') else print('no name-input', pg.eval_on_selector_all('input','e=>e.map(x=>x.id)'))
    pg.fill('#password-input','ping'); pg.click('#btn-join'); pg.wait_for_timeout(2500)
    print('bank-btn', bool(pg.query_selector('#bank-btn')))
    pg.screenshot(path=OUT+'s0-table.png')
    print(errs[:5])
    b.close()
