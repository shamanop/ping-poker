"""Runs the real Ping server + Ballot Bender bonus round on THIS machine and screenshots it with a proof strip.
   python tools/shaman_demo.py [outdir]    (env: CHROME_CHANNEL=chrome for system Chrome, else bundled/executable via CHROME_PATH)
   Server-side RNG + wallet run in the node process started here; the proof strip reads live values (host, node pid, GPU, round id)."""
import json, os, socket, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'demo-out')
os.makedirs(OUT, exist_ok=True)
PORT = int(os.environ.get('PORT', '3481'))
URL = f'http://127.0.0.1:{PORT}/'


def emit_wait(pg, ev, payload, ok_ev, timeout=8000):
    return pg.evaluate("""([ev, payload, okEv, timeout]) => new Promise((res, rej) => {
        const s = window.PingSocket; const t = setTimeout(() => rej(new Error('timeout ' + okEv)), timeout);
        const done = (v) => { clearTimeout(t); s.off(okEv, done); res(v); };
        s.on(okEv, done); s.on('auth_error', (e) => rej(new Error(JSON.stringify(e)))); s.emit(ev, payload);
    })""", [ev, payload, ok_ev, timeout])


def gpu():
    try:
        return subprocess.run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader'],
                              capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0]
    except Exception:
        return 'no nvidia-smi'


def main():
    d = tempfile.mkdtemp(prefix='ping-demo-')
    env = dict(os.environ, PORT=str(PORT), ACCOUNTS_FILE=f'{d}/accounts.json', BANK_FILE=f'{d}/bank.json',
               LEDGER_FILE=f'{d}/ledger.json', WALLET_FILE=f'{d}/wallet.json', TABLES_FILE=f'{d}/tables.json')
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=open(f'{d}/server.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(2.5)
    host = socket.gethostname()
    try:
        with sync_playwright() as p:
            kw = {}
            if os.environ.get('CHROME_CHANNEL'): kw['channel'] = os.environ['CHROME_CHANNEL']
            if os.environ.get('CHROME_PATH'): kw['executable_path'] = os.environ['CHROME_PATH']
            b = p.chromium.launch(args=['--no-sandbox'] + (['--disable-gpu'] if os.environ.get('NO_GPU') else []), **kw)
            pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
            print('step', 'pg.goto(URL)', flush=True)
            pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
            print('step', "emit_wait(pg, 'auth_", flush=True)
            emit_wait(pg, 'auth_signup', {'name': 'Shaman' + str(int(time.time()) % 10000), 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
            pg.wait_for_selector('body.sh-on', timeout=10000)
            try:
                pg.wait_for_selector('.pj-modal.open .claim', timeout=3000); pg.click('.pj-modal.open .claim')
                pg.wait_for_selector('.pj-modal', state='detached', timeout=4000)
            except Exception:
                pass
            print('step', 'pg.evaluate("Shell.o', flush=True)
            pg.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})")
            f = None
            for _ in range(60):
                f = next((fr for fr in pg.frames if '/games/bender/' in fr.url), None)
                if f: break
                pg.wait_for_timeout(200)
            print('step', "f.locator('#go')", flush=True)
            f.locator('#go').click(timeout=10000); pg.wait_for_timeout(1500)

            def strip(extra=''):
                g = gpu()
                last = f.evaluate("(() => { const l = window.BENDER && window.BENDER.last; return l ? {mult: l.totalWinMult, tier: l.tier || null, bonus: l.bonus ? l.bonus.kind : null, spins: l.bonus ? l.bonus.spins.length : 0} : null; })()")
                txt = f"RUNNING ON {host}  |  node server pid {srv.pid} :{PORT}  |  GPU {g}  |  server-side round {json.dumps(last)} {extra}"
                pg.evaluate("""(t) => { let d = document.getElementById('__proof'); if (!d) { d = document.createElement('div'); d.id = '__proof';
                    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#0A1628;color:#F5B942;font:600 13px monospace;padding:6px 10px;border-top:2px solid #F5B942'; document.body.appendChild(d); } d.textContent = t; }""", txt)

            shots = 0
            best = -1
            for rnd in range(int(os.environ.get('ROUNDS', '4'))):
                print('round', rnd, flush=True)
                f.evaluate("(() => { BENDER.play('buy-election'); return 1; })()")
                n = 0
                t0 = time.time()
                while time.time() - t0 < 90:
                    pg.wait_for_timeout(500)
                    try:
                        f.evaluate("(() => { const sc = document.querySelector('#ov .scrim'); const t = sc && sc.querySelector('.tap'); if (t && /START/.test(t.textContent)) { sc._done && sc._done('x'); } })()")
                        end = f.evaluate("(() => { const t = document.querySelector('#ov .scrim .tap'); return !!(t && /CONTINUE/.test(t.textContent)); })()")
                    except Exception:
                        end = False
                    strip(f'round {rnd}')
                    pg.screenshot(path=f'{OUT}/r{rnd}-{n:03d}.png'); n += 1; shots += 1
                    if end:
                        pg.wait_for_timeout(600); strip(f'round {rnd} FINAL'); pg.screenshot(path=f'{OUT}/r{rnd}-final.png')
                        f.evaluate("(() => { const sc = document.querySelector('#ov .scrim'); sc && sc._done && sc._done('x'); })()")
                        break
                mult = f.evaluate("(window.BENDER.last || {}).totalWinMult || 0")
                print('round', rnd, 'frames', n, 'mult', mult, flush=True)
                pg.wait_for_timeout(1500)
            print('shots', shots, 'errors', errs[:3], 'host', host, 'pid', srv.pid)
            print(open(f'{d}/server.log').read()[-300:])
            b.close()
    finally:
        srv.terminate()


main()
