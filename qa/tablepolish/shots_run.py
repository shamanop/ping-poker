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
    pa.click('#host-btn'); pa.wait_for_selector('#host-drawer'); pa.click('#host-drawer >> text=Start'); pa.keyboard.press('Escape'); pa.click('#host-drawer .x, #host-drawer [aria-label=Close], #host-drawer button:has-text("×")', timeout=1000) if pa.query_selector('#host-drawer.open') else None
    pa.wait_for_timeout(1500)
    pa.screenshot(path=OUT+'/a-hand1.png'); pb.screenshot(path=OUT+'/b-hand1.png')
    import json
    # play; capture: turn state (A's turn), emote from top seat, showdown
    got={}
    t0=time.time()
    pb.keyboard.press('1')
    while time.time()-t0<200 and len(got)<3:
        txt=pa.inner_text('body').lower()
        if 'turn' not in got and pa.query_selector('.seat.hero.active') :
            pa.screenshot(path=OUT+'/c-turn.png'); got['turn']=1
        if 'emote' not in got and 'turn' in got:
            pb.keyboard.press('2'); pa.wait_for_timeout(500); pa.screenshot(path=OUT+'/c-emote.png'); got['emote']=1
        if 'win' not in got and pa.query_selector('.seat.winner') and pa.query_selector('.seat-peek.reveal'):
            pa.wait_for_timeout(700); pa.screenshot(path=OUT+'/c-showdown.png'); got['win']=1
        for pg in (pa,pb):
            try:
                el=pg.query_selector('#btn-check-call')
                if el and el.is_visible() and el.is_enabled(): el.click(timeout=400)
            except Exception: pass
        pa.wait_for_timeout(300)
    print(got)
    r=pa.evaluate("""()=>{const q=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};return {strip:q('#emote-strip'),btn:q('.emote-btn'),log:q('#chat-messages'),charm:q('.pj-charm')}}""")
    print(r)
finally:
    srv.terminate()
