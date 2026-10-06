"""Cut a 3x2 bold symbol sheet (flat slate-blue ground) into 256 px tiles with a cream keyline.
usage: python3 cut_sheet.py raw/<sheet>.png n1 n2 n3 n4 n5 n6 -> sym/<name>.png (512 px masters in sym_hi/)"""
import sys, os, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
src, names = sys.argv[1], sys.argv[2:8]
t = Image.open(src).convert('RGB'); n = np.asarray(t).astype(np.float32); H, W = n.shape[:2]
bg = np.median(np.concatenate([n[:12].reshape(-1, 3), n[-12:].reshape(-1, 3)]), 0); d = np.sqrt(((n - bg) ** 2).sum(-1))
lab, _ = ndi.label(d < 42); ids = set([lab[2, 2], lab[2, -3], lab[-3, 2], lab[-3, -3]]) - {0}
back = np.isin(lab, list(ids))
# enclosed patches of ground colour (inside a mug handle, a cord loop, a dollar sign): tighter match, real area
l2, k2 = ndi.label((d < 24) & ~back)
if k2:
    area = ndi.sum(np.ones_like(d), l2, range(1, k2 + 1)); back |= np.isin(l2, [i + 1 for i, a in enumerate(area) if a > 160])
fg = ndi.binary_opening(~back, iterations=2)
ol, k = ndi.label(fg); objs = ndi.find_objects(ol); sizes = ndi.sum(fg, ol, range(1, k + 1))
os.makedirs('sym', exist_ok=True); os.makedirs('sym_hi', exist_ok=True)
for ci, nm in enumerate(names):
    r, c = divmod(ci, 3); m = np.zeros_like(fg)
    for i in range(k):
        if sizes[i] < 60: continue
        cy, cx = ndi.center_of_mass(ol == i + 1) if sizes[i] < 4000 else ((objs[i][0].start + objs[i][0].stop) / 2, (objs[i][1].start + objs[i][1].stop) / 2)
        if int(cy // (H / 2)) == r and int(cx // (W / 3)) == c: m |= (ol == i + 1)
    ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a = Image.fromarray((m[y0:y1, x0:x1] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
    im = t.crop((x0, y0, x1, y1)).convert('RGBA'); im.putalpha(a)
    s = max(im.size); pad = int(s * 0.07); cv = Image.new('RGBA', (s + 2 * pad,) * 2, (0, 0, 0, 0)); cv.paste(im, ((s + 2 * pad - im.width) // 2, (s + 2 * pad - im.height) // 2))
    hard = cv.getchannel('A').point(lambda v: 255 if v > 90 else 0)
    key = hard.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1.2))
    out = Image.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', cv.size, (246, 232, 196)).split(), key)), cv)
    out.resize((512, 512), Image.LANCZOS).save(f'sym_hi/{nm}.png'); out.resize((256, 256), Image.LANCZOS).save(f'sym/{nm}.png'); print(nm, im.size)
