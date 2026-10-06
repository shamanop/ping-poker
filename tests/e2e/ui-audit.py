"""Step D proof: DOM audit of the ui/REPORT fixes against a throwaway server (legacy or v2).
Needs: accounts chris + ua1 (claim.js), a bot at POKERPING (this script starts it). Prints one line per check."""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = os.path.dirname(os.path.abspath(__file__))
bot = subprocess.Popen(['node', os.path.join(HERE, 'bot.js'), 'ua1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
c = Checks()
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); fr = Frames(pg)
    sign_in(pg, 'chris')
    set_pref(pg, 'chips')
    pg.locator('button', has_text='JOIN').first.click(); pg.wait_for_selector('#lb-buyin-input', timeout=8000)
    pg.fill('#lb-buyin-input', '2000'); pg.click('#lb-sit'); pg.wait_for_selector('#player-seats .seat', timeout=15000)
    pg.wait_for_timeout(1500)

    cs = lambda sel, prop: pg.evaluate("([s,p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null }", [sel, prop])
    # --- defect 5: selection / drag / context menu
    c.eq('body user-select', cs('body', 'userSelect'), 'none')
    for sel in ['#chat-input', '#chat-messages', '#raise-input', '#room-code']:
        c.eq('allowlist %s user-select' % sel, cs(sel, 'userSelect'), 'text')
    for sel in ['.seat-pill', '#btn-fold', '.table-mark', '#pot-row']:
        c.eq('not selectable %s' % sel, cs(sel, 'userSelect'), 'none')
    c.ok('body -webkit-touch-callout:none is in the stylesheet (chromium does not expose it as computed)', pg.evaluate("fetch('/style.css').then(r => r.text()).then(t => /body\\s*\\{[^}]*-webkit-touch-callout:\\s*none/.test(t))"))
    c.eq('img with draggable != false', pg.evaluate("[...document.images].filter(i => i.draggable !== false).length"), 0)
    c.ok('img count > 0 (the test looks at something)', pg.evaluate("document.images.length") > 0)
    # an image injected later is caught too
    c.eq('late img is made undraggable', pg.evaluate("(() => { const i = document.createElement('img'); document.body.append(i); return new Promise(r => setTimeout(() => r(i.draggable), 50)) })()"), False)
    cm = lambda sel: pg.evaluate("s => { const e = document.querySelector(s); if (!e) return 'missing'; const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true}); e.dispatchEvent(ev); return ev.defaultPrevented }", sel)
    for sel in ['#player-seats .seat', '#table-box', '#table-mark', '.g-brand', '.g-brand img']:
        c.eq('contextmenu prevented on %s' % sel, cm(sel), True)
    c.eq('contextmenu prevented on a card', cm('.card'), True) if pg.evaluate("!!document.querySelector('.card')") else None
    for sel in ['#chat-input', '#room-code-btn', '#raise-input']:
        c.eq('contextmenu native on %s' % sel, cm(sel), False)

    # --- defect 6, 7: three Pause controls renamed / placed, disabled look
    c.eq('#btn-sit-out label', pg.inner_text('#btn-sit-out').strip().lower(), 'sit out')
    c.eq('#pause-btn removed from the header', pg.evaluate("!!document.getElementById('pause-btn')"), False)
    c.ok('header has no second "Pause" label', pg.evaluate("![...document.querySelectorAll('.g-head button')].some(b => /^pause$/i.test(b.textContent.trim()))"))
    c.ok('.plate-btn:disabled looks disabled', pg.evaluate("(() => { const b = document.getElementById('btn-sit-out'); const was = b.disabled; b.disabled = true; const o = parseFloat(getComputedStyle(b).opacity), cur = getComputedStyle(b).cursor; b.disabled = was; return o < 1 && cur === 'not-allowed' })()"))
    # --- defect 8, 13: chat rail and hit targets
    pg.fill('#chat-input', 'hello audit'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    c.ok('chat rail >= 200px wide', pg.evaluate("document.getElementById('rail').getBoundingClientRect().width >= 199"))
    c.ok('chat font >= 12px', pg.evaluate("(() => { const e = document.querySelector('.chat-text') || document.querySelector('.chat-msg'); return !e || parseFloat(getComputedStyle(e).fontSize) >= 12 })()"))
    hit = """sel => { const e = document.querySelector(sel); if (!e) return 'missing'; const r = e.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const ok = y => { const t = document.elementFromPoint(cx, y); return !!t && (t === e || e.contains(t)) };
      return (r.width >= 31.5 || r.height >= 31.5) && ok(cy - 15) && ok(cy + 15) && (r.width >= 31.5 || (ok(cy) && document.elementFromPoint(cx - 15, cy) != null)) }"""
    for sel in ['#raise-minus', '#raise-plus', '#chat-send', '#btn-panel-side', '.money-toggle', '#sh-acct']:
        v = pg.evaluate(hit, sel)
        c.ok('hit target >= 32px vertical %s' % sel, v is True or v == 'missing')
    # --- defect 15: a toast does not sit on a seat
    pg.evaluate("(() => { const d = document.createElement('div'); d.className = 'toast'; d.id = '__t'; d.innerHTML = '<b>Test</b><span>message</span>'; document.getElementById('toasts').append(d); d.style.animation = 'none' })()")
    pg.wait_for_timeout(200)
    c.ok('toast does not intersect any seat', pg.evaluate("(() => { const t = document.getElementById('__t').getBoundingClientRect(); return ![...document.querySelectorAll('#player-seats .seat')].some(s => { const r = s.getBoundingClientRect(); return !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom) }) })()"))
    pg.evaluate("document.getElementById('__t').remove()")

    # --- defect 9: the pot text is not under a bet stack
    c.ok('pot text not covered by a bet', pg.evaluate("(() => { const n = document.querySelector('.pot-num'); if (!n) return true; const r = n.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && (t === n || n.contains(t) || !!t.closest('.pot-row')) })()"))
    # --- defect 9: a long showdown label stays inside the stage
    pg.evaluate("PingSocket.listeners('showdown_result').forEach(f => f({winners: [{name: 'ua1', handName: 'Two Pair, Kings and Fives with a very long kicker description', cards: ['Kh', '5d'], amount: 100, net: 50}], pot: 100, reveals: []}))")
    pg.wait_for_timeout(300)
    c.ok('showdown plaque inside the stage rect', pg.evaluate("(() => { const o = document.getElementById('showdown-overlay'); if (o.classList.contains('hidden')) return 'hidden'; const r = o.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return r.left >= s.left - 0.5 && r.right <= s.right + 0.5 })()") is True)
    pg.evaluate("document.getElementById('showdown-overlay').classList.add('hidden')")
    # --- step E: legacy landing/start controls are gone, start is table_start
    c.eq('legacy elements removed', pg.evaluate("['player-name','password-input','btn-join','btn-demo','bank-display','blind-seg','blind-settings','pause-btn','reset-btn'].filter(i => document.getElementById(i))"), [])
    fr.clear(); pg.evaluate("document.getElementById('btn-start').click()"); pg.wait_for_timeout(300)
    c.eq('Start button sends table_start with the room id', [list(f.keys()) for f in fr.of('table_start')], [['tableId']])
    c.eq('no legacy start event', fr.of('start_game'), [])
    # --- defect 4: hotkeys while an overlay is open
    pg.wait_for_function("!document.getElementById('btn-fold').disabled", timeout=90000)
    pg.click('#bank-btn'); pg.wait_for_selector('#bank-panel.open')
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    fr.clear()
    for k in ['f', 'c', 'Enter', '3', 'ArrowUp']:
        pg.keyboard.press(k)
    pg.wait_for_timeout(500)
    c.eq('no player_action/emote with the bank panel open', [e for (e, _) in fr.sent if e in ('player_action', 'emote')], [])
    c.ok('overlay guard says open', pg.evaluate("PingUI.isOverlayOpen()"))
    pg.click('#bank-close'); pg.wait_for_function("!PingUI.isOverlayOpen()")
    c.eq('overlay guard says closed after close', pg.evaluate("PingUI.isOverlayOpen()"), False)
    fr.clear(); pg.keyboard.press('3'); pg.wait_for_timeout(400)
    c.eq('emote key works with no overlay (control)', len(fr.of('emote')), 1)

    # --- defect 12: seat nodes are patched, keyed, keyboard reachable
    pg.evaluate("[...document.querySelectorAll('#player-seats .seat')].forEach((e, i) => { e.__t = 't' + i })")
    pg.focus('#player-seats .seat:not(.hero)')
    # the hero folds, the bot and the next deal produce more game_state events
    pg.keyboard.press('Escape')
    pg.click('#btn-fold', force=True) if pg.evaluate("!document.getElementById('btn-fold').disabled") else None
    pg.wait_for_timeout(2500)
    same = pg.evaluate("[...document.querySelectorAll('#player-seats .seat')].map(e => e.__t || null)")
    c.ok('every seat node survived the state updates (same identity)', same and all(t is not None for t in same))
    c.ok('seats have tabindex=0 role=button aria-label', pg.evaluate("[...document.querySelectorAll('#player-seats .seat')].every(e => e.tabIndex === 0 && e.getAttribute('role') === 'button' && (e.getAttribute('aria-label') || '').length > 3)"))
    c.ok('seat-name has a title', pg.evaluate("[...document.querySelectorAll('.seat-name')].every(e => e.title === e.textContent)"))
    b.close()
finally:
    bot.terminate()
c.done('ui-audit.py')
