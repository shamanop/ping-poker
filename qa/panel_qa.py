import os, sys, signal, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.argv = ['x']; 
src = open(os.path.join(ROOT, 'qa', 'capture.py')).read().split('def run(')[0].replace('PORT = 3211', 'PORT = 3217').replace("'shots2'", "'final'")
exec(src)
start()
try:
  with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx, p = page(b, 1440, 900)
    p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping')
    p.click('#btn-join'); p.wait_for_timeout(1500)
    for nm in ('Bob', 'Carla'): p.evaluate(HELPER, [nm, '🦊'])
    p.wait_for_timeout(500)
    p.wait_for_function("document.getElementById('game-screen').classList.contains('active')", timeout=8000); p.wait_for_timeout(1500)
    rects = """() => { const r = s => { const e = document.querySelector(s); if(!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)] }; return {rail: r('#rail'), bar: r('.g-bar'), stage: r('#stage'), bank: r('#bank-panel'), cls: document.getElementById('game-screen').className} }"""
    print('left', p.evaluate(rects)); p.screenshot(path=f'{ROOT}/qa/final/panel-left.png')
    p.click('#btn-panel-side'); p.wait_for_timeout(400)
    print('right', p.evaluate(rects)); p.screenshot(path=f'{ROOT}/qa/final/panel-right.png')
    p.reload(); p.wait_for_timeout(1000); p.fill('#player-name', 'Isabelle'); p.fill('#password-input', 'ping'); p.click('#btn-join'); p.wait_for_timeout(2500)
    print('reload', p.evaluate(rects), p.evaluate("localStorage.getItem('ping.panelSide')"), p.evaluate("document.getElementById('btn-panel-side').getAttribute('aria-label')"))
    p.click('#bank-btn'); p.wait_for_timeout(600); print('bank-right', p.evaluate(rects)); p.screenshot(path=f'{ROOT}/qa/final/panel-right-bank.png')
    p.click('#btn-panel-side'); p.wait_for_timeout(600); print('bank-left', p.evaluate(rects)); p.screenshot(path=f'{ROOT}/qa/final/panel-left-bank.png')
    b.close()
finally: stop()
