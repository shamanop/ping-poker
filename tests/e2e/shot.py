"""Table screenshot helper: python3 tests/e2e/shot.py <name> [WxH] [turn]  -> tests/e2e/_shots/<name>.jpg (<= 1000 px wide).
Seats chris at POKERPING with a calling bot; with `turn` waits for chris's turn first."""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
name = sys.argv[1]; wh = sys.argv[2] if len(sys.argv) > 2 and 'x' in sys.argv[2] else '1440x900'
w, h = map(int, wh.split('x'))
bot = subprocess.Popen(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bot.js'), 'ua1'], stdout=subprocess.DEVNULL)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': w, 'height': h}); sign_in(pg, 'chris')
    pg.locator('button', has_text='JOIN').first.click(); pg.wait_for_selector('#lb-buyin-input'); pg.fill('#lb-buyin-input', '2000'); pg.click('#lb-sit')
    pg.wait_for_selector('#player-seats .seat'); pg.wait_for_timeout(1500)
    if 'turn' in sys.argv: pg.wait_for_function("!document.getElementById('btn-fold').disabled", timeout=90000)
    path = os.path.join(SHOTS, name + '.png'); pg.screenshot(path=path)
    b.close()
finally:
    bot.terminate()
from PIL import Image
im = Image.open(path).convert('RGB'); im.thumbnail((1000, 1000)); im.save(path[:-4] + '.jpg', quality=60); os.remove(path); print(path[:-4] + '.jpg')
