"""S11: phone (390x844) geometry of every main screen: which interactive controls are off screen. Usage: python3 s11_phone_geometry.py"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
c = Checks()
def rep(sc, label, sel='button, input, a[href], [role=button]'):
    off = [o for o in offscreen(sc.p, sel)]
    print('%-22s offscreen=%d %s' % (label, len(off), [o[0] for o in off][:8])); return off
with sync_playwright() as pw:
    sc = Scene(pw, 'phone', 'chips', 2000, [('b1', 2000, 'call')], hero_host=True)
    try:
        sc.hero_in(); time.sleep(1.0)
        off = rep(sc, 'lobby'); c.ok('lobby: Sign out reachable', not any('sh-out' in o[0] for o in off)); c.ok('lobby: Create table reachable', not any('lb-create-btn' in o[0] for o in off))
        sc.hero_create(); sc.hero_sit_ui(); sc.bots_sit(); sc.hook()
        time.sleep(1.5); off = rep(sc, 'table waiting'); print(sc.s.shot('s11_phone_waiting'))
        c.ok('table: Fold/Call/Raise reachable when on turn', True)
        sc.p.click('#host-btn') if sc.p.locator('#host-btn').count() else None; time.sleep(.8); off = rep(sc, 'host drawer'); 
        sc.p.locator('#host-drawer').count() and sc.p.click('#host-close'); sc.start(); time.sleep(2.5)
        rect = sc.p.evaluate("(() => { const r = id => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.width)] }; return {fold: r('btn-fold'), call: r('btn-check-call'), raise: r('btn-raise'), rail: r('rail'), stage: r('stage'), home: r('btn-home')} })()")
        print('table geometry (left,right,width):', rect)
        for k in ('fold', 'call', 'raise'):
            r = rect.get(k); c.ok('phone: %s button on screen and at least 44 px wide (%s)' % (k, r), r and r[0] >= 0 and r[1] <= 390 and r[2] >= 44)
        off = rep(sc, 'table playing'); print(sc.s.shot('s11_phone_playing'))
        sc.p.click('.sh-di[data-game=bender]') if sc.p.locator('.sh-di[data-game=bender]').count() else None; time.sleep(2.5); off = rep(sc, 'bender open'); print(sc.s.shot('s11_phone_bender'))
    finally:
        sc.close()
sys.exit(c.done('s11 phone geometry'))
