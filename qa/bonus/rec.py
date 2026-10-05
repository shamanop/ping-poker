import sys, subprocess, time
srv = subprocess.Popen(['python3','-m','http.server','3499','-d','public'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
from playwright.sync_api import sync_playwright
kind, secs = sys.argv[1], int(sys.argv[2])
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    c = b.new_context(viewport={'width':540,'height':960}, record_video_dir='qa/bonus/vid', record_video_size={'width':540,'height':960})
    pg = c.new_page()
    pg.on('pageerror', lambda e: print('pageerror', str(e)[:200]))
    pg.goto(f'http://127.0.0.1:3499/games/bender/index.html?buy={kind}&nosplash=1')
    pg.wait_for_timeout(3500)
    for i in range(secs // 3):
        pg.keyboard.press('Space'); pg.wait_for_timeout(3000)
    c.close(); b.close()
srv.terminate()
