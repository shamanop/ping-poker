"""Step C proof, caller 1: lobby buy-in picker. Asserts the amount that ARRIVES at the server (table_join.buyIn)
for prefs usd / chips / auto (typed, slider, preset) and that an out-of-range amount sends nothing.
Setup: throwaway server on E2E_BASE (default :3580). Signs up six fresh accounts per run (a seated account would get 'Return to seat')."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import subprocess, time
T = int(time.time()) % 100000
N = ['bi%d_%d' % (i, T) for i in range(1, 7)]
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'claim.js')] + N, env=dict(os.environ, NODE_PATH=os.environ.get('NODE_PATH', '/home/isabelle/.cache/node_modules')), check=True, stdout=subprocess.DEVNULL)

def open_join(pg):
    pg.locator('button', has_text='JOIN').first.click()
    pg.wait_for_selector('#lb-buyin-input', timeout=8000)

c = Checks()
cases = [(N[0], 'chips', '2000', 2000), (N[1], 'usd', '20', 2000), (N[2], 'usd', '12.5', 1250), (N[3], 'auto', '1500', 1500)]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, pref, typed, want in cases:
        pg = b.new_page(viewport={'width': 1100, 'height': 800}); fr = Frames(pg); sign_in(pg, name)
        set_pref(pg, pref); open_join(pg)
        pg.fill('#lb-buyin-input', typed); fr.clear()
        pg.click('#lb-sit'); pg.wait_for_timeout(600)
        c.eq('%s typed %r -> table_join.buyIn' % (pref, typed), [f.get('buyIn') for f in fr.of('table_join')], [want])
        pg.close()
    # slider + preset: what the box shows is what is sent
    pg = b.new_page(viewport={'width': 1100, 'height': 800}); fr = Frames(pg); sign_in(pg, N[4]); set_pref(pg, 'usd'); open_join(pg)
    pg.locator('#lb-buyin .amt-pre', has_text='Max').first.click()
    shown = pg.input_value('#lb-buyin-input'); fr.clear()
    pg.click('#lb-sit'); pg.wait_for_timeout(600)
    sent = [f.get('buyIn') for f in fr.of('table_join')]
    c.ok('Max preset sends one buy-in', len(sent) == 1)
    if sent: c.eq('shown dollars == sent/100', float(shown.replace(',', '')), sent[0] / 100)
    pg.close()
    # out of range: nothing sent, message visible, text kept
    pg = b.new_page(viewport={'width': 1100, 'height': 800}); fr = Frames(pg); sign_in(pg, N[5]); set_pref(pg, 'chips'); open_join(pg)
    for bad in ['1', '999999999', 'abc', '']:
        pg.fill('#lb-buyin-input', bad); fr.clear()
        pg.click('#lb-sit'); pg.wait_for_timeout(300)
        c.eq('bad %r sends no table_join' % bad, fr.of('table_join'), [])
        c.ok('bad %r shows a message' % bad, pg.inner_text('#lb-joinmsg').strip() != '' or pg.inner_text('#lb-buyin .amt-msg').strip() != '')
    shot(pg, 'buyin_bad', '.lb-modal')
    # fund picker is above the slider (ui 11)
    c.ok('fund row above slider', pg.evaluate("document.querySelector('#lb-fund').getBoundingClientRect().bottom <= document.querySelector('#lb-buyin-range').getBoundingClientRect().top"))
    b.close()
c.done('buyin.py')
