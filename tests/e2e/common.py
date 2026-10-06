"""Shared helpers for the client e2e scripts. One headless chromium at a time, small JPEG screenshots only."""
import json, os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_BASE', 'http://127.0.0.1:3580')
SHOTS = os.path.join(os.path.dirname(__file__), '_shots')
os.makedirs(SHOTS, exist_ok=True)

class Frames:
    """Records socket.io frames the page sends: list of (event, payload)."""
    def __init__(self, page):
        self.sent = []
        page.on('websocket', lambda ws: ws.on('framesent', self._on))
    def _on(self, data):
        if isinstance(data, str) and data.startswith('42'):
            try:
                arr = json.loads(data[2:])
                self.sent.append((arr[0], arr[1] if len(arr) > 1 else None))
            except Exception:
                pass
    def of(self, ev):
        return [p for (e, p) in self.sent if e == ev]
    def clear(self):
        self.sent.clear()

def sign_in(page, name='chris', pin='4321'):
    page.goto(BASE + '/')
    page.wait_for_selector('#lb-name', timeout=15000)
    page.fill('#lb-name', name)
    page.fill('#lb-pin', pin)
    page.click('#lb-submit')
    page.wait_for_selector('#lb-join-btn, #lb-create-btn', timeout=15000)
    page.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")

def set_pref(page, pref):
    page.evaluate("p => Money.setPref(p, true)", pref)

def shot(page, name, sel=None):
    p = os.path.join(SHOTS, name + '.jpg')
    (page.locator(sel).first if sel else page).screenshot(path=p, type='jpeg', quality=55)
    return p

class Checks:
    def __init__(self): self.n = 0; self.bad = []
    def eq(self, name, got, want):
        self.n += 1
        if got != want:
            self.bad.append(name); print('FAIL', name, 'got', repr(got), 'want', repr(want))
    def ok(self, name, cond): self.eq(name, bool(cond), True)
    def done(self, label):
        print('%s: %d checks, %d failed' % (label, self.n, len(self.bad)))
        sys.exit(1 if self.bad else 0)
