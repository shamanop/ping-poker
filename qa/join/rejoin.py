import os, signal, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); D = os.path.join(ROOT, 'qa', 'join'); PORT = 3913; URL = f'http://localhost:{PORT}/'
for f in ('bank-tmp2.json', 'ledger-tmp2.json'):
    try: os.remove(os.path.join(D, f))
    except FileNotFoundError: pass
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(D, 'bank-tmp2.json'), 'LEDGER_FILE': os.path.join(D, 'ledger-tmp2.json')}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
HELPER = open(os.path.join(D, 'capture.py')).read().split('HELPER = """')[1].split('"""')[0]
def join(p, name):
    p.fill('#player-name', name); p.fill('#password-input', 'ping'); p.wait_for_timeout(250)
    p.click('#btn-join'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(900)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}); p = ctx.new_page()
        p.on('pageerror', lambda e: print('pageerror', e))
        p.goto(URL); p.wait_for_timeout(600); join(p, 'Chris')
        for nm in ('Bob', 'Carla'): p.evaluate(HELPER, [nm, '🦊'])
        p.wait_for_timeout(500); p.click('#btn-start'); p.wait_for_timeout(2500)
        before = p.evaluate("state.gameState.players.map(x=>x.name+':'+x.chips)")
        p.reload(); p.wait_for_timeout(1500)   # refresh mid-hand
        join(p, 'Chris')
        p.wait_for_timeout(1000)
        st = p.evaluate("({n: state.gameState.players.map(x=>x.name), me: state.gameState.players[state.myIdx].name, bar: document.getElementById('bar-status-main').textContent, chips: state.gameState.players[state.myIdx].chips})")
        print('before', before); print('after', st)
        p.screenshot(path=f'{D}/6-refresh-rejoin.png')
        ok = st['n'].count('Chris') == 1 and st['me'] == 'Chris'
        print('RESULT', 'PASS' if ok else 'FAIL')
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
