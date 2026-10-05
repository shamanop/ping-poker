import os, sys, time, json
D = os.path.dirname(os.path.abspath(__file__))
os.environ['TMPDIR'] = os.path.join(D, 'tmp')
from playwright.sync_api import sync_playwright
URL = 'http://localhost:3114/'
def launch(p, name='p1', w=1440, h=900):
    ctx = p.chromium.launch_persistent_context(os.path.join(D, 'browser-profile', name), headless=True, viewport={'width': w, 'height': h},
        env={**os.environ, 'TMPDIR': os.path.join(D, 'tmp')}, args=['--no-sandbox'])
    return ctx
def watch(page, sink):
    page.on('dialog', lambda d: (sink['dialogs'].append(d.message), d.dismiss()))
    page.on('pageerror', lambda e: sink['pageerrors'].append(str(e)))
    page.on('console', lambda m: sink['console'].append(m.text) if m.type == 'error' else None)
def newsink(): return {'dialogs': [], 'pageerrors': [], 'console': []}
