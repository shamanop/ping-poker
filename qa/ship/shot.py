import os, subprocess, sys, tempfile, time, json
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = sys.argv[1]; W, H = int(sys.argv[2]), int(sys.argv[3]); PORT = sys.argv[4] if len(sys.argv) > 4 else '3601'
os.makedirs(OUT, exist_ok=True)
d = tempfile.mkdtemp(prefix='shipshot-')
env = dict(os.environ, PORT=PORT, ACCOUNTS_FILE=f'{d}/a.json', BANK_FILE=f'{d}/b.json', LEDGER_FILE=f'{d}/l.json', WALLET_FILE=f'{d}/w.json', TABLES_FILE=f'{d}/t.json', DATA_DIR=d)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT); time.sleep(2.5)
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        pg = b.new_context(viewport={'width': W, 'height': H}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:150]))
        pg.goto(f'http://127.0.0.1:{PORT}/'); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
        ew(pg, 'auth_signup', {'name': 'Shot' + str(int(time.time()) % 1000), 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
        pg.wait_for_selector('body.sh-on', timeout=10000)
        try:
            pg.wait_for_selector('.pj-modal.open .claim', timeout=3000); pg.click('.pj-modal.open .claim'); pg.wait_for_timeout(800)
        except Exception: pass
        pg.screenshot(path=f'{OUT}/lobby.png')
        pg.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})")
        f = None
        for _ in range(60):
            f = next((fr for fr in pg.frames if '/games/bender/' in fr.url), None)
            if f: break
            pg.wait_for_timeout(200)
        pg.wait_for_timeout(2500); pg.screenshot(path=f'{OUT}/dock-splash.png')
        f.locator('#go').click(timeout=10000); pg.wait_for_timeout(2500); pg.screenshot(path=f'{OUT}/dock.png', timeout=90000)
        pg.evaluate("Shell.openGame('bender', {mode: 'float'})"); pg.wait_for_timeout(1500); pg.screenshot(path=f'{OUT}/float.png', timeout=90000)
        print('errors', errs[:3]); b.close()
finally:
    srv.terminate()
