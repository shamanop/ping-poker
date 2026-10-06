"""Contact sheets: before on top, after below, same states in the same order. python3 qa/ui-basement/sheets.py
Writes qa/ui-basement/sheet_<WxH>_p<N>.jpg. Needs Pillow."""
import os, re, sys, glob
from PIL import Image, ImageDraw, ImageFont
UIB = os.path.dirname(os.path.abspath(__file__))
ALL = ['signin', 'lobby', 'bonus', 'profile', 'create', 'buyin', 'seat', 'waiting', 'host', 'preselect', 'myturn', 'raise', 'chat', 'showdown', 'bust', 'bank', 'settle']
TABLE = ['waiting', 'host', 'preselect', 'myturn', 'raise', 'chat', 'showdown', 'bust', 'bank']
SETS = {('1440x900', 2): (ALL, 5, 360), ('1280x720', 2): (['signin', 'lobby', 'buyin', 'host', 'myturn', 'showdown', 'bank'], 4, 360),
        ('390x844', 2): (ALL, 9, 150), ('390x844', 3): (TABLE, 9, 150), ('390x844', 6): (TABLE, 9, 150), ('390x844', 8): (TABLE, 9, 150),
        ('844x390', 2): (ALL, 5, 300), ('844x390', 6): (TABLE, 5, 300)}
try: FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
except Exception: FONT = ImageFont.load_default()
def find(tag, size, n, name):
    g = glob.glob(os.path.join(UIB, tag, '%s_p%d_[0-9][0-9]-%s.jpg' % (size, n, name)))
    return g[0] if g else None
def band(tag, size, n, states, cols, cw):
    cells = []
    for s in states:
        p = find(tag, size, n, s)
        if p: im = Image.open(p).convert('RGB'); im = im.resize((cw, int(im.height * cw / im.width))); cells.append((s, im))
        else: cells.append((s, None))
    ch = max([im.height for _, im in cells if im] or [cw])
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (cw + 4) + 4, rows * (ch + 20) + 4), (18, 12, 8)); d = ImageDraw.Draw(sheet)
    for i, (s, im) in enumerate(cells):
        x, y = 4 + (i % cols) * (cw + 4), 4 + (i // cols) * (ch + 20)
        d.text((x + 2, y + 2), s + ('' if im else '  (not captured)'), fill=(217, 174, 85), font=FONT)
        if im: sheet.paste(im, (x, y + 18))
    return sheet
for (size, n), (states, cols, cw) in SETS.items():
    top, bot = band('before', size, n, states, cols, cw), band('after', size, n, states, cols, cw)
    W = max(top.width, bot.width); out = Image.new('RGB', (W, top.height + bot.height + 44), (8, 5, 3)); d = ImageDraw.Draw(out)
    d.text((6, 4), 'BEFORE  %s  %d players' % (size, n), fill=(245, 185, 66), font=FONT); out.paste(top, (0, 22))
    d.text((6, top.height + 26), 'AFTER   %s  %d players' % (size, n), fill=(245, 185, 66), font=FONT); out.paste(bot, (0, top.height + 44))
    q = 60
    path = os.path.join(UIB, 'sheet_%s_p%d.jpg' % (size, n))
    while True:
        out.save(path, 'JPEG', quality=q)
        if os.path.getsize(path) < 700 * 1024 or q <= 30: break
        q -= 8
    print(os.path.relpath(path, UIB), out.size, os.path.getsize(path) // 1024, 'KB')
