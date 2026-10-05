import os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
ROOT='/home/isabelle/.openclaw/workspace/the-ping-build'; OUT=ROOT+'/qa/tablepolish'
HANDS=int(sys.argv[1]) if len(sys.argv)>1 else 5
d=tempfile.mkdtemp(prefix='tp-')
env=dict(os.environ,PORT='3474',ACCOUNTS_FILE=f'{d}/a.json',BANK_FILE=f'{d}/b.json',LEDGER_FILE=f'{d}/l.json',TABLES_FILE=f'{d}/t.json')
srv=subprocess.Popen(['node','server.js'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1.5); BASE='http://localhost:3474'
def signup(page,name,pin,av='a03'):
    page.wait_for_selector('#lb-signform'); page.click('[data-tab=up]')
    page.fill('#lb-name',name); page.fill('#lb-pin',pin); page.click(f'[data-av={av}]'); page.click('#lb-submit')
    try:
        page.wait_for_selector('.pj-modal.open .claim',timeout=2500); page.click('.pj-modal.open .claim'); page.wait_for_selector('.pj-modal',state='detached',timeout=4000)
    except Exception: pass
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    pa=b.new_context(viewport={'width':1440,'height':900}).new_page()
    pa.on('pageerror',lambda e:print('ERR A',str(e)[:150]))
    pa.goto(BASE+'/'); signup(pa,'Hank','1234'); pa.wait_for_selector('#lb-create-btn'); pa.click('#lb-create-btn')
    pa.wait_for_selector('#lb-form'); pa.click('#lb-create-submit'); pa.wait_for_selector('#lb-sharecode')
    code=pa.inner_text('#lb-sharecode').strip()
    pb=b.new_context(viewport={'width':1440,'height':900}).new_page()
    pb.on('pageerror',lambda e:print('ERR B',str(e)[:150]))
    pb.goto(f'{BASE}/?t={code}'); signup(pb,'mike','4321','a05'); pb.wait_for_selector('#lb-sit'); pb.click('#lb-sit')
    pb.wait_for_selector('#game-screen.active',timeout=8000)
    pa.wait_for_selector('#lb-sit',timeout=8000); pa.click('#lb-sit'); pa.wait_for_selector('#game-screen.active',timeout=8000)
    pa.click('#host-btn'); pa.wait_for_selector('#host-drawer'); pa.click('#host-drawer >> text=Start')
    pa.wait_for_timeout(1500)
    pa.screenshot(path=OUT+'/a-hand1.png'); pb.screenshot(path=OUT+'/b-hand1.png')
    import json
    t0=time.time(); shots=0
    while time.time()-t0<240:
        for pg in (pa,pb):
            for sel in ('#btn-check-call',):
                try:
                    el=pg.query_selector(sel)
                    if el and el.is_visible() and el.is_enabled(): el.click(timeout=500); break
                except Exception: pass
        n=pa.evaluate('(state.hands&&state.hands.log.length)||0') if False else 0
        if pa.query_selector('.hc-chip') and shots==0:
            pa.screenshot(path=OUT+'/a-hotcold.png'); pb.screenshot(path=OUT+'/b-hotcold.png'); shots=1; print('hotcold seen',round(time.time()-t0))
        if shots: break
        pa.wait_for_timeout(400)
    print('done shots',shots)
finally:
    srv.terminate()
