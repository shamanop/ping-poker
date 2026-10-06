"""Cut the approved tiles out of the design sheets (raw/T1..T5.png, 3 x 2 grid) into game art.
usage: python3 cut_tiles.py -> cut/<id>.png (masters, transparent, trimmed, square) and a proof sheet cut/_proof.jpg.
Background removal: rembg (isnet-general-use), then the sheet's own slate-blue is keyed out of the soft edge so no blue fringe is left."""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from rembg import remove, new_session
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'cut'); os.makedirs(OUT, exist_ok=True)
SES = new_session('isnet-general-use')

# id -> (source file, grid cell or None for a whole picture)
PIECES = {
    'closer': ('raw/T1.png', 0), 'closer_scream': ('raw/T1.png', 1), 'cashwad': ('raw/T1.png', 2), 'cash': ('raw/T1.png', 3),
    'pile': ('raw/pile_nodonut.png', None), 'rx': ('raw/T1.png', 5),
    'headset': ('raw/T2.png', 0), 'can': ('raw/T2.png', 1), 'mug': ('raw/T2.png', 2), 'note': ('raw/T2.png', 3),
    'ball': ('raw/T2.png', 4), 'cups': ('raw/T2.png', 5),
    'phone': ('raw/T3.png', 0), 'phone_gold': ('raw/T3.png', 1), 'quote': ('raw/T3.png', 2), 'upsell': ('raw/T3.png', 3),
    'handset': ('raw/T3.png', 4), 'bell': ('raw/T3.png', 5),
    'dial': ('raw/T4.png', 0), 'cardmachine': ('raw/T4.png', 1), 'card': ('raw/T4.png', 2), 'spin': ('raw/T4.png', 3),
    'seal': ('raw/T4.png', 4), 'frame': ('raw/T4.png', 5),
    'hero_idle': ('raw/T5.png', 0), 'hero_hype': ('raw/T5.png', 1), 'hero_shock': ('raw/T5.png', 2), 'hero_win': ('raw/T5.png', 3),
    'hero_rage': ('raw/T5.png', 4), 'hero_out': ('raw/T5.png', 5),
}

def cut(src, cell):
    im = Image.open(os.path.join(HERE, src)).convert('RGB')
    if cell is not None:
        w, h = im.width // 3, im.height // 2
        x, y = (cell % 3) * w, (cell // 3) * h
        im = im.crop((x, y, x + w, y + h))
    big = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)          # matting is cleaner on a larger picture
    a = np.asarray(remove(big, session=SES, only_mask=True).resize(im.size, Image.LANCZOS)).astype(np.float32) / 255
    rgb = np.asarray(im).astype(np.float32)
    bg = np.median(np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3)]), axis=0)
    # un-mix the sheet's blue from half-transparent edge pixels: c = a*f + (1-a)*bg  ->  f = (c - (1-a)*bg) / a
    aa = np.clip(a, 0.05, 1)[..., None]
    f = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    a = np.clip((a - 0.08) / 0.84, 0, 1)
    out = Image.fromarray(np.dstack([f, a[..., None] * 255]).astype(np.uint8), 'RGBA')
    box = out.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    out = out.crop(box)
    s = round(max(out.size) * 1.06); sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(out, ((s - out.width) // 2, (s - out.height) // 2))
    return sq

if __name__ == '__main__':
    ids = sys.argv[1:] or list(PIECES)
    for i in ids:
        t = cut(*PIECES[i]); t.save(os.path.join(OUT, i + '.png')); print(i, t.size, flush=True)
    # proof: every cut on the game's dark tile colour and on a light one, to show fringes and holes
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
    names = list(PIECES); c = 200; cols = 6; rows = (len(names) + cols - 1) // cols
    pr = Image.new('RGB', (cols * c, rows * (c + 24)), (30, 30, 34)); dr = ImageDraw.Draw(pr)
    for k, n in enumerate(names):
        p = os.path.join(OUT, n + '.png')
        if not os.path.exists(p): continue
        x, y = (k % cols) * c, (k // cols) * (c + 24)
        dr.rectangle([x, y, x + c - 1, y + c - 1], fill=(36, 46, 70) if (k // cols) % 2 == 0 else (214, 200, 170))
        t = Image.open(p).resize((c - 12, c - 12), Image.LANCZOS); pr.paste(t, (x + 6, y + 6), t)
        dr.text((x + 6, y + c + 2), n, font=f, fill=(255, 214, 80))
    pr.save(os.path.join(OUT, '_proof.jpg'), quality=90); print('proof', pr.size)
