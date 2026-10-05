import os, signal, subprocess, time, urllib.request, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.dirname(os.path.abspath(__file__)); PORT = 3923; URL = f'http://localhost:{PORT}/'
open(OUT+'/bank.json','w').write(json.dumps({'chris':10000,'liam':10000})); open(OUT+'/ledger.json','w').write('[]')
srv = subprocess.Popen(['node','server.js'], cwd=ROOT, env={**os.environ,'PORT':str(PORT),'BANK_FILE':OUT+'/bank.json','LEDGER_FILE':OUT+'/ledger.json'}, stdout=open(OUT+'/server.log','w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(.25)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width':1440,'height':900})
        pa = ctx.new_page(); pb = ctx.new_page()
        for p,n in ((pa,'Chris'),(pb,'Liam')):
            p.goto(URL, wait_until='load'); p.wait_for_timeout(500)
            p.fill('#player-name',n); p.fill('#password-input','ping'); p.click('#btn-join'); p.wait_for_timeout(800)
        pa.wait_for_timeout(2500)
        pa.click('#bank-btn'); pa.wait_for_timeout(1000)
        pa.screenshot(path=f'{OUT}/bank-1.png')
        el = pa.query_selector('[data-total]')
        print('editable total el:', bool(el))
        if el:
            el.click(); pa.wait_for_timeout(300); pa.keyboard.press('Control+A'); pa.keyboard.type('25000'); pa.keyboard.press('Enter'); pa.wait_for_timeout(1000)
            pa.screenshot(path=f'{OUT}/bank-2.png')
        print(open(OUT+'/bank.json').read())
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(5)
