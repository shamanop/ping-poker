#!/usr/bin/env python3
"""FINAL TEST C: visual/FX QA. Server must already be running on :3113. Writes shots+findings under qa/finaltest/C/."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:3113/'
SIZES = [(1440, 900), (1920, 1080)]
OUT = open(os.path.join(ROOT, 'run.log'), 'a')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); OUT.write(s + '\n'); OUT.flush()

OPP = """([name, avatar]) => new Promise(res => {
  const s = io({ forceNew: true }); let my = null, last = '';
  s.on('room_joined', d => { my = d.playerIdx; res(d); });
  s.on('game_state', gs => {
    if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
    const key = gs.handNum + gs.street + gs.pot + gs.currentBet; if (key === last) return; last = key;
    const toCall = gs.currentBet - gs.players[my].roundBet;
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? (window.__fold ? 'fold' : 'call') : 'check' }), 350);
  });
  s.on('connect', () => s.emit('join_game', { name, avatar, password: 'ping' }));
  (window.__socks = window.__socks || []).push(s);
})"""

CHECKS = """() => {
  const vw = innerWidth, vh = innerHeight, out = {};
  const R = el => { const r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)}; };
  const de = document.documentElement;
  out.docScroll = [de.scrollWidth, de.scrollHeight, vw, vh];
  out.bodyScroll = [document.body.scrollWidth, document.body.scrollHeight];
  const bar = document.getElementById('action-bar'); if (bar) { out.bar = R(bar); out.barVisible = bar.getBoundingClientRect().bottom <= vh + 0.5 && bar.getBoundingClientRect().top >= 0; }
  const clipped = [];
  document.querySelectorAll('#player-seats > *').forEach((el, i) => { const r = el.getBoundingClientRect(); if (!r.width) return; if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) clipped.push({i, cls: el.className, ...R(el)}); });
  out.seatsClipped = clipped;
  out.seats = [...document.querySelectorAll('#player-seats > *')].map(el => ({cls: el.className.slice(0,40), ...R(el)}));
  // seats vs action bar / rail / header overlap
  const hdr = document.querySelector('.g-head'); const rail = document.getElementById('rail'); const stage = document.getElementById('stage');
  out.hdr = hdr && R(hdr); out.rail = rail && R(rail); out.stage = stage && R(stage);
  const inter = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const ov = [];
  const seatEls = [...document.querySelectorAll('#player-seats > *')].filter(e => e.getBoundingClientRect().width);
  for (let i = 0; i < seatEls.length; i++) for (let j = i + 1; j < seatEls.length; j++) { const a = R(seatEls[i]), b = R(seatEls[j]); if (inter(a, b)) ov.push(['seat', i, j, a, b]); }
  const named = { pot: '#pot-row', comm: '#community-cards', hero: '#hero-cards-wrap', sd: '#showdown-overlay:not(.hidden)', plaque: '#g-plaque' };
  for (const [k, sel] of Object.entries(named)) { const e = document.querySelector(sel); if (!e) continue; const r = R(e); if (!(r.r - r.l)) continue;
    seatEls.forEach((s, i) => { const sr = R(s); if (inter(r, sr)) ov.push([k, 'seat', i, r, sr]); }); }
  out.overlaps = ov;
  // text overflow detection on key elements
  const tof = [];
  document.querySelectorAll('.g-plaque b, .g-plaque label, .act, .act-main, .act-sub, .rail-tab, .bar-status-text *, .pot-num, .nm, .name, .seat *').forEach(el => { if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflow !== 'visible') tof.push({cls: el.className, tag: el.tagName, sw: el.scrollWidth, cw: el.clientWidth, txt: (el.textContent||'').slice(0,30)}); });
  out.textOverflow = tof;
  return out;
}"""

def run(b, w, h):
    tag = f'{w}x{h}'
    sh = lambda p, n, **k: (p.screenshot(path=f'{ROOT}/{tag}-{n}.png', **k), log('  shot', n))
    ctx = b.new_context(viewport={'width': w, 'height': h}); p = ctx.new_page()
    errs = []
    p.on('console', lambda m: (log('  [console]', m.type, m.text[:200]), errs.append(m.text)) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: log('  [pageerror]', str(e)[:300]))
    p.on('requestfailed', lambda r: log('  [reqfail]', r.url[-80:]))
    p.on('response', lambda r: log('  [http]', r.status, r.url[-80:]) if r.status >= 400 else None)
    p.goto(URL, wait_until='load'); p.wait_for_timeout(1200)
    # ---------- landing
    land = p.evaluate("""() => {
      const q = s => document.querySelector(s);
      const bd = getComputedStyle(q('#landing-screen .scr-backdrop'));
      const ls = getComputedStyle(q('#landing-screen'));
      const av = [...document.querySelectorAll('#avatar-grid .avatar-option')];
      return { artLogin: document.documentElement.classList.contains('art-login'), bdBg: bd.backgroundImage.slice(0,120), bdBgAfter: getComputedStyle(q('#landing-screen .scr-backdrop'), '::before').backgroundImage.slice(0,120), bodyBg: getComputedStyle(document.body).backgroundImage.slice(0,100),
        avatars: av.length, avatarImgs: av.map(a => { const i = a.querySelector('img'); return i ? [i.naturalWidth, i.complete] : null; }),
        avRects: av.slice(0,3).map(a => { const r = a.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
        photoArea: !!q('#photo-upload-area') && q('#photo-upload-area').getBoundingClientRect().width,
        eyebrow: q('.setup-eyebrow').textContent, joinBtn: q('#btn-join').textContent,
        brokenImgs: [...document.images].filter(i => i.complete && !i.naturalWidth && !i.hidden && i.offsetParent).map(i => i.src.slice(-60)),
        fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
    }""")
    log('  LANDING', json.dumps(land))
    log('  CHECK landing', json.dumps(p.evaluate(CHECKS)))
    # click each avatar, ensure selection
    sel = p.evaluate("""() => { const out = []; document.querySelectorAll('#avatar-grid .avatar-option').forEach((a, i) => { a.click(); out.push([i, a.classList.contains('selected'), document.querySelectorAll('#avatar-grid .selected').length]); }); return out; }""")
    log('  AVATAR select', json.dumps(sel))
    p.click('#avatar-grid .avatar-option:nth-child(5)')
    # Photo option -> file chooser with a generated png
    from PIL import Image
    img = os.path.join(ROOT, 'photo.png'); Image.new('RGB', (300, 200), (200, 80, 60)).save(img)
    with p.expect_file_chooser() as fc: p.click('#photo-upload-area')
    fc.value.set_files(img); p.wait_for_timeout(700)
    log('  PHOTO preview', p.evaluate("() => document.getElementById('photo-preview-circle').innerHTML.slice(0,120)"), 'profilePic len', p.evaluate("() => (state.profilePic||'').length"))
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.wait_for_timeout(300)
    sh(p, '01-landing')
    # remove photo path? keep photo for shot, then continue
    p.click('#btn-join'); p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(800)
    log('  CHECK lobby', json.dumps(p.evaluate(CHECKS)))
    sh(p, '02-lobby-solo')
    # opponents in a second context
    ctx2 = b.new_context(viewport={'width': 1280, 'height': 800}); op = ctx2.new_page(); op.goto(URL, wait_until='load'); op.wait_for_timeout(500)
    op.evaluate(OPP, ['Bob', '🦊']); op.evaluate(OPP, ['Carla', '🐙']); p.wait_for_timeout(900)
    log('  lobby count', p.evaluate("() => document.getElementById('lobby-count').textContent"), 'startbtn', p.evaluate("() => !document.getElementById('btn-start').classList.contains('hidden')"))
    sh(p, '03-lobby-3p')
    p.click('#btn-start'); p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(1800)
    log('  CHECK dealt', json.dumps(p.evaluate(CHECKS)))
    sh(p, '04-dealt')
    st = {'seen': set(), 'tabs': False, 'throws': False, 'raise': False, 'hotkey': False, 'mute': False, 'bank': False, 'cards': False}
    t0 = time.time(); hand_done = False; turn_n = 0
    while time.time() - t0 < 150:
        g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, street: gs?.street, sd: !document.getElementById('showdown-overlay').classList.contains('hidden'), ctl: !document.getElementById('btn-check-call').disabled, mode: state.barMode, hand: gs?.handNum } }""")
        if g['sd'] and 'sd' not in st['seen']:
            st['seen'].add('sd')
            p.wait_for_timeout(350); sh(p, '10-showdown-early'); log('  CHECK showdown', json.dumps(p.evaluate(CHECKS)))
            p.wait_for_timeout(700); sh(p, '11-showdown-sunburst')
            fx = p.evaluate("() => [...document.querySelectorAll('img[src*=\"images/fx/\"]')].map(i => [i.src.split('/').pop(), Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().left), Math.round(i.getBoundingClientRect().top)])")
            log('  FX at showdown', json.dumps(fx))
            hand_done = True; break
        if g['ctl'] and g['st'] == 'playing' and g['cur'] == g['my']:
            turn_n += 1
            key = g['street']
            p.wait_for_timeout(500)
            if key not in st['seen']:
                st['seen'].add(key); sh(p, f'05-myturn-{key}'); log(f'  CHECK myturn-{key}', json.dumps(p.evaluate(CHECKS)))
                if key == 'preflop' or True:
                    log('  BAR', json.dumps(p.evaluate("""() => ({ main: document.getElementById('bar-status-main').textContent, sub: document.getElementById('bar-status-sub').textContent, fold: document.getElementById('btn-fold').innerText, call: document.getElementById('btn-check-call').innerText, raise: document.getElementById('btn-raise').innerText, presets: [...document.querySelectorAll('#raise-presets .pre')].map(b => [b.textContent, b.dataset.v, b.disabled]), slider: (s => [s.min, s.max, s.value])(document.getElementById('raise-slider')), input: document.getElementById('raise-input').value, plaque: [...document.querySelectorAll('.g-plaque .pl')].map(e => e.innerText.replace(/\\n/g,' ')), comm: document.querySelectorAll('#community-cards .card').length, hero: document.querySelectorAll('#hole-cards .card').length, label: document.getElementById('my-hand-label').textContent })""")))
            if key == 'preflop' and not st['hotkey']:
                # hotkey test: R focuses raise input, arrows move value, Enter raises
                before = p.evaluate("() => state.raiseVal")
                p.keyboard.press('r'); p.wait_for_timeout(150)
                foc = p.evaluate("() => document.activeElement.id")
                p.keyboard.press('Escape'); p.evaluate("() => document.activeElement.blur()")
                p.keyboard.press('ArrowUp'); p.wait_for_timeout(100); up = p.evaluate("() => state.raiseVal")
                p.keyboard.press('ArrowDown'); p.keyboard.press('ArrowDown'); p.wait_for_timeout(100); dn = p.evaluate("() => state.raiseVal")
                log('  HOTKEY R focus ->', foc, 'raiseVal before/up/down', before, up, dn)
                # preset + slider
                n = p.locator('#raise-presets .pre').count()
                for i in range(n):
                    p.click(f'#raise-presets .pre:nth-child({i+1})'); p.wait_for_timeout(120)
                    log('  PRESET', i, p.evaluate("() => [state.raiseVal, document.getElementById('raise-input').value, document.getElementById('raise-sub').textContent, getComputedStyle(document.getElementById('raise-slider')).getPropertyValue('--fill')]"))
                sh(p, '06-raise-preset-last', clip={'x': 0, 'y': h - 150, 'width': w - 340, 'height': 150})
                # slider drag
                box = p.locator('#raise-slider').bounding_box()
                p.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2); p.wait_for_timeout(150)
                log('  SLIDER mid ->', p.evaluate("() => [state.raiseVal, document.getElementById('raise-input').value, document.getElementById('raise-sub').textContent]"))
                p.click('#raise-presets .pre:nth-child(1)'); p.wait_for_timeout(100)
                p.keyboard.press('c'); st['hotkey'] = True; log('  HOTKEY C pressed'); p.wait_for_timeout(900); continue
            if key == 'flop' and not st['raise']:
                # real raise through hotkeys: R, type, Enter
                p.keyboard.press('r'); p.wait_for_timeout(100)
                p.keyboard.press('ArrowUp'); p.keyboard.press('ArrowUp'); p.wait_for_timeout(100)
                val = p.evaluate("() => [document.getElementById('raise-input').value, state.raiseVal, document.getElementById('raise-sub').textContent, document.activeElement.id]")
                p.keyboard.press('Enter'); st['raise'] = True; log('  RAISE via R+arrows+Enter [inputValue, state.raiseVal, subText, focus]', val); p.wait_for_timeout(900); continue
            if key == 'turn' and not st['tabs']:
                # right rail tabs
                for tb in ('log', 'chat', 'rank', 'stk'):
                    p.click(f'.rail-tab[data-tab="{tb}"]'); p.wait_for_timeout(350)
                    info = p.evaluate("""(tb) => { const pn = document.getElementById('tab-' + tb); const r = pn.getBoundingClientRect(); const rail = document.getElementById('rail').getBoundingClientRect(); return { on: pn.classList.contains('on'), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], rail: [Math.round(rail.left), Math.round(rail.top), Math.round(rail.right), Math.round(rail.bottom)], sw: pn.scrollWidth, cw: pn.clientWidth, txt: pn.innerText.slice(0, 80).replace(/\\n/g, ' | ') }; }""", tb)
                    log('  TAB', tb, json.dumps(info))
                    if tb == 'chat':
                        p.fill('#chat-input', 'gg nice hand'); p.click('#chat-send'); p.wait_for_timeout(300)
                        sh(p, '07-tab-chat', clip={'x': w - 360, 'y': 0, 'width': 360, 'height': h})
                    if tb == 'rank': sh(p, '08-tab-rank', clip={'x': w - 360, 'y': 0, 'width': 360, 'height': h})
                # Bank (B)
                p.click('.rail-tab[data-tab="log"]')
                bb = p.query_selector('#bank-btn'); log('  BANK chip present', bool(bb), bb and json.dumps(bb.bounding_box()))
                st['tabs'] = True
            if key == 'river' and not st['cards']:
                pass
            if key == 'river' and not st['throws']:
                p.click('.rail-tab[data-tab="stk"]'); p.wait_for_timeout(200)
                sh(p, '09-tab-stickers', clip={'x': w - 360, 'y': 0, 'width': 360, 'height': h})
                # sticker emoji
                p.click('#sticker-grid .sticker-item:nth-child(1)'); p.wait_for_timeout(350)
                log('  STICKER floating', p.evaluate("() => [...document.querySelectorAll('body > *')].filter(e => /stick|float/i.test(e.className||'')).map(e => [e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), e.getBoundingClientRect().width|0])"))
                p.wait_for_timeout(1800)
                # throws at each opponent seat
                items = ['💣', '🍅', '💦', '🎉']
                seats = p.evaluate("() => state.gameState.players.map((pl, i) => i)")
                opp = [i for i in seats if i != g['my']]
                for k, item in enumerate(items):
                    tgt = opp[k % len(opp)]
                    p.evaluate("(i) => { const el = document.querySelectorAll('#player-seats > *')[i]; el && el.click(); }", tgt)
                    p.wait_for_timeout(250)
                    tray = p.evaluate("() => { const t = document.querySelector('.throw-tray'); if (!t) return null; const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), innerWidth, innerHeight, t.querySelectorAll('.throw-option img').length]; }")
                    log('  TRAY', item, 'target', tgt, tray)
                    if not tray: log('  !! tray did not open for seat click'); continue
                    if k == 0: sh(p, '12-throw-tray')
                    p.click(f'.throw-option[data-item="{item}"]')
                    p.wait_for_timeout(330); proj = p.evaluate("() => [...document.querySelectorAll('.throw-projectile')].length")
                    if k in (0, 1): sh(p, f'13-throw-{k}-flight')
                    p.wait_for_timeout(560)
                    fxs = p.evaluate("() => [...document.querySelectorAll('body > img[src*=\"images/fx/\"]')].map(i => [i.src.split('/').pop(), Math.round(i.getBoundingClientRect().left), Math.round(i.getBoundingClientRect().top), Math.round(i.getBoundingClientRect().width), i.naturalWidth])")
                    log('  THROW', item, 'projectiles in flight', proj, 'splat imgs', json.dumps(fxs))
                    if k in (0, 1): sh(p, f'14-throw-{k}-splat')
                    p.wait_for_timeout(1700)
                st['throws'] = True
                # mute toggle
                a = p.evaluate("() => [document.getElementById('sound-toggle').classList.contains('muted'), document.querySelector('#sound-toggle use').getAttribute('href'), localStorage.getItem('pp_sound_muted')]")
                p.click('#sound-toggle'); p.wait_for_timeout(150)
                b2 = p.evaluate("() => [document.getElementById('sound-toggle').classList.contains('muted'), document.querySelector('#sound-toggle use').getAttribute('href'), localStorage.getItem('pp_sound_muted')]")
                p.click('#sound-toggle'); p.wait_for_timeout(150)
                c2 = p.evaluate("() => [document.getElementById('sound-toggle').classList.contains('muted'), document.querySelector('#sound-toggle use').getAttribute('href'), localStorage.getItem('pp_sound_muted')]")
                log('  MUTE before/after/after2', a, b2, c2); st['mute'] = True
                p.click('.rail-tab[data-tab="log"]')
                # Bank dashboard
                if p.query_selector('#bank-btn'):
                    p.click('#bank-btn'); p.wait_for_timeout(900)
                    log('  BANK panel', p.evaluate("() => { const e = document.getElementById('bank-panel'); const r = e.getBoundingClientRect(); return [e.className, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), innerWidth, innerHeight, e.scrollHeight, e.clientHeight]; }"))
                    sh(p, '15-bank-panel'); log('  CHECK bank', json.dumps(p.evaluate(CHECKS)['docScroll']))
                    p.keyboard.press('Escape'); p.wait_for_timeout(300)
                    if p.evaluate("() => document.getElementById('bank-panel').classList.contains('open') || document.getElementById('bank-panel').classList.contains('on')"):
                        p.click('#bank-btn'); p.wait_for_timeout(300)
                    log('  BANK closed?', p.evaluate("() => document.getElementById('bank-panel').className"))
                continue
            if key != 'preflop' or st['hotkey']:
                p.click('#btn-check-call')
            p.wait_for_timeout(700)
        else:
            p.wait_for_timeout(250)
    log('  seen', sorted(st['seen']), {k: v for k, v in st.items() if k != 'seen'}, 'hand_done', hand_done)
    # ---------- phase 2: hero wins (opponents fold to any bet) -> sunburst + win float
    if hand_done:
        op.evaluate("() => { window.__fold = true; }")
        t1 = time.time(); won = False
        while time.time() - t1 < 60 and not won:
            g = p.evaluate("""() => { const gs = state.gameState; return { st: gs?.status, cur: gs?.currentPlayerIdx, my: state.myIdx, ctl: !document.getElementById('btn-raise').disabled, sd: !document.getElementById('showdown-overlay').classList.contains('hidden'), win: [...document.querySelectorAll('.showdown-winner-name')].map(e => e.textContent) } }""")
            if g['sd'] and 'Isabelle' in g['win']:
                won = True
                for i, d in enumerate((120, 500, 700)):
                    p.wait_for_timeout(d); sh(p, f'20-herowin-{i}')
                    log('  HEROWIN FX', i, json.dumps(p.evaluate("() => [...document.querySelectorAll('body > img[src*=\"images/fx/\"]')].map(i => [i.src.split('/').pop(), Math.round(i.getBoundingClientRect().left), Math.round(i.getBoundingClientRect().top), Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height), getComputedStyle(i).opacity])")), 'float', p.evaluate("() => [...document.querySelectorAll('[class*=win-float],[class*=winfloat]')].map(e => [e.className, e.textContent.slice(0,20), Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)])"))
                log('  CHECK herowin', json.dumps(p.evaluate(CHECKS)))
                break
            if g['ctl'] and g['st'] == 'playing' and g['cur'] == g['my']:
                p.wait_for_timeout(400); p.click('#btn-raise'); p.wait_for_timeout(600)
            else: p.wait_for_timeout(250)
        log('  hero won phase2', won)
        p.wait_for_timeout(3500)
        op.evaluate("() => { window.__fold = false; }")
    # ---------- court cards + 10 glyph
    cards = p.evaluate("""() => {
      const wrap = document.createElement('div'); wrap.id = '__cardtest'; wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#14231a;display:flex;flex-wrap:wrap;gap:12px;padding:20px;align-content:flex-start;';
      const ranks = ['10','J','Q','K','A','9']; const suits = ['♠','♥','♦','♣'];
      let html = '';
      for (const s of suits) for (const r of ranks) html += faceCardHtml({rank: r, suit: s}, 'lg');
      wrap.innerHTML = html; document.body.appendChild(wrap);
      return [...wrap.querySelectorAll('image')].map(i => { const img = new Image(); return i.getAttribute('href'); }).length;
    }""")
    p.wait_for_timeout(900)
    log('  CARDTEST images', cards, 'broken', p.evaluate("""async () => { const bad = []; for (const i of document.querySelectorAll('#__cardtest image')) { const h = i.getAttribute('href'); const ok = await new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); im.src = h; }); if (!ok) bad.push(h); } return bad; }"""))
    r10 = p.evaluate("() => { const t = document.querySelector('#__cardtest .card svg text'); const r = t.getBoundingClientRect(); const c = t.closest('.card').getBoundingClientRect(); const bb = t.getBBox(); return {txt: t.textContent, rect: [r.left - c.left, r.right - c.left, c.width], bbox: [bb.x, bb.width]}; }")
    log('  10 GLYPH', json.dumps(r10))
    first = p.locator('#__cardtest .card').first.bounding_box()
    sh(p, '16-cards-grid', clip={'x': 0, 'y': 0, 'width': min(w, 700), 'height': 520})
    sh(p, '16b-card-10-zoom', clip={'x': first['x'] - 4, 'y': first['y'] - 4, 'width': first['width'] + 8, 'height': first['height'] + 8})
    p.evaluate("() => document.getElementById('__cardtest').remove()")
    ctx2.close(); ctx.close()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    sizes = [tuple(map(int, a.split('x'))) for a in sys.argv[1:]] or SIZES
    for w, h in sizes:
        log('==', w, h)
        try: run(b, w, h)
        except Exception as e: log('  RUN EXCEPTION', repr(e)[:500])
    b.close()
