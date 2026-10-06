"""P5 fix C: lobby + table screenshots and a geometry dump of every id'd element, at phone and desktop sizes.
Usage: E2E_BASE=http://127.0.0.1:4710 python3 fix_c_shots.py <tag> [views]   (views: comma list of phone,desk,tab; default desk,tab,phone)
Writes <SWEEP_SHOTS>/fixc_<tag>_<view>_<lobby|table>-s.jpg (<150 KB) and <SWEEP_SHOTS>/fixc_<tag>_rects.json.
Compare two tags: python3 fix_c_shots.py --diff before after   (desktop geometry must be identical)."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import lib
lib.VIEWS['tab'] = (1024, 768); lib.VIEWS['wide'] = (1920, 1080)
from lib import *

RECTS = """() => { const out = {}; for (const e of document.querySelectorAll('[id]')) { const cs = getComputedStyle(e); if (cs.display === 'none') continue;
  const r = e.getBoundingClientRect(); if (r.width < 1 && r.height < 1) continue; out[e.id] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; } return out; }"""
SKIP = ('my-turn-ring', 'my-turn-timer', 'countdown', 'showdown-bar', 'toasts')   # animated / timing

def run(tag, views):
    allr = {}
    with sync_playwright() as pw:
        for view in views:
            sc = Scene(pw, view if view in ('phone', 'desk') else 'desk', 'chips', 2000, [('b1', 2000, 'call')],
                       rig=([['Ks', 'Kd'], ['As', 'Ad']], ['2c', '7d', '9h', 'Jc', '4s']))
            try:
                if view not in ('phone', 'desk'):
                    w, h = lib.VIEWS[view]; sc.p.set_viewport_size({'width': w, 'height': h})
                sc.hero_in(); time.sleep(1.2)
                sc.p.evaluate("document.querySelectorAll('.pj-modal').forEach(e=>e.remove())")
                print(sc.s.shot('fixc_%s_%s_lobby' % (tag, view)))
                allr[view + ':lobby'] = sc.p.evaluate(RECTS)
                sc.hero_sit_ui(); sc.bots_sit(); sc.hook(); sc.start()
                sc.wait_turn(30); time.sleep(1.0)
                print(sc.s.shot('fixc_%s_%s_table' % (tag, view)))
                allr[view + ':table'] = sc.p.evaluate(RECTS)
            finally:
                sc.close()
    for k in allr:
        for s in SKIP: allr[k].pop(s, None)
    json.dump(allr, open(os.path.join(SHOTS, 'fixc_%s_rects.json' % tag), 'w'))

def diff(a, b):
    A = json.load(open(os.path.join(SHOTS, 'fixc_%s_rects.json' % a))); B = json.load(open(os.path.join(SHOTS, 'fixc_%s_rects.json' % b)))
    bad = 0
    for k in A:
        if k.startswith('phone') or k not in B: continue
        for i in sorted(set(A[k]) | set(B[k])):
            if A[k].get(i) != B[k].get(i):
                # seat/card content may differ with the deal; only report layout containers
                print('DIFF', k, i, A[k].get(i), B[k].get(i)); bad += 1
    print('desktop geometry diffs: %d' % bad); return 1 if bad else 0

if __name__ == '__main__':
    if sys.argv[1] == '--diff': sys.exit(diff(sys.argv[2], sys.argv[3]))
    run(sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'desk,tab,phone').split(','))
