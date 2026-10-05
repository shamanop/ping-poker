from br_common import *
import subprocess, urllib.request
ROOT = os.path.abspath(os.path.join(D, '..', '..', '..'))
open(os.path.join(D, 'bank-br3.json'), 'w').write(json.dumps({'broke': 0, 'poor': 15}))
open(os.path.join(D, 'ledger-br3.json'), 'w').write('[]')
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env={**os.environ, 'PORT': '3114', 'BANK_FILE': os.path.join(D, 'bank-br3.json'), 'LEDGER_FILE': os.path.join(D, 'ledger-br3.json')}, stdout=open(os.path.join(D, 'server-br3.log'), 'w'), stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL, timeout=1); break
    except Exception: time.sleep(0.25)
sink = newsink()
try:
  with sync_playwright() as p:
    ctx = launch(p, 'demo'); pg = ctx.new_page(); watch(pg, sink)
    pg.goto(URL)
    # empty name + wrong password via UI
    pg.fill('#password-input', 'nope'); pg.fill('#player-name', 'Zed'); pg.click('#btn-join'); time.sleep(0.6)
    print('UI wrong password ->', repr(pg.evaluate("document.getElementById('landing-error').textContent")), pg.evaluate("document.querySelector('.screen.active').id"))
    pg.fill('#player-name', ''); pg.fill('#password-input', 'ping'); pg.click('#btn-join'); time.sleep(0.6)
    print('UI empty name ->', repr(pg.evaluate("document.getElementById('landing-error').textContent")), pg.evaluate("document.querySelector('.screen.active').id"))
    pg.fill('#player-name', 'broke'); pg.click('#btn-join'); time.sleep(0.8)
    print('UI broke player ->', repr(pg.evaluate("document.getElementById('landing-error').textContent")), pg.evaluate("document.querySelector('.screen.active').id"))
    pg.fill('#player-name', 'poor'); pg.click('#btn-join'); time.sleep(0.8)
    print('UI poor(15) player ->', repr(pg.evaluate("document.getElementById('landing-error').textContent")))
    pg.fill('#player-name', 'x' * 40); print('UI name maxlength ->', len(pg.evaluate("document.getElementById('player-name').value")))
    pg.fill('#player-name', '<b>Mallory</b>'); pg.screenshot(path=os.path.join(D, 'shots', 'landing-htmlname.png'))
    # demo with 1 human
    pg.fill('#player-name', 'Solo'); pg.click('#btn-demo'); pg.wait_for_selector('#game-screen.active', timeout=6000); time.sleep(2.5)
    pg.screenshot(path=os.path.join(D, 'shots', 'demo-start.png'))
    acted = 0; t0 = time.time(); hands = set()
    while time.time() - t0 < 50 and acted < 6:
        hands.add(pg.evaluate("state.gameState.handNum"))
        try:
            if pg.evaluate("!document.querySelector('#btn-check-call').disabled"): pg.click('#btn-check-call', timeout=1000); acted += 1
        except Exception as e: pass
        time.sleep(0.4)
    print('DEMO acted', acted, 'hands seen', sorted(hands), 'players', pg.evaluate("state.gameState.players.map(p => p.name + ':' + p.chips)"))
    pg.screenshot(path=os.path.join(D, 'shots', 'demo-play.png'))
    print('DIALOGS', sink['dialogs'], 'PAGEERRORS', sink['pageerrors'][:5])
    ctx.close()
finally:
    srv.terminate()
