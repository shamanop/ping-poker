"""Skin wave export: cut/<id>.png masters -> public/games/coldcall/assets/img/<id>.webp.
Hero moods go onto the SAME 434x434 canvas as hero.webp (idle), native pixel scale (all from the same T5 sheet), feet-aligned to idle's
bottom edge and centred on idle's body centre, so a mood swap never moves the box or the baseline. Other pieces: resized to a max side."""
import os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); CUT = os.path.join(HERE, 'tiles', 'cut')
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'games', 'coldcall', 'assets', 'img'))
def bbox(im): return im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
idle = Image.open(os.path.join(CUT, 'hero_idle.png')).convert('RGBA'); CW = idle.size[0]
ib = bbox(idle)
MOODS = ['hype', 'shock', 'win', 'rage']
EXTRAS = ['cups', 'bell', 'quote_bronze', 'quote_silver', 'quote_gold']     # -> extra_<id>.webp at 256 px (cashwad, cardmachine, seal reuse their piece files)
PIECES = {'spin': 256, 'seal': 300, 'cardmachine': 340, 'card': 300, 'cashwad': 300, 'phone_gold': 300}
def defringe(im):                          # the sheet's slate-blue survives on soft edges of some cuts: pull blue down on translucent pixels
    a = np.asarray(im).astype(np.int32); edge = (a[..., 3] > 0) & (a[..., 3] < 250)
    cap = ((a[..., 0] + a[..., 1]) // 2 * 0.85).astype(np.int32); a[..., 2] = np.where(edge & (a[..., 2] > cap), cap, a[..., 2])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')
def save(im, name, q=82):
    p = os.path.join(OUT, name + '.webp'); im.save(p, 'WEBP', quality=q, method=6); print(name, im.size, os.path.getsize(p))
if __name__ == '__main__':
    for m in MOODS:
        im = Image.open(os.path.join(CUT, 'hero_%s.png' % m)).convert('RGBA'); b = bbox(im)
        cv = Image.new('RGBA', (CW, CW), (0, 0, 0, 0))
        x = round((ib[0] + ib[2]) / 2 - (b[0] + b[2]) / 2); y = ib[3] - b[3]       # feet on idle's bottom edge
        cv.paste(im, (x, y), im); print(m, 'bbox', b, 'shift', x, y, 'canvas bbox', bbox(cv)); save(cv, 'hero_' + m, 80)
    for n, s in PIECES.items():
        im = defringe(Image.open(os.path.join(CUT, n + '.png')).convert('RGBA')); k = s / max(im.size)
        if k < 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        save(im, n)
    for n in EXTRAS:
        im = defringe(Image.open(os.path.join(CUT, n + '.png')).convert('RGBA')); k = 256 / max(im.size)
        if k < 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        save(im, 'extra_' + n)
