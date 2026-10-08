"""(r2) critic r1 #10: radio control vs every dock button and top-bar control, 7 sizes, lobby and seated.
Usage: PORT=4710 python3 qa/port-radio/r2/layout.py   (dev server must run; see PROGRESS-radio.md)"""
import os, sys, time, json
from playwright.sync_api import sync_playwright
PORT = os.environ.get('PORT', '4710'); URL = f'http://127.0.0.1:{PORT}/'
SIZES = [(360,740),(375,812),(390,844),(412,915),(540,900),(844,390),(1440,900)]
def ew(pg, ev, payload, ok):
    return pg.evaluate("""([ev,p,ok]) => new Promise((res,rej)=>{const s=window.PingSocket;const t=setTimeout(()=>rej('timeout'),8000);const f=v=>{clearTimeout(t);s.off(ok,f);res(v)};s.on(ok,f);s.emit(ev,p)})""", [ev, payload, ok])
MEASURE = """() => {
  const vis = e => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 };
  const R = e => { const b = e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom} };
  const radio = document.getElementById('mu-bar');
  const out = {vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, radio: null, hits: [], offscreen: [], ctrls: 0};
  if (!radio || !vis(radio)) { out.radio = 'hidden'; return out }
  const rr = R(radio); out.radio = {l:Math.round(rr.l*10)/10,t:Math.round(rr.t*10)/10,r:Math.round(rr.r*10)/10,b:Math.round(rr.b*10)/10};
  out.offscreen = (rr.l < 0 || rr.t < 0 || rr.r > innerWidth + .5 || rr.b > innerHeight + .5) ? ['radio'] : [];
  const sel = '.sh-dock *, .sh-top *, .sh-dock, .sh-top';
  const seen = new Set();
  for (const e of document.querySelectorAll(sel)) {
    if (radio.contains(e) || e.contains(radio) || !vis(e)) continue;
    const isCtl = e.matches('button, a, input, select, [role=button], [role=tab], .sh-di, .sh-top > *, .money-toggle');
    if (!isCtl) continue;
    out.ctrls++;
    const b = R(e); const w = Math.min(b.r, rr.r) - Math.max(b.l, rr.l), h = Math.min(b.b, rr.b) - Math.max(b.t, rr.t);
    if (w > 0.01 && h > 0.01) out.hits.push({el: (e.id || e.className || e.tagName).toString().slice(0,40), w: Math.round(w*10)/10, h: Math.round(h*10)/10, rect: [b.l,b.t,b.r,b.b].map(x=>Math.round(x*10)/10)});
    if (b.r > innerWidth + .5 || b.l < -.5 || b.b > innerHeight + .5) out.offscreen.push((e.id || e.className || e.tagName).toString().slice(0,40));
  }
  return out }"""
res = {}
bad = 0
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    name = 'Lay' + str(int(time.time()) % 100000)
    for (w, h) in SIZES:
        ctx = br.new_context(viewport={'width': w, 'height': h}, has_touch=(w < 600), is_mobile=(w < 600)); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto(URL); pg.wait_for_function('window.PingSocket && window.PingSocket.connected && window.Shell', timeout=15000)
        ew(pg, 'auth_signup', {'name': f'{name}{w}x{h}', 'pin': '1234', 'avatar': 'a01'}, 'auth_ok')
        pg.wait_for_selector('body.sh-on', timeout=10000); pg.wait_for_timeout(900)
        pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
        tag = f'{w}x{h}'; res[tag] = {}
        res[tag]['lobby'] = pg.evaluate(MEASURE)
        pg.evaluate("window.PingSocket.emit('table_join', {tableId:'POKERPING', buyIn:2000})"); pg.wait_for_timeout(2500)
        pg.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
        res[tag]['seated'] = pg.evaluate(MEASURE)
        res[tag]['errs'] = errs
        ctx.close()
    br.close()
for tag, d in res.items():
    for k in ('lobby', 'seated'):
        v = d[k]
        inter = v['hits']; off = v['offscreen']; hs = v['sw'] > v['vw']
        if inter or off or hs or v['radio'] == 'hidden': bad += 1
        print(f"{tag:8} {k:7} radio={v['radio']} ctrls_checked={v['ctrls']} intersections={len(inter)} {inter} offscreen={off} hscroll={hs}(sw {v['sw']} vw {v['vw']})")
    if d['errs']: print(tag, 'pageerrors', d['errs'])
json.dump(res, open(os.path.join(os.path.dirname(__file__), 'layout.json'), 'w'), indent=1)
print('BAD CASES', bad); sys.exit(1 if bad else 0)
