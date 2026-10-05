from playwright.sync_api import sync_playwright
D='/home/isabelle/.openclaw/workspace/ping-poker-v2/qa/uiaudit3/'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    pg.goto('http://localhost:4462/'); pg.wait_for_timeout(800)
    pg.fill('#player-name','chris'); pg.fill('#password-input','ping'); pg.click('#btn-join'); pg.wait_for_timeout(1500)
    pg.keyboard.press('b'); pg.wait_for_timeout(1500)
    pg.screenshot(path=D+'a7-empty.png')
    print(pg.evaluate("[...document.querySelectorAll('#bank-panel .bank-empty')].map(e=>e.innerText.replace(/\\n/g,' | '))"))
    b.close()
