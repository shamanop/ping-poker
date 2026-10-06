"""Shared helpers for the P5 sweep. Python Playwright (chromium), JPEG shots only, small copies for reading.
Env: E2E_BASE (default http://127.0.0.1:4700). Shots go to $SWEEP_SHOTS (default runs/shots next to the repo)."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BASE = os.environ.get('E2E_BASE', 'http://127.0.0.1:4700')
SHOTS = os.environ.get('SWEEP_SHOTS', os.path.join(REPO, '..', 'runs', 'shots'))
os.makedirs(SHOTS, exist_ok=True)
VIEWS = {'phone': (390, 844), 'desk': (1440, 900)}

def audit():
    """The server's own numbers (RIG=1 __audit): bank/wallet per key, rooms, seats, drift, ledger check."""
    env = dict(os.environ, E2E_BASE=BASE, NODE_PATH=os.path.join(REPO, 'node_modules'))
    out = subprocess.run(['node', os.path.join(HERE, 'audit.js')], capture_output=True, text=True, env=env, timeout=20).stdout
    return json.loads(out)

def seat_bal(a, key):
    return sum(s['balance'] for s in a.get('seats', []) if s['account'].endswith(':' + key))

class Frames:
    """socket.io frames the page sends and receives: (event, payload)."""
    def __init__(self, page):
        self.sent, self.recv = [], []
        def on_ws(ws):
            ws.on('framesent', lambda d: self._on(self.sent, d))
            ws.on('framereceived', lambda d: self._on(self.recv, d))
        page.on('websocket', on_ws)
    @staticmethod
    def _on(lst, data):
        if isinstance(data, str) and data.startswith('42'):
            try:
                arr = json.loads(data[2:]); lst.append((arr[0], arr[1] if len(arr) > 1 else None))
            except Exception:
                pass
    def sent_of(self, ev): return [p for (e, p) in self.sent if e == ev]
    def recv_of(self, ev): return [p for (e, p) in self.recv if e == ev]
    def last(self, ev):
        r = self.recv_of(ev); return r[-1] if r else None

class Sess:
    """One browser context + page at a named viewport, with console-error capture."""
    def __init__(self, pw, view='desk', name='s'):
        self.name = name
        w, h = VIEWS[view]
        self.browser = pw.chromium.launch(args=['--no-sandbox'])
        self.ctx = self.browser.new_context(viewport={'width': w, 'height': h})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append('pageerror: %s' % e))
        self.page.on('console', lambda m: self.errors.append('console.%s: %s' % (m.type, m.text[:200])) if m.type == 'error' else None)
        self.fr = Frames(self.page)
    def goto(self): self.page.goto(BASE + '/')
    def sign_up(self, name, pin='4321', avatar=None):
        p = self.page; self.goto()
        p.wait_for_selector('#lb-name', timeout=15000)
        p.click('.lb-seg button[data-tab="up"]')
        p.fill('#lb-name', name); p.fill('#lb-pin', pin)
        p.click('#lb-submit')
        p.wait_for_selector('#lb-join-btn, #lb-create-btn, .pj-modal', timeout=15000)
    def sign_in(self, name, pin='4321'):
        p = self.page; self.goto()
        p.wait_for_selector('#lb-name', timeout=15000)
        p.fill('#lb-name', name); p.fill('#lb-pin', pin); p.click('#lb-submit')
        p.wait_for_selector('#lb-join-btn, #lb-create-btn, .pj-modal', timeout=15000)
    def dismiss_modals(self):
        self.page.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
    def shot(self, name, sel=None, small=True):
        """JPEG shot; returns path of a small copy (<=1000px wide) when small."""
        full = os.path.join(SHOTS, name + '.jpg')
        (self.page.locator(sel).first if sel else self.page).screenshot(path=full, type='jpeg', quality=60)
        return small_copy(full) if small else full
    def close(self):
        try: self.browser.close()
        except Exception: pass

def small_copy(path, maxw=1000, quality=55, limit=150 * 1024):
    from PIL import Image
    im = Image.open(path).convert('RGB')
    if im.width > maxw: im = im.resize((maxw, int(im.height * maxw / im.width)))
    out = path.replace('.jpg', '-s.jpg')
    q = quality
    while True:
        im.save(out, 'JPEG', quality=q)
        if os.path.getsize(out) <= limit or q <= 20: break
        q -= 10
    return out

class Checks:
    def __init__(self): self.n = 0; self.bad = []
    def eq(self, name, got, want):
        self.n += 1
        if got != want: self.bad.append(name); print('FAIL', name, 'got', repr(got), 'want', repr(want))
    def ok(self, name, cond, detail=''):
        self.n += 1
        if not cond: self.bad.append(name); print('FAIL', name, detail)
    def done(self, label):
        print('%s: %d checks, %d failed' % (label, self.n, len(self.bad)))
        return 1 if self.bad else 0

class Bots:
    """Python side of botd.js: node socket bots as RPC. b = Bots(); b.bot('swa'); b.req('swa','table_create',{...},'table_created')."""
    def __init__(self):
        env = dict(os.environ, E2E_BASE=BASE, NODE_PATH=os.path.join(REPO, 'node_modules'))
        self.p = subprocess.Popen(['node', os.path.join(HERE, 'botd.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env, bufsize=1)
        self.n = 0
    def call(self, op, timeout=30, **kw):
        self.n += 1; kw.update(id=self.n, op=op)
        self.p.stdin.write(json.dumps(kw) + '\n'); self.p.stdin.flush()
        while True:
            line = self.p.stdout.readline()
            if not line: raise RuntimeError('botd died')
            r = json.loads(line)
            if r['id'] == self.n:
                if not r['ok']: raise RuntimeError('botd %s: %s' % (op, r['result']))
                return r['result']
    def bot(self, name, mode='signup', pin='4321'): return self.call('bot', name=name, mode=mode, pin=pin)
    def emit(self, name, ev, payload=None): return self.call('emit', name=name, ev=ev, payload=payload or {})
    def req(self, name, ev, payload, okEv, ms=6000): return self.call('req', name=name, ev=ev, payload=payload, okEv=okEv, ms=ms)
    def state(self, name): return self.call('state', name=name)
    def gs(self, name): return self.state(name).get('gs')
    def rig(self, name, holes, board): return self.call('rig', name=name, holes=holes, board=board)
    def rig_many(self, name, specs): return self.call('rig', name=name, specs=specs)   # [[holes, board], ...] queued in order
    def policy(self, name, policy): return self.call('policy', name=name, policy=policy)
    def act(self, name, action, amount=None): return self.call('act', name=name, action=action, amount=amount)
    def close(self):
        try: self.call('quit')
        except Exception: pass
        try: self.p.terminate()
        except Exception: pass

def wait_for(fn, timeout=15, step=0.2):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None

def offscreen(page, sel='button, input, a[href], [role=button]'):
    """Visible interactive controls that sit (partly) outside the viewport horizontally or whose centre is off screen: [(desc, left, right)]."""
    return page.evaluate("""(sel) => { const W = innerWidth, H = innerHeight, out = [];
      for (const e of document.querySelectorAll(sel)) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
        if (r.right > W + 1 || r.left < -1) out.push([(e.id || e.className || e.tagName).toString().slice(0, 40) + ':' + (e.innerText || e.value || '').slice(0, 20).replace(/\\n/g, ' '), Math.round(r.left), Math.round(r.right)]); }
      return out; }""", sel)

import re as _re
def nums(t): return [int(x.replace(',', '')) for x in _re.findall(r'[\d,]+\d|\d', t or '')]

class Scene:
    """A table made by a bot host, the hero in a real browser, other seats as bots. Seat order = hero first, then bots in the order given.
    Scene(pw, view='desk', mode='chips'|'play', hero_stack=2000, bots=[('b1', 2000, 'call')], settings={}, rig=(holes, board))"""
    def __init__(self, pw, view='desk', mode='chips', hero_stack=2000, bots=(('b1', 2000, 'call'),), settings=None, rig=None, tag=None, fund=None, hero_fund=None, hero_host=False):
        self.pw, self.view, self.mode = pw, view, mode
        self.tag = tag or ('%d' % (int(time.time()) % 100000))
        self.hero_name = 'h' + self.tag; self.hero_key = self.hero_name.lower()
        self.bots_spec = bots; self.B = Bots()
        self.bn = lambda n: n + self.tag
        host = self.bn(bots[0][0]); self.host = host
        for n, st, pol in bots: self.B.bot(self.bn(n))
        unit_mul = 1 if mode == 'chips' else 1
        base = {'name': 'Sweep', 'mode': mode, 'buyIn': {'min': 100, 'max': 1000000, 'default': 2000}, 'blinds': {'sb': 25, 'bb': 50}, 'autoStart': False, 'actionTimerSec': 0}
        base.update(settings or {})
        self.base_settings = base; self.hero_host = hero_host
        if not hero_host:
            r = self.B.req(host, 'table_create', {'settings': base}, 'table_created')
            if r.get('__err'): raise RuntimeError('create: %s' % r)
            self.tid = r['table']['id']; self.table = r['table']
            if rig: self.B.rig(host, rig[0], rig[1])
        self.rig = rig
        self.s = Sess(pw, view, 'hero'); self.p = self.s.page; self.fr = self.s.fr
        self.hero_stack = hero_stack; self.hero_fund = hero_fund
    def hero_in(self):
        s, p = self.s, self.page if hasattr(self, 'page') else self.p
        s.sign_up(self.hero_name); time.sleep(0.8); s.dismiss_modals()
        p.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', d => { (window.__sd = window.__sd || []).push(d) }); PingSocket.on('bust_out', d => { window.__bust = d })")
    def hero_create(self):
        """Hero hosts: table_create from the signed-in page (the UI create form is covered by s03); queues the rig through a bot."""
        r = self.p.evaluate("(s) => new Promise(res => { PingSocket.once('table_created', d => res(d)); PingSocket.once('error', e => res({err: e})); PingSocket.emit('table_create', {settings: s}); setTimeout(() => res({err: 'timeout'}), 6000) })", self.base_settings)
        if r.get('err') or not r.get('table'): raise RuntimeError('hero create: %s' % r)
        self.tid = r['table']['id']; self.table = r['table']
        if self.rig: self.B.rig(self.host, self.rig[0], self.rig[1])
    def hero_sit_ui(self, amount=None):
        """Join by code through the lobby, buy in through the picker."""
        p = self.p
        if not p.locator('#lb-buyin-input').count():
            p.fill('#lb-code', self.tid); p.click('#lb-join-btn')
        p.wait_for_selector('#lb-buyin-input', timeout=8000)
        amt = amount if amount is not None else self.hero_stack
        p.fill('#lb-buyin-input', ('%.2f' % (amt / 100)) if self.mode == 'play' else str(amt))   # a Play $ table is typed in dollars
        p.click('#lb-sit'); p.wait_for_selector('#player-seats .seat', timeout=15000)
        p.evaluate("PingSocket.on('game_state', gs => { window.__gs = gs }); PingSocket.on('showdown_result', d => { (window.__sd = window.__sd || []).push(d) }); PingSocket.on('bust_out', d => { window.__bust = d })")
    def bots_sit(self, funds=None):
        for n, st, pol in self.bots_spec:
            r = self.B.req(self.bn(n), 'table_join', {'tableId': self.tid, 'buyIn': st}, 'table_joined')
            if r.get('__err'): raise RuntimeError('sit %s: %s' % (n, r))
            self.B.policy(self.bn(n), pol)
    def start(self): self.B.emit(self.host, 'table_start', {'tableId': self.tid})
    def hook(self, page=None):
        """Record every socket event the page receives into window.__ev (more reliable than websocket frame capture)."""
        (page or self.p).evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
    def ev(self, name): return [d for e, d in (self.p.evaluate('window.__ev') or []) if e == name]
    def ev_clear(self): self.p.evaluate('window.__ev = []')
    def gs(self): return self.p.evaluate('window.__gs')
    def my_turn(self): return bool(self.p.evaluate("!!document.getElementById('btn-fold') && !document.getElementById('btn-fold').disabled && !document.getElementById('btn-check-call').disabled"))
    def wait_turn(self, timeout=30): return wait_for(self.my_turn, timeout, 0.15)
    def wait_status(self, st, timeout=30): return wait_for(lambda: (self.gs() or {}).get('status') == st, timeout, 0.2)
    def click(self, sel): self.p.click(sel)
    def seat_dom(self):
        """[{name, chips text}] from the page's seat nodes."""
        return self.p.evaluate("[...document.querySelectorAll('#player-seats .seat')].map(e => ({text: e.innerText.replace(/\\n/g, ' | '), cls: e.className}))")
    def server_stacks(self):
        a = audit(); room = [r for r in a['rooms'] if r['id'] == self.tid]
        return a, ({p['key']: p['chips'] for p in room[0]['players']} if room else {})
    def close(self):
        try: self.s.close()
        except Exception: pass
        self.B.close()

def play_hero(sc, fn, timeout=60):
    """Act for the hero whenever it is on turn: fn(gs) -> 'fold'|'call'|'raise:<n>'|'allin'|None; returns when a showdown_result arrived."""
    t0 = time.time(); n0 = len(sc.p.evaluate('window.__sd || []')); last = None
    while time.time() - t0 < timeout:
        if len(sc.p.evaluate('window.__sd || []')) > n0: return True
        if sc.my_turn():
            gs = sc.gs(); sig = (gs['handNum'], gs['street'], gs['currentBet'], gs['pot'])
            if sig == last: time.sleep(.2); continue
            last = sig; a = fn(gs)
            if a == 'fold': sc.click('#btn-fold')
            elif a == 'call': sc.click('#btn-check-call')
            elif a == 'allin':
                sc.p.click('#raise-box .amt-pre:last-of-type') if False else None
                sc.p.locator('#raise-box button', has_text='ALL-IN').first.click(); time.sleep(.2)
                sc.click('#btn-raise'); time.sleep(.4)
            elif a and a.startswith('raise:'):
                v = int(a.split(':')[1]); sc.p.fill('#raise-input', ('%.2f' % (v / 100)) if sc.mode == 'play' else str(v)); sc.click('#btn-raise')
        time.sleep(.2)
    return False

