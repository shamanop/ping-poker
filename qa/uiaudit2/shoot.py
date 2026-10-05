import os, signal, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(os.path.dirname(HERE))
PORT=4350; URL=f'http://localhost:{PORT}/'
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
  (window.__socks = window.__socks || []).push(s);
})"""

srv=subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':str(PORT),'BANK_FILE':HERE+'/bank.json','LEDGER_FILE':HERE+'/ledger.json'},stdout=open(HERE+'/server.log','w'),stderr=subprocess.STDOUT)
for _ in range(40):
    try: urllib.request.urlopen(URL,timeout=1); break
    except Exception: time.sleep(.25)
def info(m): print(m,flush=True)
try:
  with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h in [(1440,900),(1920,1080)]:
        ctx=b.new_context(viewport={'width':w,'height':h}); p=ctx.new_page()
        p.on('console',lambda m: info('console '+m.type+' '+m.text[:120]) if m.type in('error','warning') else None)
        p.on('pageerror',lambda e: info('pageerror '+str(e)[:150]))
        p.goto(URL); p.wait_for_timeout(800)
        p.screenshot(path=f'{HERE}/{w}-1-landing.png')
        p.fill('#player-name','Isabelle'); p.fill('#password-input','ping'); p.click('#btn-join')
        p.wait_for_function("document.getElementById('game-screen').classList.contains('active')",timeout=8000)
        p.wait_for_timeout(800)
        if w==1440: p.screenshot(path=f'{HERE}/{w}-1b-waiting.png')
        for nm in ('Bob','Carla'): p.evaluate(HELPER,[nm,'\U0001f98a'])
        p.wait_for_timeout(500)
        try: p.click('#btn-start',timeout=3000)
        except Exception as e: info('no start btn')
        p.wait_for_timeout(1500)
        if w==1440: p.screenshot(path=f'{HERE}/{w}-2-dealt.png')
        t0=time.time(); n=0
        while time.time()-t0<60:
            g=p.evaluate("()=>{const gs=state.gameState;return{st:gs&&gs.status,cur:gs&&gs.currentPlayerIdx,my:state.myIdx,st2:gs&&gs.street}}")
            if g['st']=='playing' and g['cur']==g['my']:
                p.wait_for_timeout(600); p.screenshot(path=f'{HERE}/{w}-3-myturn.png'); break
            p.wait_for_timeout(250)
        # toast/overlay: click raise preset then raise
        try:
            p.click('#raise-presets .pre:nth-child(3)'); p.wait_for_timeout(300)
            p.screenshot(path=f'{HERE}/{w}-4-raise.png')
            p.click('#btn-raise'); p.wait_for_timeout(500)
            p.screenshot(path=f'{HERE}/{w}-5-toast.png')
        except Exception as e: info('raise fail '+str(e)[:100])
        ctx.close()
    b.close()
finally:
    srv.send_signal(signal.SIGTERM)
