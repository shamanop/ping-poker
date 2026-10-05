import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); PORT = 8931
srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'serve.py'), str(PORT)]); time.sleep(0.8)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for (w, h) in [(1440, 900), (1920, 1080)]:
            for st in ['docked', 'floating', 'min']:
                pg = b.new_page(viewport={'width': w, 'height': h})
                errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.goto(f'http://127.0.0.1:{PORT}/t/shell_test.html?state={st}'); pg.wait_for_timeout(2800)
                fr = pg.frame_locator('iframe')
                if st == 'docked':
                    try: fr.locator('#go').click(timeout=3000); pg.wait_for_timeout(1500)
                    except Exception as e: print('go-click failed', e)
                if st == 'min':
                    pg.frames[-1].evaluate("parent.postMessage({type:'round',win:1240,bet:100,mode:'play'},'*')"); pg.wait_for_timeout(700)
                    print('badge:', pg.inner_text('.sh-di[data-game=bender] .badge'), 'visible-class:', pg.evaluate("document.querySelector('.sh-di[data-game=bender]').classList.contains('has-badge')"))
                if st == 'floating' and w == 1440:
                    t = pg.locator('.sh-title').bounding_box(); pg.mouse.move(t['x']+100, t['y']+10); pg.mouse.down(); pg.mouse.move(t['x']-300, t['y']+80, steps=6); pg.mouse.up()
                    hh = pg.locator('.sh-h.se').bounding_box(); pg.mouse.move(hh['x']+8, hh['y']+8); pg.mouse.down(); pg.mouse.move(hh['x']-400, hh['y']-400, steps=6); pg.mouse.up()
                    r1 = pg.evaluate("(r=>[r.x,r.y,r.width,r.height].map(Math.round))(document.querySelector('.sh-win').getBoundingClientRect())")
                    pg.reload(); pg.wait_for_timeout(500)
                    r2 = pg.evaluate("(r=>[r.x,r.y,r.width,r.height].map(Math.round))(document.querySelector('.sh-win.open').getBoundingClientRect())")
                    print('drag/resize', r1, 'after reload', r2, 'min size ok', r1[2] >= 360 and r1[3] >= 540)
                pg.screenshot(path=os.path.join(HERE, f'p-{st}-{w}.png'))
                info = pg.evaluate("()=>({u:getComputedStyle(document.getElementById('sh-stage')).getPropertyValue('--u'),stage:document.getElementById('sh-stage').getBoundingClientRect().width,win:(r=>r?[r.x,r.y,r.width,r.height].map(Math.round):null)(document.querySelector('.sh-win.open')?.getBoundingClientRect()),note:(document.querySelector('iframe')?.contentDocument?.getElementById('modenote')||{}).textContent,layout:localStorage.getItem('ping.layout')})")
                print(w, st, info['u'], round(info['stage']), info['win'], info['note'], errs)
                pg.close()
        b.close()
finally:
    srv.terminate()
