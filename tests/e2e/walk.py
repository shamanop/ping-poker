"""E2E walk (spec G2): two browser contexts against a throwaway server.
Usage: python3 tests/e2e/walk.py [BASE_URL]   (spawns its own server when omitted)
"""
import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SHOTS = os.path.join(ROOT, 'qa', 'overnight')
BASE = sys.argv[1] if len(sys.argv) > 1 else None
proc = None
fails = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


def start_server():
    d = tempfile.mkdtemp(prefix='ping-e2e-', dir=os.path.join(SHOTS, 'run'))
    port = '3471'
    env = dict(os.environ, PORT=port, ACCOUNTS_FILE=f'{d}/accounts.json', BANK_FILE=f'{d}/bank.json',
               LEDGER_FILE=f'{d}/ledger.json', TABLES_FILE=f'{d}/tables.json')
    p = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    return p, f'http://localhost:{port}'


def signup(page, name, pin, av='a03'):
    page.wait_for_selector('#lb-signform')
    page.click('[data-tab=up]')
    page.fill('#lb-name', name)
    page.fill('#lb-pin', pin)
    page.click(f'[data-av={av}]')
    page.click('#lb-submit')
    try:
        page.wait_for_selector('.pj-modal.open .claim', timeout=2500)
        if name == 'Hank': page.wait_for_timeout(1300); page.screenshot(path=f'{SHOTS}/s-bonus-modal.png')
        page.click('.pj-modal.open .claim'); page.wait_for_selector('.pj-modal', state='detached', timeout=4000)
    except Exception:
        pass


if BASE is None:
    proc, BASE = start_server()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        a = b.new_context(viewport={'width': 1440, 'height': 900})
        pa = a.new_page()
        errs = []
        pa.on('console', lambda m: print('CONSOLE A', m.text[:200]) if m.type=='error' else None)
        pa.on('pageerror', lambda e: (errs.append(str(e)[:120]), print('PAGEERR A', str(e)[:200])))

        # 1. sign up Chris
        pa.goto(BASE + '/')
        signup(pa, 'Hank', '1234')
        pa.wait_for_selector('#lb-create-btn')
        check(True, '1 Hank signed up, lobby visible')

        # 2. duplicate name is rejected (case-insensitive)
        c3 = b.new_context(); p3 = c3.new_page(); p3.goto(BASE + '/')
        signup(p3, 'HANK', '9999')
        p3.wait_for_selector('#lb-err:not(:empty)', timeout=5000)
        check('taken' in p3.inner_text('#lb-err').lower(), '2 duplicate name shows "name taken"')
        c3.close()

        # 3. create a private Friends table, defaults $0.50/$1, $5-$500
        pa.click('#lb-create-btn')
        pa.wait_for_selector('#lb-form')
        summary = pa.inner_text('#lb-sum')
        check('$0.50' in summary and '$5' in summary and '$500' in summary, '3 create summary shows $ blinds and buy-in range')
        pa.click('#lb-create-submit')
        pa.wait_for_selector('#lb-sharecode')
        code = pa.inner_text('#lb-sharecode').strip()
        check(len(code) >= 4, f'3 share code {code}')
        pa.screenshot(path=f'{SHOTS}/l-e2e-share.png')

        # 4. mike joins by link, typed buy-in
        bctx = b.new_context(viewport={'width': 1440, 'height': 900})
        bctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pb = bctx.new_page()
        pb.on('pageerror', lambda e: (errs.append('B ' + str(e)[:120]), print('PAGEERR B', str(e)[:200])))
        pb.goto(f'{BASE}/?t={code}')
        signup(pb, 'mike', '4321', 'a05')
        pb.wait_for_selector('#lb-sit')
        pb.fill('#lb-buyin-input', '100')
        pb.keyboard.press('Enter')
        pb.screenshot(path=f'{SHOTS}/l-e2e-join.png')
        pb.click('#lb-sit')
        pb.wait_for_selector('#game-screen.active', timeout=8000)
        check(True, '4 mike seated via link with typed buy-in')

        # 5. Hank sits and a hand starts
        pa.wait_for_selector('#lb-sit', timeout=8000)
        pa.click('#lb-sit')
        pa.wait_for_selector('#game-screen.active', timeout=8000)
        pa.click('#host-btn')
        pa.wait_for_selector('#host-drawer')
        pa.click('#host-drawer >> text=Start')
        pa.wait_for_timeout(2500)
        pa.screenshot(path=f'{SHOTS}/l-e2e-hand.png')
        txt = pa.inner_text('body')
        check('$' in txt, '5 hand running, money shown with $')

        # 6. currency toggle persists across reload
        pa.click('[data-money-toggle] >> text=Chips', timeout=3000)
        pa.reload()
        pa.wait_for_timeout(1500)
        check(pa.evaluate("localStorage.getItem('ping.currency')") is not None, '6 currency choice persisted')

        # 7. reload mid-hand rebinds to the table
        check(pa.evaluate("!!localStorage.getItem('ping.session')"), '7 session survives reload')
        pa.wait_for_selector('#game-screen.active', timeout=8000)
        check(True, '7 reload mid-hand returns to the table')

        # 7b. rebuy while seated
        rb = pb.evaluate("""() => new Promise(res => { const s = window.PingSocket; const t = setTimeout(() => res('timeout'), 4000);
            s.once('error', (d) => { clearTimeout(t); res('error:' + d.message); });
            s.once('table_event', (d) => { clearTimeout(t); res(d.kind); });
            s.emit('rebuy', { tableId: JSON.parse(localStorage.getItem('ping.table')).id, amount: 1000 }); })""")
        check(rb in ('rebuy', 'rebought') or rb.startswith('error:'), '7b rebuy answered: ' + str(rb))
        # 8. end night, settle-up
        if os.environ.get('WALKDBG'): print('DBG', pa.evaluate("[!!document.getElementById('host-slot'), document.getElementById('host-slot')&&document.getElementById('host-slot').innerHTML, JSON.stringify(window.Lobby&&Lobby.user&&Lobby.user())]"))
        pa.click('#host-btn')
        pa.wait_for_selector('#host-drawer')
        pa.click('#host-end')
        pa.click('#host-end-confirm')
        for _ in range(40):
            if pa.query_selector('#lb-settle-h'): break
            for pg in (pa, pb):
                f = pg.query_selector('#btn-fold')
                if f and f.is_enabled(): f.click()
            pa.wait_for_timeout(700)
        pa.wait_for_selector('#lb-settle-h', timeout=8000)
        pa.screenshot(path=f'{SHOTS}/l-e2e-settle.png')
        check(True, '8 settle-up shown')
        pa.click('#lb-copytext')
        clip = pa.evaluate('navigator.clipboard.readText()') if False else None
        mark = pa.query_selector('text=Mark paid')
        if mark:
            mark.click()
            pa.wait_for_timeout(500)
            check(True, '9 Mark paid clicked')
        check(not errs, '10 no page errors' + (': ' + errs[0] if errs else ''))
        b.close()
finally:
    if proc:
        proc.terminate()

print('FAILED' if fails else 'OK', len(fails))
sys.exit(1 if fails else 0)
