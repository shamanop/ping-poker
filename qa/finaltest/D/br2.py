from br_common import *
import subprocess, signal, urllib.request
ROOT = os.path.abspath(os.path.join(D, '..', '..', '..'))
srv = None
def restart(tag):
    global srv
    if srv: srv.terminate(); srv.wait(5)
    time.sleep(0.5)
    open(os.path.join(D, 'bank.json'), 'w').write('{}'); open(os.path.join(D, 'ledger.json'), 'w').write('[]')
    srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': '3114', 'BANK_FILE': os.path.join(D, 'bank.json'), 'LEDGER_FILE': os.path.join(D, 'ledger.json')}, stdout=open(os.path.join(D, f'server-br2-{tag}.log'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(40):
        try: urllib.request.urlopen(URL, timeout=1); return
        except Exception: time.sleep(0.25)
def bank(): return json.load(open(os.path.join(D, 'bank.json')))
BOTS = r"""
async ([names]) => {
  window.__socks = [];
  for (const n of names) {
    const sock = io({ forceNew: true, transports: ['websocket'] }); window.__socks.push(sock);
    let my = null;
    sock.on('room_joined', d => { my = d.playerIdx; }); sock.on('your_cards', d => { my = d.myIdx; });
    sock.on('game_state', gs => { window.__gs = gs;
      if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
      const toCall = gs.currentBet - gs.players[my].roundBet;
      setTimeout(() => sock.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? 'call' : 'check' }), 600); });
    await new Promise(r => sock.on('connect', r));
    sock.emit('join_game', { name: n, avatar: 'x', password: 'ping' });
    await new Promise(r => setTimeout(r, 300));
  }
}
"""
with sync_playwright() as p:
    ctx = launch(p, 'refresh'); sink = newsink()
    # ---------- R1 refresh mid-hand
    restart('r1')
    hero = ctx.new_page(); watch(hero, sink); helper = ctx.new_page(); helper.goto(URL)
    hero.goto(URL); hero.fill('#player-name', 'Hero'); hero.fill('#password-input', 'ping'); hero.click('#btn-join'); hero.wait_for_selector('#lobby-screen.active')
    helper.evaluate(BOTS, [['Bot1', 'Bot2']]); time.sleep(0.5)
    hero.click('#btn-start'); hero.wait_for_selector('#game-screen.active'); time.sleep(2.5)
    chips_before = hero.evaluate("state.gameState.players[state.myIdx].chips")
    print('R1 before refresh: chips', chips_before, 'bank', bank())
    hero.reload(); time.sleep(1.5)
    hero.screenshot(path=os.path.join(D, 'shots', 'refresh-1-after-reload.png'))
    scr = hero.evaluate("document.querySelector('.screen.active')?.id")
    nm = hero.evaluate("document.getElementById('player-name').value")
    print('R1 after reload: active screen', scr, 'name prefilled', repr(nm), 'bank', bank())
    hero.fill('#password-input', 'ping'); hero.click('#btn-join'); time.sleep(1)
    err = hero.evaluate("document.getElementById('landing-error').textContent")
    print('R1 rejoin error text:', repr(err), '| screen', hero.evaluate("document.querySelector('.screen.active')?.id"))
    hero.screenshot(path=os.path.join(D, 'shots', 'refresh-2-rejoin-error.png'))
    # ---------- R2 transient connection blip while in game (no page reload)
    restart('r2')
    helper.goto(URL); hero.goto(URL); hero.fill('#player-name', 'Hero'); hero.fill('#password-input', 'ping'); hero.click('#btn-join'); hero.wait_for_selector('#lobby-screen.active')
    helper.evaluate(BOTS, [['Bot1', 'Bot2']]); time.sleep(0.5)
    hero.click('#btn-start'); hero.wait_for_selector('#game-screen.active'); time.sleep(2)
    hero.evaluate("state.socket.io.engine.close()")   # simulates wifi blip: transport drops, socket.io auto-reconnects
    time.sleep(4)
    hero.screenshot(path=os.path.join(D, 'shots', 'blip-after-reconnect.png'))
    st = hero.evaluate("({connected: state.socket.connected, id: state.socket.id, screen: document.querySelector('.screen.active')?.id, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent), myTurn: !document.querySelector('#btn-fold').disabled})")
    srv_view = helper.evaluate("window.__gs.players.map(p => [p.name, p.connected, p.folded, p.chips])")
    print('R2 hero after blip:', st); print('R2 server view of table:', srv_view, 'bank', bank())
    # try to act: wait until turn indicator or click fold
    time.sleep(3)
    enabled = hero.evaluate("!document.querySelector('#btn-fold').disabled")
    print('R2 fold button enabled after blip (is UI interactive):', enabled)
    # ---------- R3 two tabs same name + double-click join
    restart('r3')
    t1 = ctx.new_page(); t2 = ctx.new_page(); watch(t1, sink); watch(t2, sink)
    t1.goto(URL); t2.goto(URL)
    for t in (t1, t2):
        t.fill('#player-name', 'Twin'); t.fill('#password-input', 'ping')
    t1.click('#btn-join'); t1.wait_for_selector('#lobby-screen.active')
    t2.click('#btn-join'); t2.wait_for_selector('#lobby-screen.active')
    helper.goto(URL); helper.evaluate(BOTS, [['BotX']]); time.sleep(0.5)
    t1.click('#btn-start'); t1.wait_for_selector('#game-screen.active', timeout=5000); t2.wait_for_selector('#game-screen.active', timeout=5000); time.sleep(2)
    i1 = t1.evaluate("state.myIdx"); i2 = t2.evaluate("state.myIdx")
    n1 = t1.evaluate("state.gameState.players.map(p => p.name)")
    print('R3 two tabs same name: idx', i1, i2, 'players', n1, 'bank', bank(), 'host-start-shown-on-t2', t2.evaluate("!document.getElementById('btn-start').classList.contains('hidden')"))
    t1.screenshot(path=os.path.join(D, 'shots', 'twin-tab1.png')); t2.screenshot(path=os.path.join(D, 'shots', 'twin-tab2.png'))
    # act from each: which tab gets the turn labelled "YOUR TURN"
    time.sleep(6)
    lab1 = t1.evaluate("document.getElementById('action-bar').innerText.slice(0, 40)"); lab2 = t2.evaluate("document.getElementById('action-bar').innerText.slice(0, 40)")
    print('R3 action bar t1:', repr(lab1), 't2:', repr(lab2))
    # double-click join (fresh server)
    restart('r4')
    d = ctx.new_page(); watch(d, sink); d.goto(URL); d.fill('#player-name', 'Dbl'); d.fill('#password-input', 'ping')
    d.dblclick('#btn-join'); time.sleep(1.2)
    seats = d.evaluate("document.querySelectorAll('#lobby-seats .sock.filled, .lobby-seats .sock.filled').length")
    helper.goto(URL)
    print('R4 double-click join: bank', bank(), 'filled seats in lobby DOM', seats)
    d.screenshot(path=os.path.join(D, 'shots', 'dblclick-join-lobby.png'))
    print('DIALOGS', sink['dialogs'], 'PAGEERRORS', sink['pageerrors'][:5])
    ctx.close()
    if srv: srv.terminate()
