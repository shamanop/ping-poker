"""S01: sign up in the UI, daily bonus, header money vs the server's __audit, sign out/in. Usage: python3 s01_account.py [phone|desk]"""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from lib import *
view = sys.argv[1] if len(sys.argv) > 1 else 'desk'
c = Checks(); tag = '%s%d' % (view[0], int(time.time()) % 100000)
name = 'su' + tag
def header(p): return p.evaluate("({chips: document.getElementById('sh-chips')?.innerText, play: document.getElementById('sh-play')?.innerText, bonus: document.getElementById('sh-bonus')?.innerText})")
def num(t): 
    import re; m = re.sub(r'[^0-9.\-]', '', t or ''); return float(m) if m else None
with sync_playwright() as pw:
    s = Sess(pw, view); p = s.page
    s.sign_up(name); time.sleep(1.2)
    a = audit(); key = name.lower()
    m = s.fr.last('money')
    c.eq('signup bank in money event == audit', m['bank'], a['bank'].get(key))
    c.eq('signup play in wallet == audit', s.fr.last('wallet')['play'], a['wallet'].get(key))
    h = header(p); print('header after signup', h)
    c.eq('header chips shows audit bank', num(h['chips'].split('\n')[-1]), a['bank'][key])
    c.eq('header play $ shows audit wallet', num(h['play'].split('\n')[-1]) * 100, a['wallet'][key])
    print(s.shot('s01_%s_bonus' % view))
    # claim through the modal button
    btn = p.locator('.pj-modal button', has_text='CLAIM').first
    c.ok('claim button visible', btn.count() == 1)
    before = a['wallet'][key]
    btn.click(); time.sleep(1.5)
    a2 = audit(); cl = {'amountCents': s.fr.last('bonus:status')['amountCents']}
    c.eq('claim: wallet moved by the amount claimed', a2['wallet'][key] - before, cl and cl.get('amountCents'))
    h2 = header(p); print('header after claim', h2)
    c.eq('header play $ after claim == audit', num(h2['play'].split('\n')[-1]) * 100, a2['wallet'][key])
    # second claim must be refused
    p.evaluate("PingSocket.emit('bonus:claim')"); time.sleep(1)
    a3 = audit(); c.eq('second claim same day pays nothing', a3['wallet'][key], a2['wallet'][key])
    print(s.shot('s01_%s_lobby' % view)); s.dismiss_modals()
    # sign out / in keeps money
    p.click('#sh-out'); p.wait_for_selector('#lb-name'); 
    p.fill('#lb-name', name); p.fill('#lb-pin', '4321'); p.click('#lb-submit'); p.wait_for_selector('#lb-create-btn, .pj-modal'); time.sleep(1)
    a4 = audit(); c.eq('after sign-in again wallet unchanged', a4['wallet'][key], a2['wallet'][key]); c.eq('bank unchanged', a4['bank'][key], a['bank'][key])
    print('errors', s.errors[:5]); s.close()
sys.exit(c.done('s01 ' + view))
