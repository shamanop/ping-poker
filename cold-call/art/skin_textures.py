"""Skin wave procedural textures (own work, no licence): tileable wood grain, paper grain, rubber-stamp speckle mask.
Writes public/games/coldcall/assets/img/{wood,grain,stampmask}.webp. Deterministic (fixed seed)."""
import os
import numpy as np
from PIL import Image
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'games', 'coldcall', 'assets', 'img'))
rng = np.random.default_rng(1005)
def blur(a, sx, sy):                      # periodic gaussian blur via FFT (keeps the tile seamless); sx along columns, sy along rows
    h, w = a.shape; fx = np.fft.fftfreq(w)[None, :]; fy = np.fft.fftfreq(h)[:, None]
    k = np.exp(-2 * (np.pi ** 2) * ((sx * fx) ** 2 + (sy * fy) ** 2)); r = np.real(np.fft.ifft2(np.fft.fft2(a) * k))
    return (r - r.min()) / (r.max() - r.min() + 1e-9)
def lerp3(t, stops):                      # t in 0..1 -> rgb through colour stops [(pos, (r,g,b))...]
    pos = [s[0] for s in stops]; out = np.zeros(t.shape + (3,))
    for c in range(3): out[..., c] = np.interp(t, pos, [s[1][c] for s in stops])
    return out
def wood(n=256):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    warp = blur(rng.random((n, n)), 6, 90) * 0.9 + blur(rng.random((n, n)), 2, 40) * 0.15
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * (x / 11.0 + warp * 2.0))
    fine = blur(rng.random((n, n)), 0.7, 40)                   # long thin streaks
    pores = blur(rng.random((n, n)), 0.6, 6)
    t = 0.22 * rings + 0.52 * fine + 0.26 * pores
    t = (t - t.min()) / (t.max() - t.min())
    rgb = lerp3(t ** 1.15, [(0, (56, 34, 15)), (0.4, (96, 60, 27)), (0.75, (126, 82, 38)), (1, (156, 106, 52))])
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
def grain(n=160):                         # neutral mid-grey fibres, for overlay/multiply on paper and bakelite
    a = 0.55 * blur(rng.random((n, n)), 0.6, 0.6) + 0.30 * blur(rng.random((n, n)), 4, 0.8) + 0.30 * blur(rng.random((n, n)), 0.8, 4)
    a = (a - a.min()) / (a.max() - a.min()); g = (128 + (a - 0.5) * 95).astype(np.uint8)
    return Image.fromarray(g, 'L').convert('RGB')
def stamp(n=256):                         # white = ink, transparent = ink missing (speckle + worn patches)
    f = blur(rng.random((n, n)), 1.2, 1.2); big = blur(rng.random((n, n)), 14, 14)
    miss = ((f > 0.70) | ((big > 0.70) & (f > 0.55))).astype(float)
    a = np.zeros((n, n, 4), np.uint8); a[..., :3] = 255; a[..., 3] = ((1 - miss) * 255).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')
if __name__ == '__main__':
    for name, im, kw in (('wood', wood(), dict(quality=74)), ('grain', grain(), dict(quality=70)), ('stampmask', stamp(), dict(lossless=True, method=6))):
        p = os.path.join(OUT, name + '.webp'); im.save(p, 'WEBP', **kw); print(name, im.size, os.path.getsize(p))
