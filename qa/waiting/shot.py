import os, signal, subprocess, time, urllib.request, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.dirname(os.path.abspath(__file__)); PORT = 3921; URL = f'http://localhost:{PORT}/'
tag = sys.argv[1] if len(sys.argv) > 1 else 'before'
srv = subprocess.Popen(['node','server.js'], cwd=ROOT, env={**os.environ,'PORT':str(PORT),'BANK_FILE':OUT+'/bank.json','LEDGER_FILE':OUT+'/ledger.json'}, stdout=open(OUT+'/server.log','w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(.25)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w,h in ((1440,900),(1920,1080)):
            ctx = b.new_context(viewport={'width':w,'height':h}); p = ctx.new_page()
            p.goto(URL, wait_until='load'); p.wait_for_timeout(600)
            p.fill('#player-name','Chris'); p.fill('#password-input','ping'); p.click('#btn-join')
            p.wait_for_timeout(2500)
            p.screenshot(path=f'{OUT}/{tag}-{w}.png'); ctx.close()
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(5)
