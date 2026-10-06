"""S03: create-table form, every field, then compare the form's own summary with the table the server made (table_created / __audit) and probe the limits.
Usage: python3 s03_create.py [desk|phone]"""
import re, sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks(); tag = '%d' % (int(time.time()) % 100000)
def btn(p, text, nth=0): return p.locator('#lb-form button').filter(has_text=re.compile('^\\s*' + re.escape(text) + '\\s*$')).nth(nth)
def summary(p):
    t = p.evaluate("(() => { const e = [...document.querySelectorAll('*')].find(n => n.children.length && /^SUMMARY/i.test((n.innerText||'').trim()) && n.innerText.length < 600); return e ? e.innerText : '' })()")
    return t.replace('\n', ' | ')
def fill_amt(p, sel, v): p.fill(sel, v); p.press(sel, 'Tab'); time.sleep(.15)
def created(p):
    return p.evaluate("(window.__ev || []).filter(e => e[0] === 'table_created').map(e => e[1])")
def submit(p, wait=2.5):
    p.evaluate("window.__ev = []"); p.click('#lb-create-submit'); time.sleep(wait)
with sync_playwright() as pw:
    s = Sess(pw, view, 'create'); p = s.page
    try:
        s.sign_up('cr' + tag); s.dismiss_modals(); time.sleep(.5)
        p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
        # ---- variant 1: Play $, preset $1/$2, 10/40/300 dollars, 6 seats, 45 s clock, blinds rise On, rebuys Off, Listed
        p.click('#lb-create-btn'); p.wait_for_selector('#lb-form'); s.dismiss_modals()
        btn(p, 'Play $\nfake money').click() if False else None
        p.fill('#lb-tname', 'Sweep Play 1')
        btn(p, '$1/$2').click()
        fill_amt(p, '#lb-bmin', '10'); fill_amt(p, '#lb-bdef', '40'); fill_amt(p, '#lb-bmax', '300')
        for _ in range(2): p.locator('#lb-form button', has_text='−').first.click()
        btn(p, '45s').click(); btn(p, 'On', 0).click(); btn(p, 'Off', 2).click() if p.locator('#lb-form button').filter(has_text=re.compile('^\\s*Off\\s*$')).count() > 2 else None
        p.locator('#lb-form button', has_text='Listed').click()
        sm = summary(p); print('summary 1:', sm); print(s.shot('s03_form1_%s' % view))
        sent = []
        s.fr.sent.clear(); submit(p)
        sent = s.fr.sent_of('table_create'); cr = created(p); print('sent', sent[-1:] ); print('created', (cr[-1:] or [None])[0] and {k: cr[-1]['table'][k] for k in ('mode', 'blinds', 'buyIn', 'seats', 'actionTimerSec', 'rebuys', 'isPrivate', 'blindIncrease')})
        c.ok('variant 1: server created the table', len(cr) == 1)
        if cr:
            t = cr[-1]['table']
            c.eq('v1 mode', t['mode'], 'play'); c.eq('v1 blinds (cents)', (t['blinds']['sb'], t['blinds']['bb']), (100, 200))
            c.eq('v1 buy-in min/default/max (cents)', (t['buyIn']['min'], t['buyIn']['default'], t['buyIn']['max']), (1000, 4000, 30000))
            c.eq('v1 seats', t['seats'], 6); c.eq('v1 clock', t['actionTimerSec'], 45); c.eq('v1 blinds rise on', bool(t['blindIncrease']['enabled']), True)
            c.eq('v1 listed (not private)', t['isPrivate'], False)
            c.ok('summary said 6 seats / 45s / Listed', all(x in sm for x in ('6', '45s', 'Listed')), sm)
        # ---- back to the form for variant 2: Chips, custom blinds 10/20, 400/1000/5000, 2 seats, clock Off, rise Off, rebuys On, Private
        p.wait_for_selector('#lb-sit', timeout=8000)
        p.evaluate("document.querySelector('#lb-back, .lb-back, [data-a=back]') && 0")
        p.goto(__import__('lib').BASE + '/'); p.wait_for_selector('#lb-create-btn', timeout=15000); time.sleep(1.8); s.dismiss_modals()
        p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
        p.click('#lb-create-btn'); p.wait_for_selector('#lb-form'); s.dismiss_modals()
        s.dismiss_modals(); p.locator('#lb-form button', has_text='Chips').first.click(timeout=5000); time.sleep(.3)
        p.fill('#lb-tname', 'Sweep Chips 2')
        btn(p, 'Custom').click(); time.sleep(.3)
        print('custom inputs:', p.evaluate("[...document.querySelectorAll('#lb-form input')].map(e => e.id + ':' + e.value).join(' ')"))
        ids = p.evaluate("[...document.querySelectorAll('#lb-form input')].map(e => e.id).filter(Boolean)")
        sbid = [i for i in ids if i in ('lb-csb',)] or ['lb-csb']; 
        fill_amt(p, '#lb-csb', '10'); fill_amt(p, '#lb-cbb', '20')
        fill_amt(p, '#lb-bmin', '400'); fill_amt(p, '#lb-bdef', '1000'); fill_amt(p, '#lb-bmax', '5000')
        for _ in range(6): p.locator('#lb-form button', has_text='−').first.click()
        btn(p, 'Off', 0).click() if False else None
        p.locator('#lb-form button', has_text=re.compile('^\\s*Off\\s*$')).first.click()   # action clock Off
        sm2 = summary(p); print('summary 2:', sm2); print(s.shot('s03_form2_%s' % view))
        s.fr.sent.clear(); submit(p); cr = created(p); print('sent', s.fr.sent_of('table_create')[-1:])
        c.ok('variant 2: server created the table', len(cr) == 1)
        if cr:
            t = cr[-1]['table']; print('created 2', {k: t[k] for k in ('mode', 'blinds', 'buyIn', 'seats', 'actionTimerSec', 'rebuys', 'isPrivate')})
            c.eq('v2 mode', t['mode'], 'chips'); c.eq('v2 blinds', (t['blinds']['sb'], t['blinds']['bb']), (10, 20))
            c.eq('v2 buy-in', (t['buyIn']['min'], t['buyIn']['default'], t['buyIn']['max']), (400, 1000, 5000)); c.eq('v2 seats', t['seats'], 2)
            c.eq('v2 clock off = 0', t['actionTimerSec'], 0); c.eq('v2 private', t['isPrivate'], True)
        # ---- limits through the form
        p.goto(__import__('lib').BASE + '/'); p.wait_for_selector('#lb-create-btn', timeout=15000); time.sleep(1.8); s.dismiss_modals()
        p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
        p.click('#lb-create-btn'); p.wait_for_selector('#lb-form'); s.dismiss_modals()
        seats = lambda: p.evaluate("(() => { const b = [...document.querySelectorAll('#lb-form button')].find(x => x.innerText.trim() === '+'); return b.parentElement.innerText.replace(/\\n/g, ' ') })()")
        for _ in range(4): p.locator('#lb-form button', has_text='+').first.click()
        c.ok('seats cannot go above 8 (%s)' % seats(), '9' not in seats(), seats())
        for _ in range(10): p.locator('#lb-form button', has_text='−').first.click()
        c.ok('seats cannot go below 2 (%s)' % seats(), '1' not in seats().replace('15', '').replace('10', ''), seats())
        p.fill('#lb-tname', 'N' * 40); nm = p.input_value('#lb-tname'); print('name length kept', len(nm)); c.ok('long name is capped', len(nm) <= 40)
        # 9 seats: the stepper accepted it above; what does the server say?
        for _ in range(8): p.locator('#lb-form button', has_text='+').first.click()
        c.ok('seats stepper stops at 8 (shows %s)' % seats(), '9' not in seats(), seats())
        s.fr.sent.clear(); submit(p, 1.5); sent = s.fr.sent_of('table_create'); err = p.evaluate("(document.getElementById('lb-createerr') || {}).innerText"); print('9 seats -> sent seats', [x['settings']['seats'] for x in sent], 'created', len(created(p)), 'err', repr(err))
        c.ok('a 9-seat table is not created', not any(x['seats'] == 9 for x in [cr_['table'] for cr_ in created(p)]))
        c.ok('if 9 was sent, the page shows why it failed', not sent or sent[-1]['settings']['seats'] <= 8 or bool(err), str(err))
        # since the Q06 fix the 8-seat submit succeeds and closes the form: reopen it for the limit checks
        if not p.locator('#lb-form').count():
            p.goto(__import__('lib').BASE + '/'); p.wait_for_selector('#lb-create-btn', timeout=15000); time.sleep(1.8); s.dismiss_modals()
            p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
            p.click('#lb-create-btn'); p.wait_for_selector('#lb-form'); s.dismiss_modals()
        # buy-in minimum below the big blind
        fill_amt(p, '#lb-bmin', '0.10'); msg = p.evaluate("[...document.querySelectorAll('#lb-form .amt-msg')].map(e => e.innerText).filter(Boolean).join(' / ')")
        s.fr.sent.clear(); p.evaluate("window.__ev = []"); submit(p, 1.8)
        sent = s.fr.sent_of('table_create'); cr_ = created(p); err = p.evaluate("(document.getElementById('lb-createerr') || {}).innerText"); errs = p.evaluate("(window.__ev || []).filter(e => e[0] === 'error').map(e => e[1])")
        print('min 0.10 below bb 0.50 -> field msg', repr(msg), '| sent', len(sent), '| created', len(cr_), '| createerr', repr(err), '| server errors', errs)
        c.ok('a buy-in minimum below the big blind is blocked in the form or refused with a visible reason', len(cr_) == 0 and (not sent or bool(err) or bool(errs)) or (not sent and bool(msg)), 'sent=%d created=%d err=%r' % (len(sent), len(cr_), err))
        # maximum below minimum
        fill_amt(p, '#lb-bmin', '10'); fill_amt(p, '#lb-bmax', '5'); msg2 = p.evaluate("[...document.querySelectorAll('#lb-form .amt-msg')].map(e => e.innerText).filter(Boolean).join(' / ')")
        s.fr.sent.clear(); submit(p, 1.2); print('max 5 < min 10 -> msg', repr(msg2), 'sent', len(s.fr.sent_of('table_create')))
        c.eq('max below min sends nothing', s.fr.sent_of('table_create'), [])
        print(s.shot('s03_limits_%s' % view))
        print('page errors', s.errors[:4])
    finally:
        s.close()
sys.exit(c.done('s03 ' + view))
