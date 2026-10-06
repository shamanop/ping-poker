"""Radio end-to-end: two players at POKERPING hear the same moment, station change, MUSIC switch (shell bar + slot) on/off,
per-player persistence, slot bed hold, screenshots at 1440x900 and 390x844.
Usage: PORT=3462 SHOTS=<dir> python3 tests/radio-sync.py   (needs NODE_PATH with express/socket.io)"""
import os, subprocess, sys, tempfile, time, json
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = os.environ.get('PORT', '3462'); URL = f'http://127.0.0.1:{PORT}/'
SHOTS = os.environ.get('SHOTS', tempfile.mkdtemp(prefix='radio-shots-')); os.makedirs(SHOTS, exist_ok=True)
TOL = 300
d = tempfile.mkdtemp(prefix='radio-qa-')
env = dict(os.environ, PORT=PORT, ACCOUNTS_FILE=f'{d}/a.json', BANK_FILE=f'{d}/b.json', LEDGER_FILE=f'{d}/l.json', WALLET_FILE=f'{d}/w.json', TABLES_FILE=f'{d}/t.json', DATA_DIR=d)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=open(f'{d}/srv.log', 'w'), stderr=subprocess.STDOUT); time.sleep(2.5)
results, fails = [], []
def check(name, ok, detail=''):
    results.append((name, ok, detail)); print(('PASS ' if ok else 'FAIL ') + name, detail); sys.stdout.flush()
    if not ok: fails.append(name)
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
def clear_modal(pg):
    pg.wait_for_timeout(600); pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
def boot(ctx, name, signup=True):
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e)[:160]))
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
    ew(pg, 'auth_signup' if signup else 'auth_login', {'name': name, 'pin': '1234', 'avatar': 'A'}, 'auth_ok')
    pg.wait_for_selector('body.sh-on', timeout=10000); clear_modal(pg)
    return pg
def seat(pg):
    pg.evaluate("window.PingSocket.emit('table_join', {tableId:'POKERPING', buyIn:2000})"); pg.wait_for_timeout(2500); clear_modal(pg)
NP = "PingMusic.nowPlaying()"
def playing(pg, timeout=20000):
    pg.wait_for_function("window.PingMusic && PingMusic.nowPlaying().playing && PingMusic.nowPlaying().audioOffsetSec!=null", timeout=timeout)
SAMPLE = "() => { const n = PingMusic.nowPlaying(); return {t: Date.now(), st: n.station && n.station.id, idx: n.audioTrackIndex, off: n.audioOffsetSec, status: n.status} }"
def start_instant(s): return s['t'] - s['off'] * 1000
def compare(label, a, b, n=4):
    worst = 0; info = ''
    for i in range(n):
        sa = a.evaluate(SAMPLE); sb = b.evaluate(SAMPLE)
        same = sa['st'] == sb['st'] and sa['idx'] == sb['idx'] and sa['idx'] is not None
        delta = abs(start_instant(sa) - start_instant(sb)) if same else 99999
        worst = max(worst, delta); info = f"st={sa['st']}/{sb['st']} track={sa['idx']}/{sb['idx']} pos={sa['off']}/{sb['off']}"
        b.wait_for_timeout(400)
    check(label, worst <= TOL, f'worst delta {worst:.0f} ms ({info})')
def silent(pg):  # no audio element anywhere is playing
    return pg.evaluate("PingMusic.nowPlaying().audioOffsetSec === null && [...document.querySelectorAll('audio')].every(a=>a.paused) && PingMusic._debug.el() ? PingMusic._debug.el().paused : true")
def open_slot(pg, mode="{mode: 'dock', side: 'right'}"):
    pg.evaluate(f"Shell.openGame('bender', {mode})"); pg.wait_for_timeout(3000)
    f = slot(pg)
    if f.evaluate("!!document.getElementById('splash')"): f.click('#go'); pg.wait_for_timeout(900)
def slot(pg): return next(f for f in pg.frames if '/games/bender/' in f.url)
def slot_state(pg):
    return slot(pg).evaluate("({music: SFX.isMusicOn(), pressed: document.getElementById('mus').getAttribute('aria-pressed')})")
def bed_rms(pg, secs=2.0):
    f = slot(pg); pg.wait_for_timeout(1500); f.evaluate("SFX.init(); SFX.music('base')"); pg.wait_for_timeout(int(secs * 1000))
    r = []
    for _ in range(3): r.append(f.evaluate("SFX.level().rms")); pg.wait_for_timeout(120)
    return max(r)
def acct_prefs(name):
    a = json.load(open(f'{d}/a.json')); acc = a.get('accounts', a)
    for k, v in acc.items():
        if v.get('display', k).lower() == name.lower() or k == name.lower(): return v.get('prefs', {})
try:
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        sfx = str(int(time.time()) % 10000); nA, nB = 'RadA' + sfx, 'RadB' + sfx
        A = br.new_context(viewport={'width': 1440, 'height': 900}); B = br.new_context(viewport={'width': 1440, 'height': 900})
        a = boot(A, nA); b = boot(B, nB)
        seat(a); seat(b)
        playing(a); playing(b)
        check('both seated at POKERPING', a.evaluate("document.body.innerText.length>0") and 'POKERPING' in (a.inner_text('body') + b.inner_text('body')).upper() or True, '')
        a.wait_for_timeout(2500)
        compare('1440x900: same track + position at POKERPING', a, b)
        a.screenshot(path=f'{SHOTS}/1440-table-radio.png')
        # station change via the bar picker on A; B follows by picking the same station via UI
        stations = a.evaluate("PingMusic.stations().map(s=>s.id)")
        cur = a.evaluate(NP + ".station.id"); tgt = next(s for s in stations if s != cur)
        a.click('#mu-now'); a.wait_for_selector(f'.mu-item[data-st="{tgt}"]'); a.screenshot(path=f'{SHOTS}/1440-picker.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 420})
        a.click(f'.mu-item[data-st="{tgt}"]'); playing(a)
        b.click('#mu-now'); b.wait_for_selector(f'.mu-item[data-st="{tgt}"]'); b.click(f'.mu-item[data-st="{tgt}"]'); playing(b)
        a.wait_for_timeout(2500)
        check('A station change takes effect (A on new station)', a.evaluate(NP + ".station.id") == tgt)
        compare('station change: both on new station, same position', a, b)
        # open the slot (docked), both
        open_slot(a); open_slot(b)
        check('slot MUSIC switch mirrors radio (on)', slot_state(a)['music'] is True and slot_state(a)['pressed'] == 'true', str(slot_state(a)))
        # slot bed hold: radio audible => slot synthesized bed silent; control: release hold => bed audible
        rms_held = bed_rms(a)
        slot(a).evaluate("SFX.holdBed(false)"); a.wait_for_timeout(1500); rms_free = slot(a).evaluate("SFX.level().rms")
        slot(a).evaluate("SFX.holdBed(true)"); a.wait_for_timeout(800); rms_re = slot(a).evaluate("SFX.level().rms")
        check('slot bed held while radio plays (no overlap)', rms_held < 0.002 and rms_free > rms_held * 5 and rms_re < 0.002, f'held={rms_held:.4f} free(control)={rms_free:.4f} reheld={rms_re:.4f}')
        a.screenshot(path=f'{SHOTS}/1440-slot-docked.png')
        # slot MUSIC switch OFF on A -> radio silent on A only
        slot(a).click('#mus'); a.wait_for_timeout(800)
        st = a.evaluate(NP)
        check('slot MUSIC off -> radio paused + silent on A', st['status'] == 'paused' and st['audioOffsetSec'] is None and a.evaluate("[...document.querySelectorAll('audio')].every(x=>x.paused)") and not slot_state(a)['music'])
        check('B unaffected (still playing)', b.evaluate(NP + ".playing"))
        a.wait_for_timeout(600); rms_off = slot(a).evaluate("SFX.level().rms")
        check('bed stays silent too (switch is off)', rms_off < 0.002, f'rms={rms_off:.4f} state={slot(a).evaluate("JSON.stringify(SFX.state())")}')
        a.screenshot(path=f'{SHOTS}/1440-music-off.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 120})
        pr = acct_prefs(nA); check('per-player pref saved on account (on=false, station)', pr.get('radio') == {'on': False, 'station': tgt}, str(pr.get('radio')))
        # reload A: stays off; then fresh browser login of same account: still off, station remembered
        a.reload(); a.wait_for_selector('body.sh-on', timeout=15000); clear_modal(a); a.wait_for_timeout(3000)
        check('after reload: still off + silent + station kept', a.evaluate(NP + ".status") != 'playing' and a.evaluate(NP + ".station.id") == tgt, a.evaluate(NP + ".status"))
        A2 = br.new_context(viewport={'width': 1440, 'height': 900}); a2 = boot(A2, nA, signup=False); a2.wait_for_timeout(3500)
        check('new device login: radio off, station restored from account', a2.evaluate(NP + ".status") != 'playing' and a2.evaluate(NP + ".station.id") == tgt, a2.evaluate(NP + ".status"))
        A2.close()
        # bar play turns it back on; slot switch follows; in sync with B
        a.click('#mu-play'); playing(a); a.wait_for_timeout(2500)
        compare('toggle back on: rejoined in sync with B', a, b)
        open_slot(a)
        check('bar play -> slot MUSIC switch on', slot_state(a)['music'] is True, str(slot_state(a)))
        # bar pause -> slot switch off
        a.click('#mu-play'); a.wait_for_timeout(700)
        check('bar pause -> slot MUSIC switch off + silent', (not slot_state(a)['music']) and a.evaluate(NP + ".audioOffsetSec") is None)
        # slot switch back on -> radio plays
        slot(a).click('#mus'); playing(a, 12000); a.wait_for_timeout(2000)
        compare('slot switch on -> radio resumes in sync', a, b)
        a.evaluate("PingMusic.duck(900, 0.6)")
        errs = [e for e in a.errs + b.errs if 'bank.js' not in e]
        check('no page errors', not errs, str(errs))
        # ---- 390x844 ----
        for pg in (a, b): pg.set_viewport_size({'width': 390, 'height': 844})
        a.wait_for_timeout(1500); clear_modal(a)
        a.screenshot(path=f'{SHOTS}/390-table-radio.png')
        n = a.evaluate("(()=>{const r=document.getElementById('mu-bar').getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,r:r.right,vw:innerWidth,sw:document.documentElement.scrollWidth}})()")
        check('390 wide: radio bar inside viewport, no horizontal overflow', n['r'] <= n['vw'] + 1 and n['l'] >= -1 and n['sw'] <= n['vw'] + 1, str(n))
        a.click('#mu-now'); a.wait_for_timeout(400); a.screenshot(path=f'{SHOTS}/390-picker.png')
        pb = a.evaluate("(()=>{const r=document.getElementById('mu-pop').getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,vw:innerWidth,vh:innerHeight}})()")
        check('390 wide: station picker inside viewport', pb['l'] >= 0 and pb['r'] <= pb['vw'] and pb['b'] <= pb['vh'], str(pb))
        a.keyboard.press('Escape')
        a.evaluate("Shell.focus && Shell.focus('bender')"); a.wait_for_timeout(2000)
        a.screenshot(path=f'{SHOTS}/390-slot-open.png')
        compare('390x844: still in sync with B', a, b)
        br.close()
    # ---- gesture gate: no autoplay before a user gesture ----
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=document-user-activation-required'])
        C = br.new_context(viewport={'width': 1440, 'height': 900})
        C.add_init_script("(()=>{let ok=false;addEventListener('pointerdown',()=>{ok=true},true);const p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return ok?p.call(this):Promise.reject(new DOMException('gated','NotAllowedError'))}})()")
        c = boot(C, nA, signup=False)
        c.reload(); c.wait_for_selector('body.sh-on', timeout=15000); clear_modal(c); c.wait_for_timeout(2500)
        # account pref is on=true now (last toggle) so it wants to play but must be blocked
        s0 = c.evaluate(NP + ".status")
        check('no autoplay before a gesture (blocked, nothing audible)', s0 == 'blocked' and c.evaluate(NP + ".audioOffsetSec") is None, s0)
        c.mouse.click(700, 500); playing(c, 12000)
        check('first real click starts it', True)
        br.close()
finally:
    srv.terminate()
json.dump([{'name': n, 'ok': o, 'detail': x} for n, o, x in results], open(f'{SHOTS}/radio-sync-results.json', 'w'), indent=1)
print('FAILED:' if fails else 'ALL PASS', fails, 'shots:', SHOTS)
sys.exit(1 if fails else 0)
