"""Slots in the shell on a v2 server: a REAL spin for Ballot Bender (and Cold Call when the server was started with COLDCALL=1).
Opens the game from the dock, presses the game's own SPIN button inside its iframe, and checks: exactly one `g:<game>:spin` leaves, the
server answers `g:<game>:result` with no `error`, and the wallet the server then reports moved by exactly win - bet."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
games = sys.argv[1:] or ['bender']
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); fr = Frames(pg)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    sign_in(pg, 'by1'); set_pref(pg, 'chips')
    pg.evaluate("window.__ev = []; for (const e of ['wallet', 'error', 'g:bender:result', 'g:coldcall:result']) PingSocket.on(e, d => window.__ev.push([e, d]))")
    pg.evaluate("PingSocket.emit('bonus:claim')"); pg.wait_for_timeout(1500)   # take the daily bonus first so it cannot land between a spin and the wallet check
    for g in games:
        pg.evaluate("window.__ev.length = 0"); fr.clear()
        pg.click('.sh-di[data-game=%s]' % g)
        pg.wait_for_selector('.sh-win[data-game=%s] iframe' % g, timeout=15000)
        f = pg.frame_locator('.sh-win[data-game=%s] iframe' % g)
        f.locator('#spin').wait_for(timeout=20000); pg.wait_for_timeout(2500)
        c.ok('%s: page loaded in the shell without page errors' % g, not errs)
        if f.locator('#go').count():     # Ballot Bender's splash has a start button
            f.locator('#go').click(timeout=5000); pg.wait_for_timeout(1200)
        try: f.locator('#splash').wait_for(state='hidden', timeout=12000)   # Cold Call's splash clears itself once loaded
        except Exception: print(g, 'splash still up')
        pg.evaluate("window.__ev.length = 0"); pg.evaluate("PingSocket.emit('wallet_get')"); pg.wait_for_function("window.__ev.some(e => e[0] === 'wallet')", timeout=8000)
        before = [d for (e, d) in pg.evaluate("window.__ev") if e == 'wallet'][-1]
        pg.evaluate("window.__ev.length = 0"); fr.clear()
        f.locator('#spin').click(timeout=10000)
        try: pg.wait_for_function("window.__ev.some(e => e[0] === 'g:%s:result')" % g, timeout=30000)
        except Exception: pass
        ev = pg.evaluate("window.__ev")
        res = [d for (e, d) in ev if e == 'g:%s:result' % g]
        sp = fr.of('g:%s:spin' % g)
        c.eq('%s: exactly one spin frame left' % g, len(sp), 1)
        c.ok('%s: server answered with a result' % g, len(res) == 1)
        c.eq('%s: no error event' % g, [d for (e, d) in ev if e == 'error'], [])
        if res:
            r = res[0]; mode = r.get('mode') or 'play'
            c.eq('%s: wallet moved by exactly win - cost (server result)' % g, r['wallet'][mode], before[mode] - r['cost'] + r['totalWin'])
            c.eq('%s: cost equals the bet that left' % g, r['cost'], sp[0].get('bet') if sp else None)
            pg.evaluate("window.__ev.length = 0; PingSocket.emit('wallet_get')"); pg.wait_for_function("window.__ev.some(e => e[0] === 'wallet')", timeout=8000)
            c.eq('%s: wallet_get afterwards agrees with the result' % g, [d for (e, d) in pg.evaluate("window.__ev") if e == 'wallet'][-1][mode], r['wallet'][mode])
        pg.click('.sh-win[data-game=%s] [data-a=cl]' % g) if pg.locator('.sh-win[data-game=%s] [data-a=cl]' % g).count() else None
    b.close()
c.done('games_shell.py')
