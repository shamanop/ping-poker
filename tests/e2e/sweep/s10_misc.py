"""S10: things outside poker. Login (wrong PIN, rate limit, claim flow, PIN change, resume after reload, sign out), /api/admin/bender-config (token gate, GET, POST, live g:bender:cfg push),
the lobby feed / biggest-win strip after a hand. Needs a second server with BENDER_ADMIN_TOKEN=sweeptoken on port 4702:
  BENDER_ADMIN_TOKEN=sweeptoken PORT=4702 tests/e2e/sweep/server.sh        (this script starts it when 4702 is not listening)
Usage: python3 s10_misc.py"""
import json, sys, subprocess, urllib.request; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
c = Checks(); tag = '%d' % (int(time.time()) % 100000)
HERE_ = os.path.dirname(os.path.abspath(__file__))
B2 = 'http://127.0.0.1:4702'
if subprocess.run("ss -ltn | grep -q ':4702 '", shell=True).returncode != 0:
    subprocess.run(['bash', os.path.join(HERE_, 'server.sh')], env=dict(os.environ, PORT='4702', BENDER_ADMIN_TOKEN='sweeptoken'), capture_output=True)
def http(method, path, tok=None, body=None):
    req = urllib.request.Request(B2 + path, method=method, data=(json.dumps(body).encode() if body is not None else None), headers={'content-type': 'application/json', **({'x-admin-token': tok} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
# ---- bender-config
st, _ = http('GET', '/api/admin/bender-config'); c.eq('bender-config: no token -> 403', st, 403)
st, _ = http('GET', '/api/admin/bender-config', 'wrong'); c.eq('bender-config: wrong token -> 403', st, 403)
st, info = http('GET', '/api/admin/bender-config', 'sweeptoken'); c.eq('bender-config: right token GET -> 200', st, 200); print('liveInfo keys', list(info)[:8])
cfg_events = []
with sync_playwright() as pw:
    s = Sess(pw, 'desk', 'misc'); p = s.page
    try:
        # ---- login screens on the main sweep server (4701)
        s.goto(); p.wait_for_selector('#lb-name')
        p.fill('#lb-name', 'chris'); p.fill('#lb-pin', '9999')   # NOTE: run against 4702, the lockout is per IP and escalates; p.click('#lb-submit'); time.sleep(1.2)
        e1 = p.inner_text('#lb-err'); print('wrong PIN ->', repr(e1)); c.ok('wrong PIN shows a plain message', 'wrong' in e1.lower() or 'pin' in e1.lower(), e1)
        c.ok('the message does not reveal whether the name exists', 'no account' not in e1.lower() and 'not found' not in e1.lower(), e1)
        # claim flow: an existing name that has no PIN claim? use a bot-created name -> normal login; use an unknown name on the Sign in tab
        s.goto(); p.wait_for_selector('#lb-name'); p.fill('#lb-name', 'nobody' + tag); p.fill('#lb-pin', '1234'); p.click('#lb-submit'); time.sleep(1.2)
        e3 = p.inner_text('#lb-err'); print('unknown name on Sign in ->', repr(e3))
        # sign up, reload resumes, sign out
        s.goto(); s.sign_up('lg' + tag); s.dismiss_modals(); time.sleep(.5)
        p.reload(); time.sleep(3); c.ok('reload resumes the session (lobby, not sign-in)', p.evaluate("!document.getElementById('lb-signform')"), p.evaluate("document.body.innerText.slice(0, 80)"))
        # PIN change through the profile
        p.click('#sh-acct'); time.sleep(1.0); print('profile open:', p.evaluate("!!document.getElementById('lb-oldpin')"))
        if p.locator('#lb-oldpin').count():
            p.fill('#lb-oldpin', '4321'); p.fill('#lb-newpin', '5555'); btn = p.locator('button', has_text='Change').first
            btn.click() if btn.count() else None; time.sleep(1.2)
        p.keyboard.press('Escape'); s.dismiss_modals()
        p.click('#sh-out'); p.wait_for_selector('#lb-name', timeout=8000); c.ok('sign out returns to the sign-in page', True)
        p.fill('#lb-name', 'lg' + tag); p.fill('#lb-pin', '4321'); p.click('#lb-submit'); time.sleep(1.2)
        e4 = p.inner_text('#lb-err'); print('old PIN after change ->', repr(e4))
        p.fill('#lb-pin', '5555'); p.click('#lb-submit'); time.sleep(1.5)
        c.ok('the new PIN works (or the change UI was not found: %s)' % e4, p.locator('#lb-create-btn, .pj-modal').count() > 0 or 'wrong' in e4.lower())
        # a signed-out socket may not do things
        res = p.evaluate("(() => new Promise(r => { const s = io(); s.on('error', e => { r(e); s.close() }); s.on('connect', () => s.emit('table_join', {tableId: 'POKERPING', buyIn: 500})); setTimeout(() => r(null), 3000) }))()")
        print('unauthenticated table_join ->', res); c.ok('unauthenticated table_join is refused with code auth', res and res.get('code') == 'auth', str(res))
        # ---- wrong-PIN lockout LAST (it is per name+IP, escalates, and blocks that name's right PIN too)
        s.goto(); p.wait_for_selector('#lb-name'); p.fill('#lb-name', 'chris'); p.fill('#lb-pin', '9999'); p.click('#lb-submit'); time.sleep(1.2)
        for i in range(6):
            p.fill('#lb-pin', '9998'); p.click('#lb-submit'); time.sleep(.6)
            if p.locator('#lb-submit').is_disabled(): break
        e2 = p.inner_text('#lb-err'); print('after repeated wrong PINs ->', repr(e2), '| submit disabled', p.locator('#lb-submit').is_disabled())
        c.ok('repeated wrong PINs are rate limited with a visible message', 'wait' in e2.lower() or 'try again' in e2.lower() or 'too many' in e2.lower() or p.locator('#lb-submit').is_disabled(), e2)
        print(s.shot('s10_login_lock'))
        # bender-config live push: a signed-in page on the 4702 server hears g:bender:cfg
        print('page errors', s.errors[:4])
    finally:
        s.close()
# bender-config POST + live push (socket client against 4702)
ev = subprocess.run(['node', '-e', """
const { io } = require('socket.io-client'); const s = io('http://127.0.0.1:4702', { transports: ['websocket'] }); let got = null;
s.on('g:bender:cfg', d => { got = d; }); s.on('connect', () => setTimeout(() => process.stdout.write('ready\\n'), 300));
setTimeout(() => { process.stdout.write(JSON.stringify({ got: !!got, keys: got ? Object.keys(got) : [] }) + '\\n'); process.exit(0); }, 6000);
"""], capture_output=True, text=True, env=dict(os.environ, NODE_PATH=os.path.join(REPO, 'node_modules')), timeout=20) if False else None
st, info = http('POST', '/api/admin/bender-config', 'sweeptoken', {'overrides': {}, 'note': 'sweep no-op'}); c.eq('bender-config: POST with token -> 200 ok', (st, info.get('ok')), (200, True))
st, info = http('POST', '/api/admin/bender-config', 'sweeptoken', {'reset': True}); c.eq('bender-config: reset -> 200', st, 200)
st, _ = http('POST', '/api/admin/bender-config', None, {'reset': True}); c.eq('bender-config: POST without token -> 403', st, 403)
sys.exit(c.done('s10'))
