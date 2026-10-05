"""End-to-end casino shell test (owner P). Run AFTER S/L/M land:
    PORT=3999 python3 tests/e2e/casino.py
Spawns the server on a spare port with temp data files, then drives two browser contexts:
sign up, create a Play $ table, seat both, open Ballot Bender docked beside the poker table,
spin in Play $, then take a poker action while the slot window has focus. Screenshots -> qa/overnight/casino-*.png.
Uses socket events (not lobby DOM) for sign-up/table/join so it survives lobby redesigns; the shell,
windows, wallet bar, bender iframe and poker action bar are driven through the real DOM.
"""
import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('PORT', '3999'))
OUT = os.path.join(ROOT, 'qa', 'overnight')
URL = f'http://127.0.0.1:{PORT}/'
fails = []


def check(ok, msg):
    print(('PASS ' if ok else 'FAIL ') + msg)
    if not ok:
        fails.append(msg)


def emit_wait(pg, ev, payload, ok_ev, timeout=6000):
    return pg.evaluate("""([ev, payload, okEv, timeout]) => new Promise((res, rej) => {
        const s = window.PingSocket; const t = setTimeout(() => rej(new Error('timeout ' + okEv)), timeout);
        const done = (v) => { clearTimeout(t); s.off(okEv, done); s.off('auth_error', fail); s.off('error', fail); res(v); };
        const fail = (e) => { clearTimeout(t); s.off(okEv, done); s.off('auth_error', fail); s.off('error', fail); rej(new Error(JSON.stringify(e))); };
        s.on(okEv, done); s.on('auth_error', fail); s.on('error', fail); s.emit(ev, payload);
    })""", [ev, payload, ok_ev, timeout])


def signup(pg, name):
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=10000)
    r = emit_wait(pg, 'auth_signup', {'name': name, 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
    pg.wait_for_selector('body.sh-on', timeout=8000)
    return r


def main():
    d = tempfile.mkdtemp(prefix='casino-e2e-', dir=os.path.join(ROOT, 'qa', 'overnight'))
    env = dict(os.environ, PORT=str(PORT), ACCOUNTS_FILE=f'{d}/accounts.json', BANK_FILE=f'{d}/bank.json',
               LEDGER_FILE=f'{d}/ledger.json', TABLES_FILE=f'{d}/tables.json')
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=open(f'{d}/server.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(2.0)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ca = b.new_context(viewport={'width': 1440, 'height': 900}); cb = b.new_context(viewport={'width': 1440, 'height': 900})
            a, c = ca.new_page(), cb.new_page()
            errs = []
            a.on('pageerror', lambda e: errs.append(str(e)))
            signup(a, 'Alice'); signup(c, 'Bob')
            check(a.locator('#sh-play').inner_text().replace('\n', ' ').count('$') == 1, 'wallet bar shows Play $ after sign-in')
            t = emit_wait(a, 'table_create', {'settings': {'name': 'E2E Night', 'mode': 'play', 'buyIn': {'min': 500, 'max': 50000, 'default': 10000},
                                                              'blinds': {'sb': 50, 'bb': 100}, 'seats': 6, 'actionTimerSec': 0, 'isPrivate': False}}, 'table_created')
            tid = (t.get('table') or t)['id']
            ja = emit_wait(a, 'table_join', {'tableId': tid, 'buyIn': 10000}, 'table_joined')
            jb = emit_wait(c, 'table_join', {'tableId': tid, 'buyIn': 10000}, 'table_joined')
            a.evaluate('(j) => window.PingGame.enter(j)', ja); c.evaluate('(j) => window.PingGame.enter(j)', jb)
            a.wait_for_timeout(2500)
            a.screenshot(path=f'{OUT}/casino-1-poker.png')

            # slot beside the table
            a.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})")
            f = a.frame_locator('iframe'); f.locator('#go').click(timeout=8000); a.wait_for_timeout(1500)
            check(f.locator('#modebar').inner_text().find('Play $') >= 0, 'bender shows Play $ | Ledger $ switch (server bridge live)')
            check(a.evaluate("document.getElementById('sh-stage').getBoundingClientRect().width") < 1100, 'poker stage shrank for docked slot')
            before = a.locator('#sh-play').inner_text()
            f.locator('#spin').click(); a.wait_for_timeout(6500)
            a.screenshot(path=f'{OUT}/casino-2-docked.png')
            play_txt = a.locator('#sh-play').inner_text()
            check(play_txt != before, f'Play $ changed after spin ({before!r} -> {play_txt!r})')

            # poker action while slot has focus (whoever's turn it is; both contexts tried)
            a.evaluate("Shell.focus('bender')")
            acted = False
            for pg in (a, c):
                for _ in range(40):
                    if pg.evaluate("!!document.querySelector('#my-turn-ring') && document.querySelector('#my-turn-ring').offsetParent !== null"):
                        break
                    pg.wait_for_timeout(250)
                else:
                    continue
                if pg is a:
                    check(a.evaluate("document.querySelector('.sh-di[data-game=poker]').classList.contains('pulse')"), 'poker dock item pulses "Your turn" while slot is focused')
                pg.locator('#btn-check-call').click(); acted = True; break
            check(acted, 'poker action taken while slot window open and focused')

            # minimize badge + layout persistence
            a.evaluate("Shell.minimize('bender')"); a.wait_for_timeout(300)
            a.reload(); a.wait_for_function('window.Shell'); a.wait_for_timeout(1500)
            check(a.evaluate("JSON.parse(localStorage.getItem('ping.layout')).games.bender.mode") == 'min', 'layout persisted after reload (ping.layout)')
            a.screenshot(path=f'{OUT}/casino-3-min.png')
            check(not errs, f'no page errors {errs[:2]}')
            b.close()
    finally:
        srv.terminate()
    print('FAILED: ' + '; '.join(fails) if fails else 'ALL PASS')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
