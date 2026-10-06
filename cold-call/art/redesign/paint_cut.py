"""FB4: cut a painted-UI sheet (pieces on flat pure green #00FF00) into trimmed RGBA masters.
usage: python3 paint_cut.py raw/paint_<sheet>.png <sheet> name1 name2 ...  (names in reading order: rows top to bottom, left to right within a row)
-> ../paint/<sheet>/<name>.png. Soft green key (alpha from how green a pixel is), green un-mixed from the edge pixels, green spill clamped.
Pieces are found as connected blobs of non-green; blobs under 2000 px are ignored (specks)."""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
src, sheet, names = sys.argv[1], sys.argv[2], sys.argv[3:]
im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.float32); H, W = a.shape[:2]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
gn = g - np.maximum(r, b)                                   # greenness: ~255 on the key, <= ~30 on any paint we use
alpha = np.clip(1 - (gn - 14) / 226.0, 0, 1)
alpha[gn < 14] = 1
fg = ndi.binary_opening(alpha > .5, iterations=2)
lab, k = ndi.label(fg); objs = ndi.find_objects(lab); sizes = ndi.sum(fg, lab, range(1, k + 1))
blobs = [(i, objs[i]) for i in range(k) if sizes[i] > 2000]
# reading order: group by row (centre y within 70 px of the group's first), then x
cy = lambda o: (o[0].start + o[0].stop) / 2; cx = lambda o: (o[1].start + o[1].stop) / 2
blobs.sort(key=lambda t: cy(t[1])); rows = []
for t in blobs:
    if rows and abs(cy(t[1]) - np.mean([cy(u[1]) for u in rows[-1]])) < 70: rows[-1].append(t)
    else: rows.append([t])
order = [t for row in rows for t in sorted(row, key=lambda t: cx(t[1]))]
print('found', len(order), 'blobs for', len(names), 'names')
os.makedirs('../paint/' + sheet, exist_ok=True)
for (i, sl), nm in zip(order, names):
    m = ndi.binary_dilation(lab == i + 1, iterations=6)       # keep the soft edge ring of this blob only (not another blob's)
    al = np.where(m, alpha, 0)
    y0, y1, x0, x1 = max(sl[0].start - 6, 0), min(sl[0].stop + 6, H), max(sl[1].start - 6, 0), min(sl[1].stop + 6, W)
    al = al[y0:y1, x0:x1]; px = a[y0:y1, x0:x1].copy()
    green = np.array([0, 255, 0], np.float32); sa = np.maximum(al, 1e-3)[..., None]
    px = np.where(al[..., None] < 1, (px - (1 - al[..., None]) * green) / sa, px)
    px[..., 1] = np.minimum(px[..., 1], np.maximum(px[..., 0], px[..., 2]) + 6)   # spill clamp
    out = np.dstack([np.clip(px, 0, 255), al * 255]).astype(np.uint8)
    ys, xs = np.where(out[..., 3] > 8); out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    Image.fromarray(out, 'RGBA').save('../paint/%s/%s.png' % (sheet, nm)); print(nm, out.shape[1], 'x', out.shape[0])
