import subprocess, json, time
from playwright.sync_api import sync_playwright
D='/home/isabelle/.openclaw/workspace/ping-poker-v2/qa/uiaudit3/'
def js(pg,s): return pg.evaluate(s)
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
    pg.goto('http://localhost:4461/'); pg.wait_for_timeout(800)
    pg.fill('#player-name','chris'); pg.fill('#password-input','ping'); pg.click('#btn-join'); pg.wait_for_timeout(1500)
    pg.keyboard.press('b'); pg.wait_for_timeout(1500)
    print('open after B:', js(pg,"document.getElementById('bank-panel').classList.contains('open')"))
    pg.screenshot(path=D+'a1-empty-1440.png')
    print('empty text:', js(pg,"[...document.querySelectorAll('.bank-empty')].map(e=>e.innerText.replace(/\\n/g,' | ')).join(' || ')")[:300])
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    bots=subprocess.Popen(['node',D+'bots.js'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    open(D+'bots.pid','w').write(str(bots.pid))
    pg.wait_for_timeout(22000)
    pg.click('#bank-btn'); pg.wait_for_timeout(1500)
    pg.screenshot(path=D+'a2-1440.png')
    geo=js(pg,"""(()=>{const r=e=>{const x=document.querySelector(e);if(!x)return null;const b=x.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]};
    const clip=[...document.querySelectorAll('#bank-panel *')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!='auto'&&getComputedStyle(e).overflowX!='scroll'&&e.clientWidth>0).slice(0,8).map(e=>e.className+':'+e.scrollWidth+'>'+e.clientWidth);
    const sc=['bank-players','bank-feed'].map(i=>{const e=document.getElementById(i);return i+' '+e.scrollHeight+'/'+e.clientHeight});
    return {panel:r('#bank-panel'),bar:r('#action-bar'),felt:r('.g-table')||r('#table'),clip,sc}})()""")
    print('geo1440',json.dumps(geo))
    # refresh jump test
    js(pg,"""window.__m=0;window.__rep=0;const t=document.getElementById('bank-players');new MutationObserver(l=>{window.__m+=l.length;l.forEach(x=>window.__rep+=x.removedNodes.length)}).observe(document.getElementById('bank-panel'),{childList:true,subtree:true});window.__n0=document.querySelector('#bank-players .bp')""")
    js(pg,"document.getElementById('bank-players').scrollTop=40; document.getElementById('bank-feed').scrollTop=30")
    pg.wait_for_timeout(9000)
    print('mutations/removed over 9s:',js(pg,"[window.__m,window.__rep]"),'node replaced:',js(pg,"window.__n0!==document.querySelector('#bank-players .bp')"),'scroll kept:',js(pg,"[document.getElementById('bank-players').scrollTop,document.getElementById('bank-feed').scrollTop]"))
    # two shots 1s apart
    pg.screenshot(path=D+'a3-t0.png'); pg.wait_for_timeout(1000); pg.screenshot(path=D+'a4-t1.png')
    # edit
    ed=pg.query_selector('#bank-players b.editable')
    print('editable count',len(pg.query_selector_all('#bank-players b.editable')),'cursor',js(pg,"getComputedStyle(document.querySelector('#bank-players b.editable')).cursor"),'underline',js(pg,"getComputedStyle(document.querySelector('#bank-players b.editable')).textDecorationLine+' '+getComputedStyle(document.querySelector('#bank-players b.editable'),'::after').content"))
    ed.click(); pg.wait_for_timeout(300); pg.keyboard.type('4321'); pg.wait_for_timeout(9000)
    print('edit survives refresh:',js(pg,"(document.querySelector('.bp-edit')||{}).value"), 'focused:',js(pg,"document.activeElement.className"))
    pg.screenshot(path=D+'a5-editing.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    print('after Esc panel open:',js(pg,"document.getElementById('bank-panel').classList.contains('open')"),'edit input:',js(pg,"!!document.querySelector('.bp-edit')"))
    chris_before=js(pg,"document.querySelector('#bank-players .bp.me .bp-bal b').innerText")
    pg.click('#bank-players .bp.me .bp-bal b.editable'); pg.keyboard.type('12345'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
    print('chris bank before/after Enter:',chris_before,js(pg,"document.querySelector('#bank-players .bp.me .bp-bal b').innerText"))
    # blur
    pg.click('#bank-players .bp.me .bp-bal b.editable'); pg.keyboard.type('777'); pg.click('#bank-panel h3'); pg.wait_for_timeout(1200)
    print('after blur value:',js(pg,"document.querySelector('#bank-players .bp.me .bp-bal b').innerText"))
    pg.set_viewport_size({'width':1920,'height':1080}); pg.wait_for_timeout(1200)
    pg.screenshot(path=D+'a6-1920.png')
    geo=js(pg,"""(()=>{const r=e=>{const x=document.querySelector(e);if(!x)return null;const b=x.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]};return {panel:r('#bank-panel'),bar:r('#action-bar')}})()""")
    print('geo1920',geo)
    print('errs',errs[:4])
    b.close()
