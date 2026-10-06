# contact sheets: contact_<size>.png, columns = states, rows = Play $ / Chips
import sys, os
from PIL import Image, ImageDraw
D = os.path.dirname(os.path.abspath(__file__))
STATES = ['idle', 'warm', 'round', 'callback', 'pick', 'more', 'after', 'ghost', 'pot', 'gain', 'more_won', 'more_lost']
for tag in ['540', '1440', '360']:
    th = {'540': 420, '1440': 560, '360': 420}[tag]
    for part, sts in (('a', STATES[:6]), ('b', STATES[6:])):
        cells = []
        for mode in ('play', 'chips'):
            row = []
            for st in sts:
                p = f'{D}/{st}_{tag}_{mode}.png'
                if os.path.exists(p):
                    im = Image.open(p).convert('RGB')
                if tag == '1440': im = im.crop((462, 0, 980, im.height))
                r = th / im.height; im = im.resize((int(im.width * r), th)); d = ImageDraw.Draw(im); d.rectangle([0, 0, 120, 14], fill=(0, 0, 0)); d.text((3, 1), f'{st} {mode}', fill=(255, 255, 0)); row.append(im)
            cells.append(row)
        W = max(sum(i.width for i in r) for r in cells if r) if any(cells) else 1
        sheet = Image.new('RGB', (W, th * 2), (20, 20, 20)); y = 0
        for r in cells:
            x = 0
            for i in r: sheet.paste(i, (x, y)); x += i.width
            y += th
        sheet.save(f'{D}/contact_{tag}_{part}.png')
