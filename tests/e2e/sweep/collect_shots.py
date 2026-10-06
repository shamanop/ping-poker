"""python3 collect_shots.py  copies the evidence shots named in defects.json (key shot -> a source in runs/shots, via SHOTMAP in shotmap.json) into repo/qa/v2-sweep/ (JPEG, <=1000 px, <150 KB)."""
import json, os, shutil
from PIL import Image
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.abspath(os.path.join(H, '..', '..', '..')); S = os.path.join(R, '..', 'runs', 'shots'); O = os.path.join(R, 'qa', 'v2-sweep')
os.makedirs(O, exist_ok=True)
M = json.load(open(os.path.join(H, 'shotmap.json')))
for dst, src in M.items():
    p = os.path.join(S, src)
    if not os.path.exists(p): print('missing', src); continue
    im = Image.open(p).convert('RGB')
    if im.width > 1000: im = im.resize((1000, int(im.height * 1000 / im.width)))
    q = 60
    while True:
        im.save(os.path.join(O, dst), 'JPEG', quality=q)
        if os.path.getsize(os.path.join(O, dst)) < 150 * 1024 or q <= 20: break
        q -= 10
    print(dst, os.path.getsize(os.path.join(O, dst)) // 1024, 'KB')
