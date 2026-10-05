from playwright.sync_api import sync_playwright
URL='http://localhost:3917'
with sync_playwright() as p:
    for tag,eng,dev in (('desk','chromium',None),('iph','webkit','iPhone 13')):
        b=getattr(p,eng).launch()
        ctx=b.new_context(**p.devices[dev]) if dev else b.new_context(viewport={'width':1440,'height':900})
        pg=ctx.new_page(); logs=[]
        pg.on('console',lambda m:logs.append(m.text)); pg.on('pageerror',lambda e:logs.append('PAGEERR '+str(e)))
        pg.goto(URL); pg.wait_for_timeout(2000)
        pg.click('button[data-tab=up]'); pg.wait_for_timeout(700)
        import time; n='qa'+tag+str(int(time.time())%100000); pg.fill('#lb-name',n); pg.fill('#lb-pin','1234')
        pg.click('#lb-submit'); pg.wait_for_timeout(2500)
        pg.wait_for_timeout(1500)
        c=pg.locator('.pj-modal.open button:has-text("Claim")')
        if c.count(): c.first.click(); pg.wait_for_timeout(1500)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
        pg.evaluate("window.Lobby.show('profile')"); pg.wait_for_timeout(1000)
        pg.screenshot(path=f'{tag}-1-profile.png')
        pg.fill('#lb-dispname','Neon Liam'); pg.click('#lb-namesave'); pg.wait_for_timeout(1200)
        print(tag,'name now:',pg.inner_text('#lb-profname'),'| msg:',pg.inner_text('#lb-namemsg'))
        pg.set_input_files('#lb-photofile','photo.jpg'); pg.wait_for_timeout(2500)
        print(tag,'avatar src:',(pg.get_attribute('#lb-profav','src') or '')[:40],'| photomsg:',pg.inner_text('#lb-photomsg'))
        pg.screenshot(path=f'{tag}-2-after.png')
        pg.fill('#lb-dispname','x'); pg.click('#lb-namesave'); pg.wait_for_timeout(500)
        print(tag,'bad name msg:',pg.inner_text('#lb-namemsg'))
        print(tag,[l for l in logs if 'rror' in l][:5])
        b.close()
