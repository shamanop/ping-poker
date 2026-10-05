import json, os, time, urllib.request, re
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); URL = 'http://127.0.0.1:3112/'
out = open(D + '/browser.log', 'w')
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); out.write(s + '\n'); out.flush()
def api(): return json.load(urllib.request.urlopen(URL + 'api/bank-summary?password=ping&room=POKERPING'))
errors = []
POL = """() => { let last='';
  state.socket.on('game_state', gs => { const my = state.myIdx; if (gs.status!=='playing' || gs.currentPlayerIdx!==my) return;
    const key = gs.handNum+gs.street+gs.pot+gs.currentBet; if (key===last) return; last=key;
    const me = gs.players[my], tc = gs.currentBet - me.roundBet;
    setTimeout(()=>state.socket.emit('player_action',{roomId:'POKERPING',action: tc>0?'call':'check'}), 2500); }); }"""
DOM = """() => {
  const t = s => (document.querySelector(s)||{}).textContent;
  const players = [...document.querySelectorAll('#bank-players .bp')].map(e => ({ who: e.querySelector('.bp-who').childNodes[0].textContent.trim(), bal: e.querySelector('.bp-bal b').textContent, stats: [...e.querySelectorAll('.bp-stats > div')].map(d => d.querySelector('label').textContent+'='+d.querySelector('b').textContent), sub: e.querySelector('.bp-sub').textContent }));
  const bars = [...document.querySelectorAll('#bank-bars svg text.bar-val')].map(e => e.previousElementSibling && 0 || e.textContent);
  const barNames = [...document.querySelectorAll('#bank-bars svg text.bar-name')].map(e => e.textContent);
  const labs = [...document.querySelectorAll('#bank-line svg text.lab')].map(e => e.textContent);
  const feed = [...document.querySelectorAll('#bank-feed .fe')].map(e => e.innerText.replace(/\\s+/g,' '));
  const hdr = [...document.querySelectorAll('#bank-total .pl')].map(e => e.innerText.replace(/\\s+/g,' '));
  const paths = document.querySelectorAll('#bank-line path.ln').length;
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
  const bar = document.getElementById('action-bar'); const bb = bar.getBoundingClientRect();
  const hit = document.elementFromPoint(bb.left + bb.width/2, bb.top + bb.height/2);
  return { players, bars, barNames, labs, feed, hdr, paths, hcount: t('#bank-hcount'), pcount: t('#bank-pcount'), ecount: t('#bank-ecount'),
    panel: r('#bank-panel'), bar: r('#action-bar'), barHit: !!(hit && hit.closest('#action-bar')), barVisible: getComputedStyle(bar).visibility, vp: [innerWidth, innerHeight],
    panelOpen: document.getElementById('bank-panel').classList.contains('open'), foldBtn: r('#btn-fold'), gameState: { hand: state.gameState.handNum, status: state.gameState.status, pot: state.gameState.pot, players: state.gameState.players.map(p => [p.name, p.chips]) },
    line: r('#bank-line'), barsBox: r('#bank-bars'), feedBox: r('#bank-feed'), playersBox: r('#bank-players') };
}"""
def compare(tag, dom, a):
    fm = lambda n: f"{round(n):,}"
    sg = lambda n: ('+' if n > 0 else '−' if n < 0 else '') + fm(abs(n))
    res = []
    for p in a['players']:
        card = next((c for c in dom['players'] if c['who'] == p['name']), None)
        if not card: res.append(('MISSING card', p['name'])); continue
        exp_bal = '—' if p['isBot'] else fm(p['bank'] or 0)
        st = dict(s.split('=', 1) for s in card['stats'])
        checks = [('bank', card['bal'], exp_bal), ('atTable', st['At table'], fm(p['atTable']))]
        if not p['isBot']:
            checks += [('net', st['Net P&L'], sg(p['net'])), ('buyins', st['Buy-ins'], str(p['buyIns'])), ('best', st['Best win'], fm(p['biggestWin']) if p['biggestWin'] else '–')]
        for k, got, exp in checks: res.append(('ok' if got == exp else 'MISMATCH', p['name'], k, got, exp))
    humans = [p for p in a['players'] if not p['isBot']]
    exp_hdr = [f"Banked {fm(sum(p['bank'] or 0 for p in humans))}", f"On the table {fm(sum(p['atTable'] for p in a['players'] if p['status']!='offline'))}", f"Bought in {fm(sum(p['totalBuyIns'] for p in humans))}", f"Hands {a['maxHand']}"]
    for g, e in zip(dom['hdr'], exp_hdr): res.append(('ok' if g.lower() == e.lower() else 'MISMATCH', 'header', g, e))
    # bars
    bl = sorted([p for p in humans if p['totalBuyIns'] > 0], key=lambda p: -p['totalBuyIns'])[:8]
    exp_bars = [fm(p['totalBuyIns']) for p in bl]
    res.append(('ok' if sorted(dom['bars']) == sorted(exp_bars) else 'MISMATCH', 'bar values', dom['bars'], exp_bars))
    # feed count & amounts
    exp_feed = [(e['name'], fm(e['amount'])) for e in a['events']]
    got_feed = [(re.sub(r'^.*?M\s', '', f).split(' ')[0], re.findall(r'[−+]([\d,]+)$', f)[0]) for f in dom['feed']]
    res.append(('ok' if [x[1] for x in got_feed] == [x[1] for x in exp_feed] and [x[0] for x in got_feed] == [x[0] for x in exp_feed] else 'MISMATCH', 'feed (name,amount) order', got_feed[:6], exp_feed[:6], len(got_feed), len(exp_feed)))
    # chart end labels: last point per series
    short = lambda n: (str(round(n / 100) / 10).rstrip('0').rstrip('.') + 'k') if abs(n) >= 1000 else str(round(n))
    exp_labs = []
    for n, pts in a['series'].items():
        nm = n if len(n) <= 9 else n[:8] + '…'
        exp_labs.append(f"{nm} {short(pts[-1][1])}")
    res.append(('ok' if sorted(dom['labs']) == sorted(exp_labs) else 'MISMATCH', 'line end labels', sorted(dom['labs']), sorted(exp_labs)))
    res.append(('ok' if dom['paths'] == len(a['series']) else 'MISMATCH', 'line paths vs series', dom['paths'], len(a['series'])))
    for r in res: log('  ', *r)
    bad = [r for r in res if r[0] != 'ok']
    log(f'  {tag}: {len(res)-len(bad)}/{len(res)} ok, {len(bad)} bad')
    return bad
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1920, 'height': 1080}); p = ctx.new_page()
    p.on('console', lambda m: errors.append(('console.' + m.type, m.text[:200])) if m.type in ('error', 'warning') else None)
    p.on('pageerror', lambda e: errors.append(('pageerror', str(e)[:300])))
    p.on('requestfailed', lambda r: errors.append(('requestfailed', r.url)))
    p.on('response', lambda r: errors.append(('http' + str(r.status), r.url)) if r.status >= 400 else None)
    p.goto(URL, wait_until='load'); p.wait_for_timeout(800)
    p.fill('#player-name', 'Gus'); p.fill('#password-input', 'ping'); p.click('#btn-join')
    p.wait_for_function("document.getElementById('lobby-screen').classList.contains('active')", timeout=8000)
    p.evaluate("(" + POL + ")()")
    open(D + '/START', 'w').write('1')
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=15000)
    log('game started; playing until hand 7')
    t0 = time.time()
    while time.time() - t0 < 200:
        h = p.evaluate("state.gameState.handNum")
        if h >= 7: break
        p.wait_for_timeout(500)
    # wait for a LIVE hand (status playing)
    for _ in range(400):
        if p.evaluate("state.gameState.status") == 'playing' and p.evaluate("state.gameState.street") in ('flop','turn','river'): break
        p.wait_for_timeout(100)
    p.keyboard.press('b'); p.wait_for_timeout(1000)
    log('--- 1920x1080 LIVE HAND, panel via B key')
    d = p.evaluate(DOM); log(' panelOpen', d['panelOpen'], 'status', d['gameState']['status'], 'hand', d['gameState']['hand'], 'pot', d['gameState']['pot'])
    log(' panel rect', d['panel'], 'bar rect', d['bar'], 'barHit', d['barHit'], 'vp', d['vp'], 'fold btn', d['foldBtn'])
    p.screenshot(path=D + '/s1-1920-live.png')
    # hover tooltip
    lb = d['line']; mx = lb[0] + (lb[2] - lb[0]) * 0.45; my = lb[1] + (lb[3] - lb[1]) * 0.4
    p.mouse.move(mx - 30, my); p.mouse.move(mx, my); p.wait_for_timeout(300)
    tip = p.evaluate("(() => { const t = document.getElementById('bank-tip'); return t ? { shown: getComputedStyle(t).display !== 'none', text: t.innerText.replace(/\\s+/g,' ') } : null; })()")
    log(' tooltip', tip)
    p.screenshot(path=D + '/s2-1920-hover.png')
    p.mouse.move(5, 5)
    # numeric compare at a hand boundary
    for _ in range(300):
        if p.evaluate("state.gameState.status") == 'waiting_next': break
        p.wait_for_timeout(100)
    p.wait_for_timeout(1500)
    d = p.evaluate(DOM); a = api(); log(' compare at hand end (hand', d['gameState']['hand'], d['gameState']['status'], ')'); bad1920 = compare('1920', d, a)
    log(' game chips', d['gameState']['players'], 'hcount', d['hcount'], 'pcount', d['pcount'], 'ecount', d['ecount'])
    # 1440x900
    p.set_viewport_size({'width': 1440, 'height': 900}); p.wait_for_timeout(1500)
    for _ in range(100):
        if p.evaluate("state.gameState.status") == 'playing': break
        p.wait_for_timeout(100)
    log('--- 1440x900 LIVE HAND (panel stays open through resize)')
    d = p.evaluate(DOM); log(' panelOpen', d['panelOpen'], 'status', d['gameState']['status'], 'hand', d['gameState']['hand'], 'pot', d['gameState']['pot'])
    log(' panel rect', d['panel'], 'bar rect', d['bar'], 'barHit', d['barHit'], 'vp', d['vp'], 'fold btn', d['foldBtn'])
    p.screenshot(path=D + '/s3-1440-live.png')
    lb = d['line']; mx = lb[0] + (lb[2] - lb[0]) * 0.5; my = lb[1] + (lb[3] - lb[1]) * 0.4
    p.mouse.move(mx - 20, my); p.mouse.move(mx, my); p.wait_for_timeout(300)
    tip = p.evaluate("(() => { const t = document.getElementById('bank-tip'); return t ? { shown: getComputedStyle(t).display !== 'none', text: t.innerText.replace(/\\s+/g,' ') } : null; })()")
    log(' tooltip', tip)
    p.screenshot(path=D + '/s4-1440-hover.png'); p.mouse.move(5, 5)
    for _ in range(300):
        if p.evaluate("state.gameState.status") == 'waiting_next': break
        p.wait_for_timeout(100)
    p.wait_for_timeout(1500)
    d = p.evaluate(DOM); a = api(); log(' compare at hand end (hand', d['gameState']['hand'], ')'); bad1440 = compare('1440', d, a)
    # live-hand mid-hand comparison: mid-hand net/atTable
    # close with Escape / B
    p.keyboard.press('Escape'); p.wait_for_timeout(500)
    log(' panel closed after Esc:', not p.evaluate("document.getElementById('bank-panel').classList.contains('open')"))
    log('--- console/page errors:', json.dumps(errors, indent=1) if errors else 'NONE')
    b.close()
