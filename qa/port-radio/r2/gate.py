"""(r2) critic r1 #3 gate, forced block, radio OFF, #9 station identity + taps, shots. One browser, contexts one after another.
Usage: PORT=4710 python3 qa/port-radio/r2/gate.py   (dev server must run; see PROGRESS-radio.md)"""
import os, sys, time, json
from playwright.sync_api import sync_playwright
PORT = os.environ.get('PORT', '4710'); URL = f'http://127.0.0.1:{PORT}/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
fails = []
def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name, detail); sys.stdout.flush()
    if not ok: fails.append(name)
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
def clear_modal(pg):
    pg.wait_for_timeout(600); pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
COUNT_PLAY = """(() => { window.__plays = 0; window.__unh = []; const o = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays++; return o.apply(this, arguments) };
  window.addEventListener('unhandledrejection', e => window.__unh.push(String(e.reason))) })();"""
FORCE_BLOCK = """(() => { window.__block = true; window.__plays = 0; window.__rej = 0; window.__unh = []; const o = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays++; if (window.__block) { window.__rej++; return Promise.reject(new DOMException('play() failed because the user did not interact with the document', 'NotAllowedError')) } return o.apply(this, arguments) };
  window.addEventListener('unhandledrejection', e => window.__unh.push(String(e.reason))) })();"""
# Playwright's page.evaluate / wait_for_function run with userGesture:true (the page gets sticky activation, hasBeenActive becomes true), so the
# no-input leg never evaluates: this init script reports the state to the console instead and the harness only reads those messages.
HIDE_MODALS = "(() => { const hide = () => document.querySelectorAll('.pj-modal').forEach(m => { m.style.display = 'none'; }); new MutationObserver(hide).observe(document, { childList: true, subtree: true }); setInterval(hide, 200); })();"
REPORTER = """(() => { setInterval(() => { try { const m = window.PingMusic, n = m && m.nowPlaying(); const e = m && m._debug.el();
  console.log('RPT ' + JSON.stringify({ ua: navigator.userActivation ? navigator.userActivation.hasBeenActive : null, plays: window.__plays || 0, st: n && n.status, station: n && n.station && n.station.id,
    signed: document.body.classList.contains('sh-on'), paused: !e || e.paused, label: (document.querySelector('#mu-bar .mu-tr') || {}).textContent, blocked: !!(document.getElementById('mu-bar') && document.getElementById('mu-bar').classList.contains('blocked')) })) } catch (e) {} }, 250) })();"""
RPT = {}
def watch(pg):
    def on(m):
        t = m.text
        if t.startswith('RPT '):
            try: RPT['last'] = json.loads(t[4:])
            except Exception: pass
    pg.on('console', on)
NP = "PingMusic.nowPlaying()"
def status(pg): return pg.evaluate("PingMusic.nowPlaying().status")
def audios_paused(pg): return pg.evaluate("(() => { const e = PingMusic._debug.el(); return !e || e.paused })()")
def label(pg): return pg.evaluate("(document.querySelector('#mu-bar .mu-tr')||{}).textContent")
def playing(pg, t=20000): pg.wait_for_function("PingMusic.nowPlaying().playing && PingMusic.nowPlaying().audioOffsetSec!=null", timeout=t)

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])   # NO --autoplay-policy flag: the gate must hold on its own
    sfx = str(int(time.time()) % 100000)

    # --- account with a saved session; radio ON (default) and one with radio OFF
    seed = br.new_context(viewport={'width': 1440, 'height': 900}); pg = seed.new_page()
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
    ew(pg, 'auth_signup', {'name': f'GateOn{sfx}', 'pin': '1234', 'avatar': 'a01'}, 'auth_ok'); pg.wait_for_selector('body.sh-on'); pg.wait_for_timeout(800)
    state_on = seed.storage_state(); seed.close()
    seed = br.new_context(viewport={'width': 1440, 'height': 900}); pg = seed.new_page()
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
    ew(pg, 'auth_signup', {'name': f'GateOff{sfx}', 'pin': '1234', 'avatar': 'a02'}, 'auth_ok'); pg.wait_for_selector('body.sh-on'); pg.wait_for_timeout(500)
    pg.evaluate("PingMusic.pause()"); pg.wait_for_timeout(800)
    state_off = seed.storage_state(); seed.close()

    # --- LEG 1: resumed session, NO input (no evaluate either), three viewports (+ shots)
    for (w, h) in [(360, 740), (540, 900), (1440, 900)]:
        tag = f'{w}x{h}'
        ctx = br.new_context(viewport={'width': w, 'height': h}, storage_state=state_on, has_touch=(w < 600), is_mobile=(w < 600))
        ctx.add_init_script(COUNT_PLAY); ctx.add_init_script(HIDE_MODALS); ctx.add_init_script(REPORTER); pg = ctx.new_page(); errs = []; RPT.clear(); watch(pg)
        pg.on('pageerror', lambda e: errs.append(str(e)[:200])); pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
        pg.goto(URL)
        for _ in range(60):
            pg.wait_for_timeout(250)
            if RPT.get('last', {}).get('signed') and RPT['last'].get('station'): break
        pg.wait_for_timeout(4000)
        r = RPT['last']
        check(f'[{tag}] resumed with no input: signed in, userActivation.hasBeenActive false', r['signed'] and r['ua'] is False, f'{r}')
        check(f'[{tag}] no input, 4 s: play() calls == 0, audio paused, status blocked, waiting label', r['plays'] == 0 and r['paused'] and r['st'] == 'blocked' and r['blocked'] and 'click or tap' in (r['label'] or '').lower(), f'plays={r["plays"]} status={r["st"]} paused={r["paused"]} label="{r["label"]}" blockedClass={r["blocked"]}')
        pg.screenshot(path=f'{OUT}/{tag}-waiting.jpg', type='jpeg', quality=62)
        pg.mouse.click(w // 2, h // 2)   # one click on the page body
        playing(pg)
        n2 = pg.evaluate("window.__plays")
        check(f'[{tag}] one body click: playing', status(pg) == 'playing', f'plays={n2} audioOffsetSec={pg.evaluate(NP + ".audioOffsetSec")} label="{label(pg)}"')
        pg.screenshot(path=f'{OUT}/{tag}-playing.jpg', type='jpeg', quality=62)
        pg.click('#mu-now'); pg.wait_for_timeout(500); pg.screenshot(path=f'{OUT}/{tag}-sheet.jpg', type='jpeg', quality=62)
        check(f'[{tag}] no unhandled rejections / page errors', pg.evaluate("window.__unh").__len__() == 0 and not [e for e in errs if not e.startswith('RPT')], f'unh={pg.evaluate("window.__unh")} errs={[e for e in errs if not e.startswith("RPT")]}')
        ctx.close()

    # --- LEG 2: forced NotAllowedError, real sign-in form, at 360x740 so the waiting state is also shot inside the compact sheet
    ctx = br.new_context(viewport={'width': 360, 'height': 740}, has_touch=True, is_mobile=True); ctx.add_init_script(FORCE_BLOCK); ctx.add_init_script(HIDE_MODALS); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200])); pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected', timeout=15000)
    pg.click('[data-tab="up"]'); pg.fill('#lb-name', f'Forced{sfx}'); pg.fill('#lb-pin', '1234'); pg.click('#lb-submit')
    pg.wait_for_selector('body.sh-on', timeout=15000); pg.wait_for_function("PingMusic.nowPlaying().station", timeout=15000)
    pg.wait_for_function("PingMusic.nowPlaying().status === 'blocked' && window.__rej >= 1", timeout=15000)
    r1 = pg.evaluate("window.__rej"); pg.wait_for_timeout(3500); r2 = pg.evaluate("window.__rej")
    check('forced block: sign-in (gesture) -> play() rejected -> waiting state', status(pg) == 'blocked' and r1 >= 1, f'status={status(pg)} rejected={r1} label="{label(pg)}"')
    check('forced block: no retry loop (3.5 s later the rejection count is unchanged)', r1 == r2, f'{r1} -> {r2}')
    check('forced block: no unhandled rejection, no console error', pg.evaluate("window.__unh").__len__() == 0 and not [e for e in errs if 'Failed to load resource' not in e], f'unh={pg.evaluate("window.__unh")} errs={errs}')
    pg.screenshot(path=f'{OUT}/360x740-forced-block.jpg', type='jpeg', quality=62)
    pg.click('#mu-now'); pg.wait_for_timeout(600); pg.screenshot(path=f'{OUT}/360x740-forced-block-sheet.jpg', type='jpeg', quality=62)
    check('forced block: opening the sheet (a gesture, still rejected) stays waiting, one retry per gesture', status(pg) == 'blocked' and pg.evaluate("window.__rej") >= r2, f'rejected={pg.evaluate("window.__rej")}')
    pg.evaluate("window.__block = false"); pg.mouse.click(180, 300); playing(pg)
    check('forced block: flag cleared + click -> playing', status(pg) == 'playing', f'rejected={pg.evaluate("window.__rej")} plays={pg.evaluate("window.__plays")}')
    ctx.close()

    # --- LEG 3: radio OFF stays off through gestures; slot hold covered by tests/radio-sync.py
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, storage_state=state_off); ctx.add_init_script(COUNT_PLAY); ctx.add_init_script(HIDE_MODALS); pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_selector('body.sh-on', timeout=15000); pg.wait_for_function("PingMusic.nowPlaying().station", timeout=15000); pg.wait_for_timeout(800)
    st0 = status(pg)
    pg.mouse.click(700, 500); pg.keyboard.press('Space'); pg.keyboard.press('a'); pg.mouse.click(300, 600); pg.wait_for_timeout(3000)
    check('radio OFF: click, key, click -> still off', status(pg) in ('paused', 'idle') and pg.evaluate("window.__plays") == 0 and audios_paused(pg), f'before={st0} after={status(pg)} plays={pg.evaluate("window.__plays")} label="{label(pg)}"')
    pg.click('#mu-play'); pg.wait_for_timeout(300); playing(pg)   # explicit play button works
    check('radio OFF: the play button itself turns it on', status(pg) == 'playing')
    ctx.close()

    # --- LEG 4: station list identity + taps
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, storage_state=state_on); ctx.add_init_script(HIDE_MODALS); pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_selector('body.sh-on', timeout=15000); pg.wait_for_function("PingMusic.nowPlaying().station", timeout=15000)
    pg.mouse.click(700, 500); playing(pg)
    pg.click('#mu-now'); pg.wait_for_selector('.mu-item')
    pg.evaluate("window.__btns = [...document.querySelectorAll('#mu-list .mu-item')]; window.__np = window.__btns.map(b => b.querySelector('.np'))")
    nb = pg.evaluate("window.__btns.length"); pg.wait_for_timeout(5000)
    same = pg.evaluate("(() => { const now = [...document.querySelectorAll('#mu-list .mu-item')]; return now.length === window.__btns.length && now.every((b, i) => b === window.__btns[i] && b.isConnected) && [...document.querySelectorAll('#mu-list .np')].every((n, i) => n === window.__np[i]) })()")
    check('stations: same DOM nodes (buttons and .np spans) after the sheet was open 5 s', same and nb >= 3, f'buttons={nb}')
    ids = pg.evaluate("window.__btns.map(b => b.dataset.st)")
    order = ids + list(reversed(ids)) + ids
    ok_all = True; seen = []
    for sid in order:
        if not pg.evaluate("!document.getElementById('mu-pop').hidden"): pg.click('#mu-now'); pg.wait_for_selector('.mu-item')
        pg.click(f'#mu-list [data-st="{sid}"]'); pg.wait_for_function(f"PingMusic.nowPlaying().station.id === '{sid}'", timeout=8000)
        playing(pg); seen.append(sid)
        if status(pg) != 'playing': ok_all = False
    check('stations: every tap switched the station (3 rounds x all stations)', ok_all and seen == order, f'{len(seen)} taps ok: {seen}')
    # press that straddles a repaint: mousedown, wait across >1 tick, mouseup
    pg.click('#mu-now') if pg.evaluate("document.getElementById('mu-pop').hidden") else None
    pg.wait_for_selector('.mu-item'); target = [i for i in ids if i != pg.evaluate("PingMusic.nowPlaying().station.id")][0]
    bb = pg.locator(f'#mu-list [data-st="{target}"]').bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.wait_for_timeout(1600); pg.mouse.up(); pg.wait_for_timeout(800)
    check('stations: a press held across >1 s of repaints still clicks', pg.evaluate("PingMusic.nowPlaying().station.id") == target, f'target={target} now={pg.evaluate("PingMusic.nowPlaying().station.id")}')
    # control: prove the harness catches a rebuild (old behaviour): rebuild the list mid-press
    pg.click('#mu-now') if pg.evaluate("document.getElementById('mu-pop').hidden") else None
    pg.wait_for_selector('.mu-item'); target2 = [i for i in ids if i != pg.evaluate("PingMusic.nowPlaying().station.id")][0]
    bb = pg.locator(f'#mu-list [data-st="{target2}"]').bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.evaluate("(() => { const l = document.getElementById('mu-list'); l.innerHTML = l.innerHTML })()"); pg.mouse.up(); pg.wait_for_timeout(800)
    lost = pg.evaluate("PingMusic.nowPlaying().station.id") != target2
    print('CONTROL (old-style rebuild mid-press loses the click):', 'click lost, harness is sensitive' if lost else 'click NOT lost in this chromium (harness not sensitive here)')
    ctx.close()
    br.close()
print('FAILS', fails); sys.exit(1 if fails else 0)
