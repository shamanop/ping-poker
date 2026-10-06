"""FB4 export: masters in ../paint/<sheet>/<name>.png -> public/games/coldcall/assets/img/ui/<out>.webp at display size x2 (run from cold-call/art/redesign).
usage: python3 paint_export.py [sheet]   modes: fit = rebuilt at an exact target size (end caps kept, middle stretched or cropped); nine = a 9-slice source scaled by k (slice px are given in paint.css); raw = as is (optionally width-limited)."""
import os, sys
from PIL import Image
O = '../../../public/games/coldcall/assets/img/ui/'; os.makedirs(O, exist_ok=True)
def fit(im, W, H, cap):
    """uniform scale to height H, then caps of `cap` px (scaled) on each side kept and the middle stretched/cropped to W"""
    s = H / im.height; im = im.resize((max(1, round(im.width * s)), H), Image.LANCZOS); c = min(cap, im.width // 3)
    if im.width == W: return im
    out = Image.new('RGBA', (W, H)); out.paste(im.crop((0, 0, c, H)), (0, 0)); out.paste(im.crop((im.width - c, 0, im.width, H)), (W - c, 0))
    mid = im.crop((c, 0, im.width - c, H)); mw = W - 2 * c
    if mid.width >= mw: x = (mid.width - mw) // 2; out.paste(mid.crop((x, 0, x + mw, H)), (c, 0))
    else: out.paste(mid.resize((mw, H), Image.LANCZOS), (c, 0))
    return out
# sheet -> [(master name, out name, mode, args)]
T = {
 's1': [('bar_red', 'bar_red', 'fit', (1060, 76, 70)), ('bar_gold', 'bar_gold', 'fit', (1060, 76, 70)), ('strip_note', 'strip_note', 'fit', (1032, 60, 60)),
        ('sticky', 'sticky', 'raw', ()), ('leaf', 'leaf', 'fit', (200, 92, 24)), ('lcd', 'lcd', 'raw', ())],
 's2': [('key_cream', 'key_cream', 'nine', (.68,)), ('key_red', 'key_red', 'nine', (.68,)), ('key_gold', 'key_gold', 'nine', (.68,)), ('key_navy', 'key_navy', 'nine', (.68,)),
        ('key_pad', 'key_pad', 'nine', (.72,)), ('pad_plate', 'pad_plate', 'nine', (.75,))],
 's3': [('bubble_body', 'bubble_body', 'nine', (.8,)), ('bubble_tail', 'bubble_tail', 'tail', ()), ('toast', 'toast', 'nine', (.8,)),
        ('card_panel', 'card_panel', 'nine', (.9,)), ('plate_win', 'plate_win', 'nine', (.7,)), ('plate_chip', 'plate_chip', 'nine', (.8,))],
 's4': [('burst', 'burst', 'raw', ())],
 's5': [('strip', 'strip_memo', 'fit', (1032, 60, 40)), ('blotter', 'blotter', 'fit', (1080, 48, 40)), ('rwin', 'rim_win', 'nine', (.7,)), ('rchip', 'rim_chip', 'nine', (.7,)),
        ('panel', 'rim_panel', 'nine', (1,)), ('trough', 'trough', 'fit', (1000, 20, 30))],
}
if os.path.exists('paint_export_cfg.py'): sys.path.insert(0, '.'); T.update(__import__('paint_export_cfg').T)
for sheet in ([sys.argv[1]] if len(sys.argv) > 1 else T):
    n = 0
    for m, out, mode, a in T[sheet]:
        im = Image.open('../paint/%s/%s.png' % (sheet, m)).convert('RGBA')
        if mode == 'fit': im = fit(im, *a)
        elif mode == 'nine' and a: im = im.resize((round(im.width * a[0]), round(im.height * a[0])), Image.LANCZOS)
        elif mode == 'tail': im = im.crop((0, 9, im.width, im.height)); im = im.resize((72, round(72 * im.height / im.width)), Image.LANCZOS)   # the open base edge: drop the top rows that carry a faint outline
        elif mode == 'raw' and a and im.width > a[0]: im = im.resize((a[0], round(im.height * a[0] / im.width)), Image.LANCZOS)
        p = O + 'ui_' + out + '.webp'; im.save(p, quality=88, method=6, alpha_quality=92); n += os.path.getsize(p)
        print('%-22s %4dx%-4d %5.1f KB' % ('ui_' + out, im.width, im.height, os.path.getsize(p) / 1024))
    print(sheet, 'total %.1f KB' % (n / 1024))
