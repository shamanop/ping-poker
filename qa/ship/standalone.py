import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
d = tempfile.mkdtemp(); PORT = '3621'
env = dict(os.environ, PORT=PORT, ACCOUNTS_FILE=f'{d}/a.json', BANK_FILE=f'{d}/b.json', LEDGER_FILE=f'{d}/l.json', WALLET_FILE=f'{d}/w.json', TABLES_FILE=f'{d}/t.json', DATA_DIR=d)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); time.sleep(3)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        pg = b.new_page(viewport={'width': int(sys.argv[2]), 'height': int(sys.argv[3])})
        pg.goto(f'http://127.0.0.1:{PORT}/games/bender/index.html?nosplash=1'); pg.wait_for_timeout(2500)
        pg.screenshot(path=sys.argv[1], timeout=60000); b.close()
finally:
    srv.terminate()
