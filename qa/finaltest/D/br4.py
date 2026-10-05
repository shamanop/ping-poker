from br_common import *
import subprocess, urllib.request
ROOT = os.path.abspath(os.path.join(D, '..', '..', '..'))
open(os.path.join(D, 'bank-br4.json'), 'w').write('{}'); open(os.path.join(D, 'ledger-br4.json'), 'w').write('[]')
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': '3114', 'BANK_FILE': os.path.join(D, 'bank-br4.json'), 'LEDGER_FILE': os.path.join(D, 'ledger-br4.json')}, stdout=open(os.path.join(D, 'server-br4.log'), 'w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
try:
  with sync_playwright() as p:
    ctx = launch(p, 'host'); pages = {}
    for n in ('Alice', 'Bob', 'Cara'):
        pg = ctx.new_page(); pg.goto(URL); pg.fill('#player-name', n); pg.fill('#password-input', 'ping'); pg.click('#btn-join'); pg.wait_for_selector('#lobby-screen.active'); pages[n] = pg
    time.sleep(0.5)
    vis = lambda pg: pg.evaluate("!document.getElementById('btn-start').classList.contains('hidden')")
    print('host UI before: Alice start visible', vis(pages['Alice']), 'Bob', vis(pages['Bob']))
    pages['Alice'].close(); time.sleep(1)
    print('after host (Alice) closes tab: Bob start visible', vis(pages['Bob']), 'Cara', vis(pages['Cara']))
    pages['Bob'].screenshot(path=os.path.join(D, 'shots', 'host-handoff-bob.png'))
    pages['Bob'].click('#btn-start'); 
    pages['Bob'].wait_for_selector('#game-screen.active', timeout=5000); pages['Cara'].wait_for_selector('#game-screen.active', timeout=5000)
    print('new host started game: OK')
    ctx.close()
finally:
    srv.terminate()
