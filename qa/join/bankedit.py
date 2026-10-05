import os, signal, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); D = os.path.join(ROOT, 'qa', 'join'); PORT = 3914; URL = f'http://localhost:{PORT}/'
for f in ('bank-tmp3.json', 'ledger-tmp3.json'):
    try: os.remove(os.path.join(D, f))
    except FileNotFoundError: pass
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(D, 'bank-tmp3.json'), 'LEDGER_FILE': os.path.join(D, 'ledger-tmp3.json')}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
HELPER = open(os.path.join(D, 'capture.py')).read().split('HELPER = """')[1].split('"""')[0]
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); p = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        p.on('pageerror', lambda e: print('pageerror', e))
        p.goto(URL); p.wait_for_timeout(600)
        p.fill('#player-name', 'chris'); p.fill('#password-input', 'ping'); p.wait_for_timeout(250); p.click('#btn-join')
        p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(600)
        p.evaluate(HELPER, ['Bob', '🦊'])
        p.wait_for_timeout(3500)
        print('status', p.evaluate("state.gameState.status"))
        p.keyboard.press('b'); p.wait_for_timeout(1500)
        print('editable', p.locator('.bp-bal b.editable').count())
        p.screenshot(path=f'{D}/7-bank-open.png')
        p.locator('.bp-bal b.editable', has_text='').nth(0).click(); p.wait_for_timeout(300)
        p.wait_for_timeout(4500)  # survive a poll re-render
        print('input still there', p.locator('.bp-edit').count())
        p.fill('.bp-edit', '77777'); p.screenshot(path=f'{D}/8-bank-editing.png'); p.keyboard.press('Enter'); p.wait_for_timeout(1200)
        print('banks', p.evaluate("[...document.querySelectorAll('.bp')].map(e=>e.querySelector('.bp-who').textContent+':'+e.querySelector('.bp-bal b').textContent)"))
        p.screenshot(path=f'{D}/9-bank-saved.png'); b.close()
finally:
    srv.send_signal(signal.SIGTERM)
