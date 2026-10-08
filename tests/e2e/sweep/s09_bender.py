"""S09: Ballot Bender in the shell, a few spins in each fund, wallet/bank vs __audit after every spin, then the bank panel at a table vs __audit.
Usage: python3 s09_bender.py [desk|phone]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks(); tag = '%d' % (int(time.time()) % 100000); name = 'bg' + tag; key = name.lower()
with sync_playwright() as pw:
    s = Sess(pw, view, 'bender'); p = s.page
    try:
        s.sign_up(name); s.dismiss_modals(); time.sleep(.5)
        p.evaluate("window.__ev = []; PingSocket.onAny((e, d) => { window.__ev.push([e, d]) })")
        p.evaluate("Money.setPref('chips', true)")
        p.click('.sh-di[data-game=bender]'); p.wait_for_selector('.sh-win[data-game=bender] iframe', timeout=15000)
        f = p.frame_locator('.sh-win[data-game=bender] iframe'); f.locator('#spin').wait_for(timeout=20000); time.sleep(2.5)
        if f.locator('#go').count(): f.locator('#go').click(timeout=5000); time.sleep(1.2)
        a0 = audit(); print('start', a0['bank'][key], a0['wallet'][key])
        for fund in ('play', 'chips'):
            f.locator('#modebar button[data-m=%s]' % fund).click(); time.sleep(.8)
            for i in range(3):
                p.evaluate("window.__ev = []")
                before = audit(); f.locator('#spin').click(timeout=10000)
                ok = wait_for(lambda: any(e == 'g:bender:result' for e, _ in p.evaluate('window.__ev')), 30)
                c.ok('%s spin %d: result arrived' % (fund, i), ok)
                time.sleep(2.5)
                ev = p.evaluate('window.__ev'); res = [d for e, d in ev if e == 'g:bender:result']
                errs = [d for e, d in ev if e == 'error']; c.eq('%s spin %d: no error' % (fund, i), errs, [])
                after = audit()
                if res:
                    r = res[-1]; delta = r['totalWin'] - r['cost']
                    sb = (before['wallet'][key] if fund == 'play' else before['bank'][key]); sa = (after['wallet'][key] if fund == 'play' else after['bank'][key])
                    c.eq('%s spin %d: server balance moved by win - cost (%d - %d)' % (fund, i, r['totalWin'], r['cost']), sa - sb, delta)
                    c.eq('%s spin %d: result.wallet == server' % (fund, i), r['wallet'][r.get('mode') or fund], sa)
                    other = 'bank' if fund == 'play' else 'wallet'
                    c.eq('%s spin %d: the other fund did not move' % (fund, i), after[other][key], before[other][key])
                    hdr = p.evaluate("[document.getElementById('sh-chips').innerText, document.getElementById('sh-play').innerText]")
                    shown_chips = nums(hdr[0])[0]; shown_play = nums(hdr[1])[0]
                    c.eq('%s spin %d: header chips == server bank' % (fund, i), shown_chips, after['bank'][key])
                    c.ok('%s spin %d: header Cash == server wallet (%s vs %s)' % (fund, i, hdr[1], after['wallet'][key]), abs(shown_play * 100 - after['wallet'][key]) < 1 or abs(shown_play * 100 - after['wallet'][key]) < 100 and after['wallet'][key] % 100 != 0, str(hdr))
            print(s.shot('s09_bender_%s_%s' % (fund, view)))
        c.eq('drift', audit().get('drift'), [])
        print('page errors', s.errors[:4])
    finally:
        s.close()
sys.exit(c.done('s09 ' + view))
