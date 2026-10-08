#!/usr/bin/env python3
"""Lead check for critic r1 #11: the sign-in submit while it waits for a reply (locked, dimmed) and after the socket drops (released).
Usage: python3 qa/port-lead/login-lock.py <port> [WxH ...]   (any dev server). The auth_login frame is swallowed in the page so no reply ever comes."""
import json, os, sys
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); SIZES = [tuple(map(int, a.split('x'))) for a in sys.argv[2:]] or [(360, 740), (1440, 900)]
OUT = os.path.dirname(os.path.abspath(__file__)); bad = []
STATE = """() => { const b = document.getElementById('lb-submit'); const c = getComputedStyle(b);
  return { disabled: b.disabled, on: b.classList.contains('on'), opacity: c.opacity, filter: c.filter, cursor: c.cursor, text: b.textContent.trim() }; }"""
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for w, h in SIZES:
        p = b.new_context(viewport={'width': w, 'height': h}).new_page(); p.on('pageerror', lambda e: bad.append('pageerror ' + str(e)[:200]))
        p.goto(f'http://127.0.0.1:{PORT}/'); p.wait_for_selector('#lb-submit'); p.wait_for_function('window.PingSocket && window.PingSocket.connected')
        idle = p.evaluate(STATE)
        p.evaluate("() => { const s = window.PingSocket, e = s.emit.bind(s); s.emit = (ev, ...a) => ev === 'auth_login' ? s : e(ev, ...a); }")
        p.fill('#lb-name', 'Locktest'); p.fill('#lb-pin', '1234'); p.click('#lb-submit'); p.wait_for_timeout(600)
        locked = p.evaluate(STATE); p.screenshot(path=f'{OUT}/login-lock-{w}-1-locked.jpg', type='jpeg', quality=60)
        p.evaluate("() => window.PingSocket.io.engine.close()"); p.wait_for_timeout(900)
        freed = p.evaluate(STATE); p.screenshot(path=f'{OUT}/login-lock-{w}-2-released.jpg', type='jpeg', quality=60)
        print(w, 'idle', json.dumps(idle)); print(w, 'locked', json.dumps(locked)); print(w, 'released', json.dumps(freed))
        if not (locked['disabled'] and locked['on']): bad.append(f'{w} submit not locked after the click')
        if locked['opacity'] == idle['opacity'] and locked['filter'] == idle['filter']: bad.append(f'{w} locked submit looks the same as idle')
        if freed['disabled'] or freed['on']: bad.append(f'{w} submit still locked after the socket dropped')
    b.close()
print('PROBLEMS', len(bad), bad); sys.exit(1 if bad else 0)
