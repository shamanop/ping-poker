import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = os.path.dirname(__file__)
d = tempfile.mkdtemp(prefix='music-shot-'); PORT = '4782'
env = dict(os.environ, PORT=PORT, ACCOUNTS_FILE=f'{d}/a.json', BANK_FILE=f'{d}/b.json', LEDGER_FILE=f'{d}/l.json', WALLET_FILE=f'{d}/w.json', TABLES_FILE=f'{d}/t.json', DATA_DIR=d)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); time.sleep(2.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        pg = b.new_context(viewport={'width': 1440, 'height': 800}).new_page()
        pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
        pg.evaluate("""() => new Promise(r=>{PingSocket.once('auth_ok',r);PingSocket.emit('auth_signup',{name:'ShotN',pin:'1234',avatar:'A'})})""")
        pg.wait_for_selector('body.sh-on'); pg.wait_for_timeout(3000)
        for w in (1440, 1280, 1100, 900):
            pg.set_viewport_size({'width': w, 'height': 700}); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{OUT}/bar-w{w}.png', clip={'x': 0, 'y': 0, 'width': w, 'height': 56})
        b.close()
finally: srv.terminate()
