import os, signal, subprocess, time, urllib.request, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.dirname(os.path.abspath(__file__)); PORT = 3922; URL = f'http://localhost:{PORT}/'
open(OUT+'/bank.json','w').write(json.dumps({'chris':10000,'liam':10000})); open(OUT+'/ledger.json','w').write('[]')
srv = subprocess.Popen(['node','server.js'], cwd=ROOT, env={**os.environ,'PORT':str(PORT),'BANK_FILE':OUT+'/bank.json','LEDGER_FILE':OUT+'/ledger.json'}, stdout=open(OUT+'/server.log','w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(.25)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w,h in ((1440,900),(1920,1080)):
            ctx = b.new_context(viewport={'width':w,'height':h})
            pa = ctx.new_page(); pb = ctx.new_page()
            for p,n in ((pa,'Chris'),(pb,'Liam')):
                p.goto(URL, wait_until='load'); p.wait_for_timeout(500)
                p.fill('#player-name',n); p.fill('#password-input','ping'); p.click('#btn-join'); p.wait_for_timeout(800)
            pa.wait_for_timeout(2500)
            for p in (pa,pb):
                if p.is_enabled('#btn-fold'): p.click('#btn-fold'); break
            pa.wait_for_timeout(1200)
            pa.screenshot(path=f'{OUT}/foldwin-a-{w}.png'); pb.screenshot(path=f'{OUT}/foldwin-b-{w}.png')
            for p in (pa,pb):
                if p.is_visible('#show-panel button[data-w="0"]'):
                    p.click('#show-panel button[data-w="0"]'); p.wait_for_timeout(600)
                    p.screenshot(path=f'{OUT}/shown-{w}.png'); break
            pa.wait_for_timeout(7000)
            # showdown
            for _ in range(60):
                done=False
                for p in (pa,pb):
                    try:
                        if p.is_enabled('#btn-check-call'): p.click('#btn-check-call'); p.wait_for_timeout(150)
                    except Exception: pass
                if 'Showdown' in pa.inner_text('#log-list, #game-log, .log') if pa.query_selector('#log-list, #game-log, .log') else False: done=True
                if pa.query_selector('.peek-hand'): done=True
                if done: break
                pa.wait_for_timeout(250)
            pa.wait_for_timeout(700); pa.screenshot(path=f'{OUT}/showdown-{w}.png')
            pc = ctx.new_page(); pc.goto(f'{URL}bank.html' if False else URL, wait_until='load')
            ctx.close()
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(5)
