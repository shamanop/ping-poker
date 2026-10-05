from PIL import Image, ImageDraw, ImageFilter
import math
S = 3
W, H = 192 * S, 276 * S
R = 12 * S
GOLD = (245, 185, 66)
GOLD_D = (190, 140, 48)
NAVY = (14, 44, 112)
NAVY_D = (8, 26, 72)
CREAM = (240, 230, 205)

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, W - 1, H - 1], R, fill=CREAM)
b = 7 * S
inner = Image.new('RGBA', (W, H), (0, 0, 0, 0))
# navy field with soft vertical gradient
field = Image.new('RGBA', (W - 2 * b, H - 2 * b))
fd = ImageDraw.Draw(field)
for y in range(field.height):
    t = y / field.height
    c = tuple(int(NAVY[i] * (1 - abs(t - .5) * .5) + NAVY_D[i] * abs(t - .5) * .5) for i in range(3))
    fd.line([(0, y), (field.width, y)], fill=c + (255,))
mask = Image.new('L', field.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, field.width - 1, field.height - 1], R - 4 * S, fill=255)
img.paste(field, (b, b), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle([b, b, W - b - 1, H - b - 1], R - 4 * S, outline=GOLD_D, width=S)

# diamond lattice clipped to field
lat = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(lat)
sx, sy = 36 * S, 52 * S
cx0, cy0 = W / 2, H / 2
for i in range(-8, 9):
    x0 = cx0 + i * sx
    ld.line([(x0 - 9 * sx, cy0 - 9 * sy), (x0 + 9 * sx, cy0 + 9 * sy)], fill=GOLD + (200,), width=int(1.3 * S))
    ld.line([(x0 + 9 * sx, cy0 - 9 * sy), (x0 - 9 * sx, cy0 + 9 * sy)], fill=GOLD + (200,), width=int(1.3 * S))
for i in range(-8, 9):
    for j in range(-8, 9):
        if (i + j) % 2: continue
        x, y = cx0 + i * sx, cy0 + j * sy
        r = 4.2 * S
        ld.ellipse([x - r, y - r, x + r, y + r], outline=GOLD + (230,), width=int(1.2 * S))
        r2 = 1.4 * S
        ld.ellipse([x - r2, y - r2, x + r2, y + r2], fill=GOLD + (230,))
lat_mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(lat_mask).rounded_rectangle([b + 3 * S, b + 3 * S, W - b - 3 * S, H - b - 3 * S], R - 6 * S, fill=255)
lat.putalpha(Image.composite(lat.getchannel('A'), Image.new('L', (W, H), 0), lat_mask))
img.alpha_composite(lat)

# center cartouche
cw, ch = 104 * S, 148 * S
cx, cy = W // 2, H // 2
cart = [cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2]
d = ImageDraw.Draw(img)
d.rounded_rectangle(cart, 10 * S, fill=NAVY_D, outline=GOLD, width=int(2.2 * S))
d.rounded_rectangle([c + (3 * S if k < 2 else -3 * S) for k, c in enumerate(cart)], 8 * S, outline=GOLD_D, width=S)

# real VP logo, cropped to its bbox
logo = Image.open('public/images/vp-logo.png').convert('RGBA')
logo = logo.crop(logo.getbbox())
tw = int(cw * .72)
th = int(logo.height * tw / logo.width)
logo = logo.resize((tw, th), Image.LANCZOS)
img.alpha_composite(logo, (cx - tw // 2, cy - th // 2))

# subtle shine
out = img.resize((192 * 2, 276 * 2), Image.LANCZOS)
out.save('qa/cardback/card-back-blue-384.png')
img.resize((192 * 3, 276 * 3), Image.LANCZOS).save('qa/cardback/card-back-blue.png')
print('ok', out.size)
