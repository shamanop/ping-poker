"""Two browser contexts on the same station must hear the same moment (<=300 ms), after join, station switch,
track boundary and reload of one. Then a second launch without the autoplay flag checks the blocked -> click-to-start path.
Usage: python3 qa/music/two_context.py   (PORT 4781, outputs in qa/music/)"""
import os, subprocess, sys, tempfile, time, json
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = os.path.dirname(__file__)
PORT = os.environ.get('PORT', '4781'); URL = f'http://127.0.0.1:{PORT}/'
TOL = 300
d = tempfile.mkdtemp(prefix='music-qa-')
env = dict(os.environ, PORT=PORT, ACCOUNTS_FILE=f'{d}/a.json', BANK_FILE=f'{d}/b.json', LEDGER_FILE=f'{d}/l.json', WALLET_FILE=f'{d}/w.json', TABLES_FILE=f'{d}/t.json', DATA_DIR=d)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=open(f'{OUT}/srv-two.log', 'w'), stderr=subprocess.STDOUT); time.sleep(2.5)
results = []; fails = []
def check(name, ok, detail=''):
    results.append((name, ok, detail)); print(('PASS ' if ok else 'FAIL ') + name, detail)
    if not ok: fails.append(name)
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
def join(ctx, name):
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append((str(e)[:120] + ' | ' + str(getattr(e, 'stack', ''))[:300])))
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
    ew(pg, 'auth_signup', {'name': name, 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
    pg.wait_for_selector('body.sh-on', timeout=10000)
    try: pg.wait_for_selector('.pj-modal.open .claim', timeout=3000); pg.click('.pj-modal.open .claim'); pg.wait_for_timeout(500)
    except Exception: pass
    return pg
def playing(pg, timeout=15000):
    pg.wait_for_function("window.PingMusic && PingMusic.nowPlaying().playing && PingMusic.nowPlaying().audioOffsetSec!=null", timeout=timeout)
SAMPLE = "() => { const n = PingMusic.nowPlaying(); return {t: Date.now(), st: n.station && n.station.id, idx: n.audioTrackIndex, off: n.audioOffsetSec, exp: n.expectedOffsetSec, drift: n.driftSec, rate: n.rate, rtt: n.rttMs, hs: n.hardSeeks, nudges: n.nudges} }"
def start_instant(s): return s['t'] - s['off'] * 1000
def compare(label, a, b, n=3):
    worst = 0; info = ''
    for i in range(n):
        sa = a.evaluate(SAMPLE); sb = b.evaluate(SAMPLE)
        same = sa['st'] == sb['st'] and sa['idx'] == sb['idx'] and sa['idx'] is not None
        delta = abs(start_instant(sa) - start_instant(sb)) if same else 99999
        worst = max(worst, delta); info = f"st={sa['st']}/{sb['st']} idx={sa['idx']}/{sb['idx']} off={sa['off']:.2f}/{sb['off']:.2f}"
        b.wait_for_timeout(400)
    check(label, worst <= TOL, f'worst delta {worst:.0f} ms ({info})')
    return worst
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        A = br.new_context(viewport={'width': 1440, 'height': 800}); B = br.new_context(viewport={'width': 1440, 'height': 800})
        a = join(A, 'MusA' + str(int(time.time()) % 1000)); b = join(B, 'MusB' + str(int(time.time()) % 1000))
        playing(a); playing(b)
        st = a.evaluate("PingMusic.stations().map(s=>s.id)"); check('stations delivered', len(st) >= 2, str(st))
        a.wait_for_timeout(2500)
        compare('same station: same track + offset after join', a, b)
        # station switch on both
        target = st[1]
        a.evaluate(f"PingMusic.setStation('{target}')"); b.evaluate(f"PingMusic.setStation('{target}')")
        playing(a); playing(b); a.wait_for_timeout(2500)
        compare('after station switch', a, b)
        # skew: B joins the other station then returns -> lands on same moment
        b.evaluate(f"PingMusic.setStation('{st[2]}')"); playing(b); b.wait_for_timeout(1200)
        sb = b.evaluate(SAMPLE); check('different station = different stream', sb['st'] == st[2])
        b.evaluate(f"PingMusic.setStation('{target}')"); playing(b); b.wait_for_timeout(2500)
        compare('B hops away and back', a, b)
        # reload of B
        b.reload(); b.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
        try: b.wait_for_selector('body.sh-on', timeout=10000)
        except Exception:
            ew(b, 'auth_login', {'name': 'x', 'pin': '1234'}, 'auth_ok')
        playing(b, 20000); b.wait_for_timeout(2500)
        compare('after reload of B (session restored, station persisted)', a, b)
        # cross a track boundary: wait for the track index to roll over on A
        i0 = a.evaluate(SAMPLE)['idx']
        a.wait_for_function(f"PingMusic.nowPlaying().audioTrackIndex !== {i0} && PingMusic.nowPlaying().audioTrackIndex !== null", timeout=40000)
        b.wait_for_function(f"PingMusic.nowPlaying().audioTrackIndex !== {i0} && PingMusic.nowPlaying().audioTrackIndex !== null", timeout=10000)
        a.wait_for_timeout(1500)
        compare('after track boundary', a, b)
        # local pause then resume rejoins in sync
        b.evaluate("PingMusic.pause()"); b.wait_for_timeout(3000)
        check('local pause stops B only', b.evaluate("PingMusic.nowPlaying().status") == 'paused' and a.evaluate("PingMusic.nowPlaying().playing"))
        b.evaluate("PingMusic.play()"); playing(b); b.wait_for_timeout(2500)
        compare('after pause/resume', a, b)
        # drift correction: small drift is nudged via playbackRate, large drift is re-seeked
        a.evaluate("PingMusic._debug.el().currentTime += 0.25"); a.evaluate("PingMusic._debug.correct(false)")
        r1 = a.evaluate("PingMusic.nowPlaying()"); check('250 ms drift -> playbackRate nudge (no seek)', r1['rate'] < 1 and r1['hardSeeks'] == 0, f"rate={r1['rate']:.3f} drift={r1['driftSec']:.3f}")
        a.wait_for_timeout(6000); r1b = a.evaluate("PingMusic.nowPlaying()")
        a.evaluate("PingMusic._debug.el().currentTime += 1.5"); a.evaluate("PingMusic._debug.correct(false)"); a.wait_for_timeout(500)
        r2 = a.evaluate("PingMusic.nowPlaying()"); check('1.5 s drift -> hard re-seek', r2['hardSeeks'] >= 1 and abs(r2['audioOffsetSec'] - r2['expectedOffsetSec']) < 0.3, f"hardSeeks={r2['hardSeeks']}")
        a.wait_for_timeout(1500); compare('A re-converges with B after forced drifts', a, b)
        # a listener whose local clock is 7 s fast still lands on the same moment (server-time offset correction)
        D = br.new_context(viewport={'width': 1440, 'height': 800})
        D.add_init_script("(()=>{const o=Date.now.bind(Date);Date.now=()=>o()+7000})()")
        dpg = join(D, 'MusD' + str(int(time.time()) % 1000)); dpg.evaluate(f"PingMusic.setStation('{target}')"); playing(dpg); dpg.wait_for_timeout(2500)
        sa = a.evaluate(SAMPLE); sd = dpg.evaluate(SAMPLE); sd['t'] -= 7000
        dd = abs(start_instant(sa) - start_instant(sd)) if sa['idx'] == sd['idx'] else 99999
        check('client clock +7 s skew corrected by ping offset', dd <= TOL, f"delta {dd:.0f} ms, clockOffsetMs={dpg.evaluate('PingMusic.nowPlaying().clockOffsetMs'):.0f}")
        D.close()
        # volume persistence + duck
        b.evaluate("PingMusic.volume(0.8)"); b.reload(); b.wait_for_selector('#mu-bar', timeout=15000)
        check('volume persisted', abs(b.evaluate("PingMusic.volume()") - 0.8) < 1e-6)
        g0 = a.evaluate("PingMusic.nowPlaying().gain"); a.evaluate("PingMusic.duck(600, 0.7)"); a.wait_for_timeout(300)
        g1 = a.evaluate("PingMusic.nowPlaying().gain"); a.wait_for_timeout(1500); g2 = a.evaluate("PingMusic.nowPlaying().gain")
        check('duck lowers then restores gain', g1 < g0 * 0.45 and abs(g2 - g0) < 1e-3, f'{g0:.3f} -> {g1:.3f} -> {g2:.3f}')
        a.screenshot(path=f'{OUT}/bar-playing.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 70})
        a.click('#mu-now'); a.wait_for_timeout(300)
        a.screenshot(path=f'{OUT}/picker-open.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 360})
        # sync diagnostics
        for nm, pg in (('A', a), ('B', b)):
            s = pg.evaluate(SAMPLE); print(nm, 'rtt', s['rtt'], 'hardSeeks', s['hs'], 'nudges', s['nudges'], 'drift', s['drift'])
        errs = [e for e in a.errs + b.errs if 'bank.js' not in e]  # bank.js insertBefore error is pre-existing (not music)
        check('no page errors from music/shell', not errs, str(errs))
        br.close()
    # second launch: default autoplay policy -> blocked, then a real click starts it
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=document-user-activation-required'])
        C = br.new_context(viewport={'width': 1440, 'height': 800})
        # Playwright evaluate() and this chromium build both bypass the autoplay policy, so gate play() ourselves until a real pointerdown
        C.add_init_script("(()=>{let ok=false;addEventListener('pointerdown',()=>{ok=true},true);const p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return ok?p.call(this):Promise.reject(new DOMException('gated','NotAllowedError'))}})()")
        c = join(C, 'MusC' + str(int(time.time()) % 1000))
        c.reload(); c.wait_for_selector('body.sh-on', timeout=15000)  # fresh document: gate closed again
        c.wait_for_timeout(2500)
        stt = c.evaluate("PingMusic.nowPlaying().status")
        c.screenshot(path=f'{OUT}/bar-blocked.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 70})
        print('status without gesture:', stt)
        check('autoplay-gated: blocked state + prompt shown', stt == 'blocked' and 'Click anywhere' in c.inner_text('#mu-bar'), stt)
        if stt == 'blocked':
            c.mouse.click(700, 400); playing(c, 10000)
            check('first gesture starts playback', True)
            c.wait_for_timeout(1500); c.set_viewport_size({'width': 1100, 'height': 700}); c.wait_for_timeout(300)
            c.screenshot(path=f'{OUT}/bar-1100.png', clip={'x': 0, 'y': 0, 'width': 1100, 'height': 70})
            c.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})"); c.wait_for_timeout(3500)
            c.screenshot(path=f'{OUT}/bar-with-docked-game.png', timeout=60000)
        br.close()
finally:
    srv.terminate()
json.dump([{'name': n, 'ok': o, 'detail': dd} for n, o, dd in results], open(f'{OUT}/two_context_results.json', 'w'), indent=1)
print('FAILED:' if fails else 'ALL PASS', fails)
sys.exit(1 if fails else 0)
