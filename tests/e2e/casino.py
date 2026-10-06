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


def bender_frame(pg):
    for _ in range(40):
        for fr in pg.frames:
            if '/games/bender/' in fr.url: return fr
        pg.wait_for_timeout(150)
    raise RuntimeError('no bender frame')


def signup(pg, name):
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=10000)
    r = emit_wait(pg, 'auth_signup', {'name': name, 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
    pg.wait_for_selector('body.sh-on', timeout=8000)
    try:
        pg.wait_for_selector('.pj-modal.open .claim', timeout=3000)
        pg.click('.pj-modal.open .claim'); pg.wait_for_selector('.pj-modal', state='detached', timeout=4000)
    except Exception:
        pass
    return r


def main():
    d = tempfile.mkdtemp(prefix='casino-e2e-', dir=os.path.join(ROOT, 'qa', 'overnight'))
    env = dict(os.environ, PORT=str(PORT), ACCOUNTS_FILE=f'{d}/accounts.json', BANK_FILE=f'{d}/bank.json',
               LEDGER_FILE=f'{d}/ledger.json', WALLET_FILE=f'{d}/wallet.json', TABLES_FILE=f'{d}/tables.json')
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=open(f'{d}/server.log', 'w'), stderr=subprocess.STDOUT)
    time.sleep(2.0)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ca = b.new_context(viewport={'width': 1440, 'height': 900}); cb = b.new_context(viewport={'width': 1440, 'height': 900})
            a, c = ca.new_page(), cb.new_page()
            errs = []
            a.on('pageerror', lambda e: errs.append(str(e) + ' | ' + str(getattr(e, 'stack', ''))[:300]))
            signup(a, 'Alice'); signup(c, 'Bob')
            check(__import__('re').sub(r'play\s*\$', '', a.locator('#sh-play').inner_text().replace('\n', ' '), flags=__import__('re').I).count('$') == 1, 'wallet bar shows Play $ after sign-in (label "Play $" plus one dollar value)')
            t = emit_wait(a, 'table_create', {'settings': {'name': 'E2E Night', 'mode': 'play', 'buyIn': {'min': 500, 'max': 50000, 'default': 10000},
                                                              'blinds': {'sb': 50, 'bb': 100}, 'seats': 6, 'actionTimerSec': 0, 'isPrivate': False}}, 'table_created')
            tid = (t.get('table') or t)['id']
            ja = emit_wait(a, 'table_join', {'tableId': tid, 'buyIn': 10000}, 'table_joined')
            jb = emit_wait(c, 'table_join', {'tableId': tid, 'buyIn': 10000}, 'table_joined')
            a.evaluate('(j) => window.PingGame.enter(j)', ja); c.evaluate('(j) => window.PingGame.enter(j)', jb)
            a.wait_for_timeout(2500)
            a.screenshot(path=f'{OUT}/casino-1-poker.png', timeout=60000)

            # slot beside the table
            a.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})")
            f = bender_frame(a); f.locator('#go').click(timeout=8000); a.wait_for_timeout(1500)
            check(f.locator('#modebar').inner_text().find('Play $') >= 0, 'bender shows Play $ | Ledger $ switch (server bridge live)')
            check(a.evaluate("document.getElementById('sh-stage').getBoundingClientRect().width") < 1100, 'poker stage shrank for docked slot')
            before = a.locator('#sh-play').inner_text()
            bb = f.evaluate("(() => { const r = document.getElementById('spin').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })()")
            ib = a.evaluate("(() => { const r = document.querySelector('iframe[src*=bender]').getBoundingClientRect(); return {x: r.x, y: r.y}; })()")
            a.mouse.click(ib['x'] + bb['x'] + bb['width'] / 2, ib['y'] + bb['y'] + bb['height'] / 2); a.wait_for_timeout(6500)
            a.screenshot(path=f'{OUT}/casino-2-docked.png', timeout=60000)
            play_txt = a.locator('#sh-play').inner_text()
            check(play_txt != before, f'Play $ changed after spin ({before!r} -> {play_txt!r})')

            # poker action while slot has focus (whoever's turn it is; both contexts tried)
            a.evaluate("Shell.focus('bender')")
            acted = False
            for pg in (a, c):
                for _ in range(40):
                    if pg.evaluate("!!document.querySelector('#btn-check-call') && !document.querySelector('#btn-check-call').disabled"):
                        break
                    pg.wait_for_timeout(250)
                else:
                    continue
                if pg is a:
                    check(a.evaluate("document.querySelector('.sh-di[data-game=poker]').classList.contains('pulse')"), 'poker dock item pulses "Your turn" while slot is focused')
                pg.locator('#btn-check-call').click(); acted = True; break
            check(acted, 'poker action taken while slot window open and focused')

            # Ledger $ spin carries ledger meta; Play $ does not break
            def clear_scrims():
                for _ in range(8):
                    if not f.evaluate("(() => { const sc = document.querySelector('#ov .scrim'); if (!sc) return false; sc._done && sc._done('x'); return true; })()"): break
                    a.wait_for_timeout(700)

            def spin():
                clear_scrims()
                bb = f.evaluate("(() => { const r = document.getElementById('spin').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })()")
                ib = a.evaluate("(() => { const r = document.querySelector('iframe[src*=bender]').getBoundingClientRect(); return {x: r.x, y: r.y}; })()")
                a.mouse.click(ib['x'] + bb['x'] + bb['width'] / 2, ib['y'] + bb['y'] + bb['height'] / 2); a.wait_for_timeout(6500)
            clear_scrims(); f.locator('#modebar button[data-m=ledger]').click(); a.wait_for_timeout(500)
            l0 = a.locator('#sh-ledger').inner_text() if a.locator('#sh-ledger').count() else ''
            spin()
            l1 = a.locator('#sh-ledger').inner_text() if a.locator('#sh-ledger').count() else ''
            check(l0 != l1, f'wallet badge (Ledger $) updated after spin ({l0!r} -> {l1!r})')
            import json
            rows = []
            for _ in range(10):
                try: rows = [r for r in json.load(open(f'{d}/ledger.json')) if r.get('game') == 'bender']
                except Exception: rows = []
                if rows: break
                time.sleep(0.5)
            check(any(r.get('mode') == 'ledger' for r in rows), f'ledger rows carry game=bender mode=ledger meta ({len(rows)} rows)')
            check(not any(r.get('mode') == 'play' for r in rows), 'Play $ spins not written to ledger')
            clear_scrims(); f.locator('#modebar button[data-m=play]').click(); a.wait_for_timeout(500)
            p0 = a.locator('#sh-play').inner_text(); spin()
            check(a.locator('#sh-play').inner_text() != p0, 'Play $ still spins after Ledger $ round')
            check(a.evaluate("document.getElementById('game-screen').classList.contains('active')"), 'poker table still live after spins')

            # minimize badge + layout persistence
            a.evaluate("Shell.minimize('bender')"); a.wait_for_timeout(300)
            bt = a.evaluate("document.querySelector('.sh-di[data-game=bender] .badge').textContent")
            print('INFO minimized badge:', repr(bt))
            check(bt[:2] in ('+$', '-$'), f'minimized dock badge shows net {bt!r}')
            for (W, H) in ((1440, 900), (1920, 1080)):
                a.set_viewport_size({'width': W, 'height': H}); a.wait_for_timeout(600)
                for mode in ('dock', 'float', 'min'):
                    if mode == 'dock': a.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})")
                    elif mode == 'float': a.evaluate("Shell.float('bender')")
                    else: a.evaluate("Shell.minimize('bender')")
                    a.wait_for_timeout(900)
                    a.screenshot(path=f'{OUT}/b-{mode}-{W}.png', timeout=60000)
                    if mode == 'dock':
                        sw = a.evaluate("document.getElementById('sh-stage').getBoundingClientRect().width")
                        gr = a.evaluate("(() => { const g = document.querySelector('.g-grid'); const r = g.getBoundingClientRect(); const st = document.getElementById('sh-stage').getBoundingClientRect(); return [r.right <= st.right + 1, r.left >= st.left - 1, document.documentElement.scrollWidth <= window.innerWidth]; })()")
                        check(all(gr), f'docked poker grid fits stage at {W} (stage {sw:.0f}) {gr}')
            a.evaluate("Shell.minimize('bender')"); a.wait_for_timeout(300)
            a.set_viewport_size({'width': 1440, 'height': 900})
            a.close(); a = ca.new_page(); a.goto(URL, wait_until='domcontentloaded'); a.wait_for_function('window.Shell'); a.wait_for_timeout(1500)
            check(a.evaluate("JSON.parse(localStorage.getItem('ping.layout')).games.bender.mode") == 'min', 'layout persisted after reload (ping.layout)')
            a.screenshot(path=f'{OUT}/casino-3-min.png', timeout=60000)
            check(not errs, f'no page errors {errs[:2]}'); print('ERRSTACK', errs[:1])
            b.close()
    finally:
        srv.terminate()
    print('FAILED: ' + '; '.join(fails) if fails else 'ALL PASS')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
