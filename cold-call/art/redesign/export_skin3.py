"""Skin 3 asset export: redesign art -> public/games/coldcall/assets/img (run from the repo root).
symbols 256 px webp (2x of a ~68 css px cell is 136), 512 px copies for the wide-screen side art, room plate, title, bezel, desk."""
import os
from PIL import Image
R = 'cold-call/art/redesign/'; O = 'public/games/coldcall/assets/img/'
IDS = 'mug note ball can cups headset rx pile cashwad cash closer bell phone quote_bronze quote_silver quote_gold upsell cardmachine'.split()
BIG = 'mug note can cashwad headset phone bell rx closer cups pile cash'.split()
for i in IDS:
    im = Image.open(R + f'sym_hi/{i}.png').convert('RGBA')
    im.resize((256, 256), Image.LANCZOS).save(O + f's3_{i}.webp', quality=90, method=6)
    if i in BIG: im.save(O + f's3big_{i}.webp', quality=86, method=6)
Image.open(R + 'raw/room.png').convert('RGB').save(O + 'room.webp', quality=82, method=6)
Image.open(R + 'title.png').convert('RGBA').save(O + 'title.webp', quality=90, method=6)
Image.open(R + 'bezel.png').convert('RGBA').save(O + 'bezel.webp', quality=92, method=6)
Image.open(R + 'sym/spin_raw.png').convert('RGBA').save(O + 's3_spin.webp', quality=92, method=6)
Image.open(R + 'desk.jpg').convert('RGB').save(O + 'desk.webp', quality=80, method=6)
for f in sorted(os.listdir(O)):
    if f.startswith(('s3', 'room', 'title', 'bezel', 'desk')): print(f, os.path.getsize(O + f) // 1024, 'KB')
