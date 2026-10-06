"""P5 fix C (Q02): a phone (390x844) player can sign out and in, open the create form, join a table, see it, and act (Call, Raise with a preset) through the real buttons.
Every visible control's bounding box must lie within 0..390 horizontally (and the action dock within the screen vertically); the page must not overflow sideways.
One browser. Usage: E2E_BASE=http://127.0.0.1:4710 python3 fix_c_phone.py [chips|play]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
mode = sys.argv[1] if len(sys.argv) > 1 else 'chips'
W, H = 390, 844
c = Checks()
CTL = 'button, input, select, textarea, a[href], [role=button]'

def controls(p, root=None):
    """Visible interactive controls: [(desc, left, top, right, bottom)] (rounded)."""
    return p.evaluate("""([sel, root]) => { const out = [], scope = root ? document.querySelector(root) : document;
      if (!scope) return out;
      for (const e of scope.querySelectorAll(sel)) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        let hid = false; for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') { hid = true; break; } } if (hid) continue;
        const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
        out.push([(e.id || (e.className && e.className.baseVal === undefined ? e.className : '') || e.tagName).toString().trim().split(' ')[0].slice(0, 32) + ':' + (e.innerText || e.value || '').slice(0, 14).replace(/\\n/g, ' '), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]); }
      return out; }""", [CTL, root])

def inside_h(p, label, root=None):
    bad = [o for o in controls(p, root) if o[1] < -1 or o[3] > W + 1]
    c.ok('%s: every control inside 0..%d horizontally' % (label, W), not bad, str(bad[:6]))
    return bad

def no_overflow(p, label):
    d = p.evaluate("({doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, iw: innerWidth})")
    c.ok('%s: no horizontal page overflow %s' % (label, d), d['doc'] <= W and d['body'] <= W)

def box(p, sel):
    return p.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] }", sel)

def on_screen_44(p, sel, label):
    b = box(p, sel)
    c.ok('%s on screen and >= 44x44 (%s)' % (label, b), b and b[0] >= 0 and b[2] <= W and b[1] >= 0 and b[3] <= H and b[2] - b[0] >= 44 and b[3] - b[1] >= 44)

with sync_playwright() as pw:
    sc = Scene(pw, 'phone', mode, 2000, [('b1', 2000, 'call')], settings={'actionTimerSec': 0, 'buyIn': {'min': 100, 'max': 1000000, 'default': 2000}})
    try:
        p = sc.p; s = sc.s
        # ---- sign up, daily bonus modal, lobby
        s.sign_up(sc.hero_name); time.sleep(1.0)
        if p.locator('.pj-modal').count():
            inside_h(p, 'daily bonus window'); print(s.shot('fixc_phone_modal'))
            s.dismiss_modals()
        time.sleep(.4)
        inside_h(p, 'lobby'); no_overflow(p, 'lobby'); print(s.shot('fixc_phone_lobby'))
        on_screen_44(p, '#sh-out', 'Sign out')
        on_screen_44(p, '#lb-create-btn', 'CREATE TABLE')
        c.ok('lobby: code box and JOIN on screen', (box(p, '#lb-code') or [0, 0, 999])[2] <= W and (box(p, '#lb-join-btn') or [0, 0, 999])[2] <= W)
        # ---- sign out, then sign in again through the form
        p.click('#sh-out'); ok = wait_for(lambda: p.locator('#lb-name').count() > 0, 8)
        c.ok('Sign out shows the sign-in form', ok)
        inside_h(p, 'sign-in form'); no_overflow(p, 'sign-in'); print(s.shot('fixc_phone_signin'))
        p.fill('#lb-name', sc.hero_name); p.fill('#lb-pin', '4321'); p.click('#lb-submit')
        p.wait_for_selector('#lb-join-btn, #lb-create-btn, .pj-modal', timeout=15000); time.sleep(.6); s.dismiss_modals()
        c.ok('signed in again: lobby shown', p.locator('#lb-create-btn').count() > 0)
        # ---- create form
        p.click('#lb-create-btn'); p.wait_for_selector('#lb-create-submit', timeout=8000); time.sleep(.5)
        inside_h(p, 'create form'); no_overflow(p, 'create form'); print(s.shot('fixc_phone_create'))
        p.locator('#lb-create-submit').scroll_into_view_if_needed(); time.sleep(.2)
        b = box(p, '#lb-create-submit'); c.ok('Create button reachable (%s)' % (b,), b and b[0] >= 0 and b[2] <= W and b[1] >= 0 and b[3] <= H)
        p.click('#lb-create-submit')
        made = wait_for(lambda: p.locator('.lb-code').count() > 0, 8)
        c.ok('create form made a table (code screen)', made)
        if made:
            inside_h(p, 'share screen'); no_overflow(p, 'share screen'); print(s.shot('fixc_phone_share'))
        # ---- join the bot's table by code
        p.evaluate("window.Lobby && Lobby.show && Lobby.show('lobby')"); time.sleep(.5)
        if not p.locator('#lb-code').count():
            p.locator('button', has_text='Back').first.click() if p.locator('button', has_text='Back').count() else p.goto(BASE + '/')
            p.wait_for_selector('#lb-code, #lb-name', timeout=10000)
            if p.locator('#lb-name').count(): s.sign_in(sc.hero_name)
        s.dismiss_modals()
        sc.hero_sit_ui()
        c.ok('hero seated through the lobby buy-in at 390', p.locator('#player-seats .seat').count() >= 1)
        sc.bots_sit(); sc.hook()
        time.sleep(1.2)
        inside_h(p, 'table waiting'); no_overflow(p, 'table waiting'); print(s.shot('fixc_phone_waiting'))
        # chat drawer: closed by default, opens from the Chat button, controls reachable, closes again
        tog = box(p, '#btn-rail-toggle')
        c.ok('Chat toggle visible on screen (%s)' % (tog,), tog and tog[0] >= 0 and tog[2] <= W and tog[3] - tog[1] >= 30)
        c.ok('chat rail is closed by default (no visible controls from it)', not controls(p, '#rail'))
        if tog:
            p.click('#btn-rail-toggle'); time.sleep(.5)
            rb = box(p, '#rail'); ci = box(p, '#chat-input'); print('drawer open: rail', rb, 'chat input', ci); print(s.shot('fixc_phone_drawer'))
            c.ok('drawer open: chat input on screen', ci and ci[0] >= 0 and ci[2] <= W and ci[3] <= H)
            inside_h(p, 'chat drawer open', '#rail')
            p.fill('#chat-input', 'hi from a phone'); p.click('#chat-send'); time.sleep(.6)
            c.ok('chat message shows in the drawer', 'hi from a phone' in (p.inner_text('#chat-messages') or ''))
            p.click('#btn-rail-toggle'); time.sleep(.5)
            c.ok('drawer closed again', not controls(p, '#rail'))
        # ---- play: first turn Call, later turn Raise via a preset
        sc.start()
        c.ok('hero gets a turn', sc.wait_turn(40))
        time.sleep(.6)
        inside_h(p, 'table, hero on turn'); no_overflow(p, 'table, hero on turn')
        for sel, nm in (('#btn-fold', 'FOLD'), ('#btn-check-call', 'CALL'), ('#btn-raise', 'RAISE')): on_screen_44(p, sel, nm)
        for sel, nm in (('#raise-input, #raise-box .amt-text', 'raise amount box'), ('#raise-box .amt-pre', 'first preset')):
            b = box(p, sel); c.ok('%s on screen (%s)' % (nm, b), b and b[0] >= 0 and b[2] <= W and b[1] >= 0 and b[3] <= H and b[3] - b[1] >= 30)
        pres = p.evaluate("[...document.querySelectorAll('#raise-box .amt-pre')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.height)] })")
        c.ok('every preset inside 0..%d and >= 44 tall (%s)' % (W, pres), pres and all(a >= 0 and b <= W and h >= 44 for a, b, h in pres))
        sb = box(p, '#stage'); tb = box(p, '#table-box')
        c.ok('stage uses the screen width (%s) and the table fits it (%s)' % (sb, tb), sb and tb and sb[2] - sb[0] >= W - 24 and tb[0] >= -1 and tb[2] <= W + 1)
        seats = p.evaluate("[...document.querySelectorAll('#player-seats .seat')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] })")
        c.ok('every seat inside the screen %s' % seats, seats and all(a >= -1 and b <= W + 1 for a, b in seats))
        print(s.shot('fixc_phone_table'))
        g0 = sc.gs(); n0 = len(sc.fr.sent_of('player_action'))
        p.click('#btn-check-call')                    # real button, Playwright checks it is not covered
        got = wait_for(lambda: len(sc.fr.sent_of('player_action')) > n0, 6)
        sent = sc.fr.sent_of('player_action')[n0:] if got else []
        c.ok('Call press sent player_action call/check (%s)' % sent, sent and sent[0].get('action') in ('call', 'check'))
        c.ok('hero gets a second turn', wait_for(lambda: not sc.my_turn(), 6) and sc.wait_turn(40))
        time.sleep(.5); inside_h(p, 'table, second turn')
        g1 = sc.gs(); n1 = len(sc.fr.sent_of('player_action'))
        p.locator('#raise-box .amt-pre').nth(1).click(); time.sleep(.3)
        amt = p.evaluate("(document.querySelector('#raise-input, #raise-box .amt-text') || {}).value")
        print('raise amount box after preset:', amt); print(s.shot('fixc_phone_raise'))
        p.click('#btn-raise')
        got = wait_for(lambda: len(sc.fr.sent_of('player_action')) > n1, 6)
        sent = sc.fr.sent_of('player_action')[n1:] if got else []
        c.ok('Raise press sent player_action raise (%s)' % sent, sent and sent[0].get('action') == 'raise' and (sent[0].get('amount') or 0) > 0)
        # later street: board cards on the table, still on turn, still inside the screen
        if wait_for(lambda: not sc.my_turn(), 6) and sc.wait_turn(40):
            time.sleep(.8); inside_h(p, 'table, later street'); no_overflow(p, 'table, later street'); print(s.shot('fixc_phone_flop'))
            for sel, nm in (('#btn-fold', 'FOLD'), ('#btn-check-call', 'CALL'), ('#btn-raise', 'RAISE')): on_screen_44(p, sel, nm + ' (later street)')
        time.sleep(.5)
        c.ok('no page errors', not [e for e in s.errors if 'pageerror' in e], str(s.errors[:3]))
    finally:
        sc.close()
sys.exit(c.done('fix_c_phone (%s)' % mode))
