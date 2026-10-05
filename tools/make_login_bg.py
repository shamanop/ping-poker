#!/usr/bin/env python3
"""Build the login background: INPUT image -> 1920x1080 JPEG with a darkened right side for the form.

Usage: python3 tools/make_login_bg.py INPUT.png [OUTPUT.jpg]   (default OUTPUT: public/art/login-bg.jpg)
"""
import sys, os
import numpy as np
import cv2
from PIL import Image, ImageFilter

W, H = 1920, 1080
MAX_BYTES = 600 * 1024


def detect_faces(rgb):
    try:
        path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
        casc = cv2.CascadeClassifier(path)
        if casc.empty():
            return []
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = casc.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(int(W * 0.03),) * 2)
        return [tuple(int(v) for v in f) for f in faces]
    except Exception:  # cv2 build without CascadeClassifier/data: skip face sharpening
        return []


def sharpen_faces(img, faces):
    arr = np.asarray(img).astype(np.float32)
    blur = cv2.GaussianBlur(arr, (0, 0), 1.6)
    sharp = np.clip(arr + 0.55 * (arr - blur), 0, 255)
    mask = np.zeros((H, W), np.float32)
    for x, y, w, h in faces:
        cx, cy = x + w / 2, y + h / 2
        cv2.ellipse(mask, (int(cx), int(cy)), (int(w * 0.75), int(h * 0.85)), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), max(w for _, _, w, _ in faces) * 0.18 if faces else 1)[..., None]
    return Image.fromarray(np.clip(arr * (1 - mask) + sharp * mask, 0, 255).astype(np.uint8))


def build(src, dst):
    img = Image.open(src).convert('RGB')
    img = img.resize((W, H), Image.LANCZOS) if img.size[0] / img.size[1] == W / H else _cover(img)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=60, threshold=2))
    faces = detect_faces(np.asarray(img))
    print(f'faces detected: {len(faces)}')
    if faces:
        img = sharpen_faces(img, faces)

    arr = np.asarray(img).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx, ny = xx / (W - 1), yy / (H - 1)

    # vignette: gentle on the left, centered on the left 70% scene
    d = np.sqrt(((nx - 0.38) / 0.75) ** 2 + ((ny - 0.5) / 0.72) ** 2)
    vig = 1 - 0.45 * np.clip((d - 0.55) / 0.6, 0, 1) ** 1.6

    # right-side darkening: smooth ramp starting ~62%, fully dark (to 0.22) by ~88%
    t = np.clip((nx - 0.62) / 0.26, 0, 1)
    t = t * t * (3 - 2 * t)
    right = 1 - 0.78 * t

    out = arr * (vig * right)[..., None]
    out = np.clip(out, 0, 1)
    final = Image.fromarray((out * 255 + 0.5).astype(np.uint8))

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    for q in (88, 85, 82, 78, 74):
        final.save(dst, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0 if q >= 85 else 2)
        if os.path.getsize(dst) <= MAX_BYTES:
            break
    print(f'{dst}: {os.path.getsize(dst) // 1024} KB (q={q})')


def _cover(img):
    s = max(W / img.size[0], H / img.size[1])
    r = img.resize((round(img.size[0] * s), round(img.size[1] * s)), Image.LANCZOS)
    l, t = (r.size[0] - W) // 2, (r.size[1] - H) // 2
    return r.crop((l, t, l + W, t + H))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, '..', 'public', 'art', 'login-bg.jpg'))
