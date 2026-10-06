"""Step C proof, caller 7: Ballot Bender bet. The iframe is loaded bridged inside the app page (same origin) and driven with the
shell's own messages: `init` in, `spin` out. Asserts the bet that LEAVES the iframe for usd / chips / auto prefs (listed amounts only),
that an unlisted typed amount spins nothing and shows a message, and that a pref toggle re-renders the text from the same bet.
Setup as buyin.py (any account)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

BETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
    sign_in(pg, 'by1'); set_pref(pg, 'usd')
    pg.evaluate("""(bets) => { window.__out = []; addEventListener('message', e => { if (e.data && e.data.type) window.__out.push(e.data); });
      const f = document.createElement('iframe'); f.id = 'bf'; f.src = '/games/bender/index.html?bridge=1&nosplash=1'; f.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:620px;z-index:99999;border:0';
      document.body.appendChild(f); window.__bets = bets; }""", BETS)
    pg.wait_for_function("document.getElementById('bf').contentDocument && document.getElementById('bf').contentDocument.getElementById('spin')")
    fr = pg.frame_locator('#bf')
    pg.wait_for_function("window.__out.some(m => m.type === 'hello')")   # the iframe's listener is up once it says hello
    pg.evaluate("document.getElementById('bf').contentWindow.postMessage({type:'init', mode:'play', wallet:{play:1000000, chips:500000}, bets: window.__bets}, '*')")
    pg.wait_for_function("document.getElementById('bf').contentDocument.getElementById('betIn')")
    bf = lambda js: pg.evaluate("(js) => { const d = document.getElementById('bf').contentDocument; return " + js + " }", js)
    bet_text = lambda: bf("d.getElementById('betIn').value")
    spins = lambda: pg.evaluate("window.__out.filter(m => m.type === 'spin').map(m => [m.bet, m.mode])")
    def spin():
        pg.evaluate("window.__out.length = 0"); fr.locator('#spin').click(); pg.wait_for_timeout(600)
        s = spins(); pg.evaluate("document.getElementById('bf').contentWindow.postMessage({type:'error', reqId:(window.__out.find(m=>m.type==='spin')||{}).reqId, message:'test'}, '*')"); pg.wait_for_timeout(300); return s
    def typ(txt):
        fr.locator('#betIn').fill(txt)
    c.eq('usd: default bet 100 units shows 1', bet_text(), '1')
    typ('2'); c.eq('usd: typed 2 -> spin bet 200 (play)', spin(), [[200, 'play']])
    typ('0.37'); s = spin()
    c.eq('usd: unlisted 0.37 spins nothing', s, [])
    c.ok('usd: unlisted shows a message', bf("d.querySelector('#bet .amt-msg').textContent.length > 0"))
    typ('abc'); c.eq('garbage spins nothing', spin(), [])
    # stepper still works and re-renders text from the number
    typ('2'); fr.locator('#betUp').click(); c.eq('usd: stepper up from 2 -> 5', bet_text(), '5')
    c.eq('usd: stepper bet leaves as 500', spin(), [[500, 'play']])
    # pref toggle re-renders text from units, bet unchanged
    set_pref(pg, 'chips'); pg.wait_for_timeout(300)
    c.eq('chips pref: text re-rendered from 500 units', bet_text(), '500')
    typ('50'); c.eq('chips pref: typed 50 -> spin bet 50', spin(), [[50, 'play']])
    typ('55'); c.eq('chips pref: unlisted 55 spins nothing', spin(), [])
    set_pref(pg, 'auto'); pg.wait_for_timeout(300)
    # chips wallet (mode toggle in the iframe's own bar)
    fr.locator('#modebar button[data-m=chips]').click(); pg.wait_for_timeout(300)
    c.ok('chips wallet: bet text is a plain listed number', bet_text() in [str(x) for x in BETS])
    typ('20'); c.eq('chips wallet: typed 20 -> spin bet 20 mode chips', spin(), [[20, 'chips']])
    shot(pg, 'bender_bet', '#bf')
    b.close()
c.done('bender.py')
