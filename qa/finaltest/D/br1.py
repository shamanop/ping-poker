from br_common import *
sink = newsink()
ATT = r"""
async ([specs]) => {
  window.__socks = window.__socks || [];
  for (const s of specs) {
    const sock = io({ forceNew: true, transports: ['websocket'] });
    window.__socks.push(sock);
    let my = null;
    sock.on('room_joined', d => { my = d.playerIdx; });
    sock.on('your_cards', d => { my = d.myIdx; });
    sock.on('game_state', gs => {
      if (gs.status !== 'playing' || my === null || gs.currentPlayerIdx !== my) return;
      const toCall = gs.currentBet - gs.players[my].roundBet;
      setTimeout(() => sock.emit('player_action', { roomId: 'POKERPING', action: toCall > 0 ? 'call' : 'check' }), 500);
    });
    await new Promise(r => sock.on('connect', r));
    sock.emit('join_game', Object.assign({ avatar: 'x', password: 'ping' }, s.join));
    await new Promise(r => setTimeout(r, 400));
    s.chats && s.chats.forEach(t => sock.emit('chat_message', { roomId: 'POKERPING', text: t }));
  }
  return window.__socks.length;
}
"""
with sync_playwright() as p:
    ctx = launch(p, 'xss'); hero = ctx.new_page(); watch(hero, sink)
    helper = ctx.new_page(); watch(helper, sink)
    hero.goto(URL); hero.fill('#player-name', 'Hero'); hero.fill('#password-input', 'ping'); hero.click('#btn-join')
    hero.wait_for_selector('#lobby-screen.active', timeout=5000)
    helper.goto(URL)
    specs = [
      {'join': {'name': '<svg/onload=alert(1)>', 'profilePic': 'data:image/png" onerror="window.__pwn=7" x="'}, 'chats': ['<img src=x onerror=window.__pwn=2>', '<script>window.__pwn=3</script>', '"><svg onload=window.__pwn=4>', '&lt;b&gt;bold&lt;/b&gt; <b>bold</b>']},
      {'join': {'name': '<img src onerror=x=1>'}},
      {'join': {'name': '"><b>BOLD</b>'}},
      {'join': {'name': 'x'*24 + 'OVERFLOW'}},
    ]
    helper.evaluate(ATT, [specs])
    time.sleep(1)
    hero.screenshot(path=os.path.join(D, 'shots', 'xss-lobby.png'))
    hero.click('#btn-start'); hero.wait_for_selector('#game-screen.active', timeout=8000)
    # hero auto-plays check/call
    end = time.time() + 45
    last_hand = 0
    while time.time() < end:
        try:
            if hero.evaluate("!document.querySelector('#btn-check-call').disabled"): hero.click('#btn-check-call', timeout=1000)
        except Exception as e: pass
        time.sleep(0.4)
    hero.screenshot(path=os.path.join(D, 'shots', 'xss-table.png'))
    hero.click('.rail-tab[data-tab="chat"]'); time.sleep(0.5)
    hero.screenshot(path=os.path.join(D, 'shots', 'xss-chat.png'))
    chat_html = hero.evaluate("document.getElementById('chat-messages').innerHTML")
    hero.click('.rail-tab[data-tab="log"]'); time.sleep(0.3)
    hero.screenshot(path=os.path.join(D, 'shots', 'xss-log.png'))
    log_html = hero.evaluate("document.getElementById('log-entries').innerHTML")
    seats_html = hero.evaluate("document.body.innerHTML")
    inj = hero.evaluate("""() => ({ pwn: window.__pwn, svgOnload: document.querySelectorAll('svg[onload]').length, imgOnerrorUser: [...document.querySelectorAll('img[onerror]')].filter(i => !i.classList.contains('art-img')).length, scripts: document.querySelectorAll('script').length, boldInChat: document.querySelectorAll('#chat-messages b').length, boldInSeats: document.querySelectorAll('.seat b, .seat-name b').length })""")
    helperpwn = helper.evaluate("window.__pwn")
    print('INJ', json.dumps(inj), 'helperpwn', helperpwn)
    print('DIALOGS', sink['dialogs']); print('PAGEERRORS', sink['pageerrors'][:5]); print('CONSOLE', sink['console'][:8])
    print('chat has escaped:', '&lt;img' in chat_html, '| log has raw <svg:', '<svg/onload' in log_html, '| log escaped', '&lt;svg' in log_html)
    # does profilePic attribute injection exist in DOM?
    pic = hero.evaluate("""() => [...document.querySelectorAll('img')].filter(i => i.hasAttribute('onerror') && !i.classList.contains('art-img')).map(i => i.outerHTML.slice(0, 160))""")
    print('PIC-INJ imgs with onerror', pic)
    ctx.close()
