import os, subprocess, tempfile, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); PORT = 3290
d = tempfile.mkdtemp(prefix='sshot-')
env = dict(os.environ, PORT=str(PORT), AUTO_START_MS='600000', BANK_FILE=d+'/bank.json', LEDGER_FILE=d+'/ledger.json', WALLET_FILE=d+'/wallet.json', ACCOUNTS_FILE=d+'/accounts.json')
proc = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
        pg.goto(f'http://localhost:{PORT}'); pg.wait_for_selector('#lb-signform')
        pg.click('[data-tab=up]'); pg.fill('#lb-name', 'Hank'); pg.fill('#lb-pin', '1234'); pg.click('[data-av=a03]'); pg.click('#lb-submit')
        pg.wait_for_selector('.pj-modal.open .claim'); pg.click('.pj-modal.open .claim'); pg.wait_for_selector('.pj-modal', state='detached')
        pg.evaluate("PingSocket.listeners('social:event').forEach(f => f({kind:'bigwin', name:'Ana', game:'bender', amountCents:152000, tier:'worldisyours'}))")
        pg.evaluate("PingSocket.listeners('account:stats').forEach(f => f({xpPct:45, level:3, winStreak:3}))")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(ROOT, 'qa/overnight/s-toast.png'))
        print('wallet', pg.inner_text('#sh-play').replace('\n', ' '))
        b.close()
finally:
    proc.kill()
