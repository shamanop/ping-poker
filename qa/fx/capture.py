#!/usr/bin/env python3
"""FX visual QA. Local only (PORT 3911, scratch bank). Output: qa/fx/*.png + metrics.json"""
import os, signal, subprocess, sys, time, json, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'qa', 'fx'); os.makedirs(OUT, exist_ok=True)
PORT = 3911; URL = f'http://localhost:{PORT}/'
W, H = 1440, 900
LOG = open(os.path.join(OUT, 'capture.log'), 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); LOG.write(s + '\n'); LOG.flush()
srv = None
def start():
    global srv
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'BANK_FILE': os.path.join(OUT, 'bank-tmp.json')}, stdout=open(os.path.join(OUT, 'server.log'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(40):
        try: urllib.request.urlopen(URL, timeout=1); return
        except Exception: time.sleep(0.25)
    raise RuntimeError('no server')
def stop():
    if srv: srv.send_signal(signal.SIGTERM); srv.wait(5)

HELPER = """([name, avatar]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null, last = '';
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => {
    if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
    const key = gs.handNum + gs.street + gs.pot + gs.currentBet; if (key === last) return; last = key;
    const toCall = gs.currentBet - gs.players[my].roundBet;
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? 'call' : 'check' }), 400);
  });
  s.on('connect', () => s.emit('join_game', { name, avatar, password: 'ping' }));
  (window.__socks = window.__socks || {})[name] = s;
})"""

# On any fx <img> insertion: freeze all animations right away so we can scrub deterministically.
OBSERVER = """() => {
  window.__fxHit = null;
  const mo = new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.tagName === 'IMG' && /images\\/fx\\//.test(n.src) && !window.__fxHit) {
        document.getAnimations().forEach(a => a.pause());
        window.__fxHit = n.src.split('/').pop();
      }
    }
  });
  mo.observe(document.body, { childList: true });
  window.__mo = mo;
}"""
SCRUB = """(t) => {
  const out = [];
  document.getAnimations().forEach(a => {
    const el = a.effect && a.effect.target;
    if (el && el.tagName === 'IMG' && /images\\/fx\\//.test(el.src)) { a.currentTime = t; out.push(el.src.split('/').pop()); }
  });
  return out;
}"""
METRICS = """([idx, t]) => {
  const r = [];
  document.querySelectorAll('img').forEach(el => {
    if (!/images\\/fx\\//.test(el.src)) return;
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    r.push({ fx: el.src.split('/').pop(), t, cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height), z: cs.zIndex, op: +(+cs.opacity).toFixed(2) });
  });
  const seat = document.querySelector(`.seat[data-player-idx="${idx}"]`);
  const sb = seat && seat.getBoundingClientRect();
  const pos = seatClientPos(idx);
  const stage = document.getElementById('stage').getBoundingClientRect();
  const z = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).zIndex : null; };
  return { fx: r, seatRect: sb && [Math.round(sb.left), Math.round(sb.top), Math.round(sb.width), Math.round(sb.height)], seatPos: pos.map(Math.round), stage: [Math.round(stage.left), Math.round(stage.top), Math.round(stage.width), Math.round(stage.height)], game: z('#game-screen'), seatLayer: z('.seat-layer'), u: state.u };
}"""

def main():
    metrics = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(); start()
        try:
            ctx = b.new_context(viewport={'width': W, 'height': H}); p = ctx.new_page()
            p.on('pageerror', lambda e: log('[pageerror]', str(e)[:200]))
            p.on('console', lambda m: log('[console]', m.type, m.text[:140]) if m.type == 'error' else None)
            p.goto(URL, wait_until='load'); p.wait_for_timeout(700)
            p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.click('#btn-join')
            p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
            for nm in ('Bob', 'Carla'): p.evaluate(HELPER, [nm, '🦊'])
            p.wait_for_timeout(500)
            p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000)
            p.wait_for_timeout(1500)
            my = p.evaluate('state.myIdx'); log('myIdx', my)
            ITEMS = [('bomb', '💣'), ('tomato', '🍅'), ('splash', '💦'), ('popper', '🎉')]
            TIMES = [150, 400, 800, 1050]
            for tgt_name, tgt in (('carla', 2), ('bob', 1), ('me', 0)):
                thrower = 'Bob' if tgt != 1 else 'Carla'
                for nm, em in ITEMS:
                    p.evaluate(OBSERVER)
                    p.evaluate("([who, tgt, item]) => window.__socks[who].emit('throw_item', { roomId: 'POKERPING', targetIdx: tgt, item })", [thrower, tgt, em])
                    try: p.wait_for_function('window.__fxHit', timeout=4000, polling=10)
                    except Exception: log('NO FX', nm, tgt_name); continue
                    key = f'{nm}-{tgt_name}'
                    for t in TIMES:
                        names = p.evaluate(SCRUB, t)
                        p.wait_for_timeout(60)
                        p.screenshot(path=f'{OUT}/{key}-{t}.png')
                        if t == 400 or t == 800:
                            metrics.setdefault(key, {})[t] = p.evaluate(METRICS, [tgt, t])
                    p.evaluate("() => { window.__mo.disconnect(); document.getAnimations().forEach(a => a.play()); }")
                    p.wait_for_timeout(2600)
                    p.evaluate("document.querySelectorAll('img').forEach(e => /images\\/fx\\//.test(e.src) && e.remove())")
            json.dump(metrics, open(f'{OUT}/metrics.json', 'w'), indent=1)

            # Win moment: play hands until the viewing player wins at showdown
            p.evaluate(OBSERVER)
            t0 = time.time(); won = False
            while time.time() - t0 < 240:
                st = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, ctl: !document.getElementById('btn-check-call').disabled, hit: window.__fxHit } }""")
                if st['hit']:
                    won = True; break
                if st['ctl'] and st['st'] == 'playing' and st['cur'] == st['my']:
                    p.click('#btn-check-call'); p.wait_for_timeout(500)
                else: p.wait_for_timeout(40)
            log('won', won, round(time.time() - t0))
            if won:
                wm = {}
                for t in (150, 400, 800, 1200, 1800):
                    p.evaluate(SCRUB, t); p.wait_for_timeout(60)
                    p.screenshot(path=f'{OUT}/win-{t}.png')
                    if t in (400, 800): wm[t] = p.evaluate(METRICS, [0, t])
                metrics['win'] = wm
            json.dump(metrics, open(f'{OUT}/metrics.json', 'w'), indent=1)
            ctx.close()
        finally: stop(); b.close()
main()
