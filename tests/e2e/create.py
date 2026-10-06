"""Step C proof, caller 2: create-table form (min/default/max/custom blinds). Asserts the table_create settings that
ARRIVE at the server for usd/chips/auto, that a bad amount sends nothing, S3-1 (no literal 'null'), S3-2 (typed values
beyond the old slider span are kept and the thumbs follow). Setup as in buyin.py (chris must be claimed)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def open_form(pg, mode):
    pg.click('#lb-create-btn'); pg.wait_for_selector('#lb-form')
    pg.click('#lb-mode button[data-v=%s]' % mode)
    pg.wait_for_selector('#lb-bmin')

def fill(pg, sel, v):
    pg.fill(sel, v); pg.press(sel, 'Tab')

c = Checks()
with sync_playwright() as p:
    b = p.chromium.launch()
    for pref, mode, vals, want in [
        ('usd', 'play', dict(min='1', dflt='2', max='20000', sb='0.5', bb='1'), dict(min=100, default=200, max=2000000, sb=50, bb=100)),
        ('chips', 'chips', dict(min='100', dflt='300', max='5000000', sb='10', bb='20'), dict(min=100, default=300, max=5000000, sb=10, bb=20)),
        ('auto', 'play', dict(min='5', dflt='20', max='500', sb='1', bb='2'), dict(min=500, default=2000, max=50000, sb=100, bb=200)),
    ]:
        pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg); sign_in(pg, 'chris'); set_pref(pg, pref)
        open_form(pg, mode)
        # custom blinds on
        pg.click('#lb-blinds button[data-v=custom]'); pg.wait_for_selector('#lb-csb')
        # the fields render in the pref mode of this table unit; 'chips' mode table + usd pref shows dollars of the same units
        if mode == 'chips' and pref == 'usd':
            pass
        fill(pg, '#lb-bmin', vals['min']); fill(pg, '#lb-bdef', vals['dflt']); fill(pg, '#lb-bmax', vals['max'])
        fill(pg, '#lb-csb', vals['sb']); fill(pg, '#lb-cbb', vals['bb'])
        c.ok('%s/%s no literal null in summary' % (pref, mode), 'null' not in pg.inner_text('#lb-sum'))
        fr.clear(); pg.click('#lb-create-submit'); pg.wait_for_timeout(700)
        got = fr.of('table_create')
        c.eq('%s/%s table_create sent once' % (pref, mode), len(got), 1)
        if got:
            s = got[0]['settings']
            c.eq('%s/%s buyIn' % (pref, mode), s['buyIn'], {'min': want['min'], 'max': want['max'], 'default': want['default']})
            c.eq('%s/%s blinds' % (pref, mode), s['blinds'], {'sb': want['sb'], 'bb': want['bb']})
        pg.close()
    # a bad amount sends nothing and the message is visible; a typed max above the old slider span is kept
    pg = b.new_page(viewport={'width': 1280, 'height': 900}); fr = Frames(pg); sign_in(pg, 'chris'); set_pref(pg, 'usd')
    open_form(pg, 'play')
    fill(pg, '#lb-bmax', '20000')
    c.eq('typed $20,000 max stays 2,000,000 units', pg.evaluate("document.querySelector('#lb-bmax').value"), '20000')
    c.ok('max thumb follows typed value (not pinned at old $500 span)', pg.evaluate("(()=>{const r=document.querySelectorAll('#lb-form .lb-slider input[type=range]');return +r[1].value === +r[1].max})()"))
    fill(pg, '#lb-bmin', '1'); c.ok('typed $1 min accepted (S3-2)', pg.evaluate("!document.querySelector('#lb-bmin').closest('.amt').classList.contains('amt-bad')"))
    for bad in ['abc', '0', '999999999999']:
        fill(pg, '#lb-bmin', bad); fr.clear(); pg.click('#lb-create-submit'); pg.wait_for_timeout(300)
        c.eq('bad min %r sends nothing' % bad, fr.of('table_create'), [])
        c.ok('bad min %r shows a message' % bad, pg.inner_text('#lb-createerr').strip() != '')
    fill(pg, '#lb-bmin', '1'); fill(pg, '#lb-bdef', '0.5')
    c.ok('default below min shows the cross message', pg.inner_text('#lb-bcross').strip() != '')
    fr.clear(); pg.click('#lb-create-submit'); pg.wait_for_timeout(300)
    c.eq('default below min sends nothing', fr.of('table_create'), [])
    shot(pg, 'create_form', '#lb-form')
    b.close()
c.done('create.py')
