"""Port screenshots + layout asserts for the radio in the v2 top bar. One browser at a time.
Usage: PORT=4710 OUT=qa/port-radio python3 qa/music/shots_port.py   (server must already run: see PROGRESS-radio.md)"""
import os, sys, time, json
from playwright.sync_api import sync_playwright
PORT = os.environ.get('PORT', '4710'); URL = f'http://127.0.0.1:{PORT}/'
OUT = os.environ.get('OUT', 'qa/port-radio'); os.makedirs(OUT, exist_ok=True)
VIEWS = [tuple(int(x) for x in v.split('x')) for v in os.environ.get('VIEWS', '360x740,540x900,1440x900,844x390').split(',')]
ONLY = os.environ.get('ONLY')
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
def clear_modal(pg):
    pg.wait_for_timeout(500); pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
LAY = """() => { const q = s => document.querySelector(s); const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)} };
  const vis = e => { if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0 };
  const top = q('.sh-top'); const kids = top ? [...top.children].filter(vis) : [];
  const hit = e => { if (!vis(e)) return 'hidden'; const b = e.getBoundingClientRect(); const x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'offscreen'; const t = document.elementFromPoint(x, y); return t && (e === t || e.contains(t)) ? 'ok' : 'covered:' + (t ? t.tagName + '.' + t.className : 'none') };
  const ids = ['sh-lvl','sh-wallet','sh-bonus','sh-acct','sh-out','mu-play','mu-now','mu-bar'];
  const o = {vw: innerWidth, sw: document.documentElement.scrollWidth, top: r(top), hits: {}, rects: {}};
  for (const i of ids) { const e = document.getElementById(i); o.rects[i] = r(e); o.hits[i] = hit(e) }
  const tm = q('[data-money-toggle]'); o.rects.toggle = r(tm); o.hits.toggle = hit(tm);
  // overlap between visible top-bar children
  o.overlap = []; for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect(); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) o.overlap.push((kids[i].id || kids[i].className) + '|' + (kids[j].id || kids[j].className)) }
  o.outside = kids.filter(k => { const b = k.getBoundingClientRect(); return b.right > innerWidth + 1 || b.left < -1 }).map(k => k.id || k.className);
  return o }"""
res = {}
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    name = 'Shot' + str(int(time.time()) % 100000)
    for (w, h) in VIEWS:
        if ONLY and f'{w}x{h}' != ONLY: continue
        ctx = br.new_context(viewport={'width': w, 'height': h}, has_touch=(w < 600), is_mobile=(w < 600)); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
        ew(pg, 'auth_signup', {'name': f'{name}{w}', 'pin': '1234', 'avatar': 'a01'}, 'auth_ok')
        pg.wait_for_selector('body.sh-on', timeout=10000); clear_modal(pg); pg.wait_for_timeout(800)
        tag = f'{w}x{h}'; res[tag] = {}
        # radio off (pref off first)
        pg.evaluate("PingMusic.pause()"); pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{tag}-lobby-off.jpg', type='jpeg', quality=70); res[tag]['off'] = pg.evaluate(LAY)
        pg.mouse.click(w // 2, h // 2)
        pg.evaluate("PingMusic.play()"); pg.wait_for_function("PingMusic.nowPlaying().playing", timeout=20000); pg.wait_for_timeout(800)
        pg.screenshot(path=f'{OUT}/{tag}-lobby-playing.jpg', type='jpeg', quality=70); res[tag]['playing'] = pg.evaluate(LAY)
        pg.click('#mu-now'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/{tag}-picker.jpg', type='jpeg', quality=70)
        res[tag]['picker'] = pg.evaluate("(()=>{const r=document.getElementById('mu-pop').getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,vw:innerWidth,vh:innerHeight}})()")
        pg.mouse.click(2, 2); pg.wait_for_timeout(300)
        # table
        pg.evaluate("window.PingSocket.emit('table_join', {tableId:'POKERPING', buyIn:2000})"); pg.wait_for_timeout(2500); clear_modal(pg)
        pg.screenshot(path=f'{OUT}/{tag}-table.jpg', type='jpeg', quality=70); res[tag]['table'] = pg.evaluate(LAY)
        # slot window
        pg.evaluate("Shell.openGame('bender', {mode: 'dock', side: 'right'})"); pg.wait_for_timeout(3000)
        pg.screenshot(path=f'{OUT}/{tag}-slot.jpg', type='jpeg', quality=70); res[tag]['slot'] = pg.evaluate(LAY)
        res[tag]['errs'] = errs
        ctx.close()
    br.close()
json.dump(res, open(f'{OUT}/layout.json', 'w'), indent=1)
for tag, d in res.items():
    for k, v in d.items():
        if k in ('picker', 'errs'): print(tag, k, v); continue
        bad = {i: h for i, h in v['hits'].items() if h not in ('ok', 'hidden')}
        print(tag, k, 'sw', v['sw'], 'vw', v['vw'], 'overlap', v['overlap'], 'outside', v['outside'], 'bad', bad)
