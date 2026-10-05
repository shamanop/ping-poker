"""COLD CALL hero-scene concepts (Chris 2026-10-05 17:54: GPT art, 5 concepts, a contact sheet for each).
usage: python3 gen_concepts.py [A B ...]  -> raw/<id><n>.png, sheet_<id>.jpg, spend.jsonl (skips files that exist).
No text is ever generated in the art: titles and labels are added in HTML/CSS (labels on the sheets are drawn by PIL)."""
import base64, io, json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw'); os.makedirs(RAW, exist_ok=True)
KEY = open(os.path.expanduser('~/.openclaw/credentials/openrouter-isabelle.key')).read().strip()
MODEL = 'openai/gpt-5.4-image-2'

SCENE = (
    "SUBJECT: a frantic call-center salesman in his thirties. Cheap wrinkled short-sleeve dress shirt, loosened tie, sweat "
    "patches, hair standing on end, enormous bulging bloodshot eyes with pinprick pupils, a manic too-wide grin with "
    "gritted teeth, one twitching eyelid. A phone handset with a curly cord is jammed hard against his ear; his other hand "
    "crushes an energy drink can. He is obviously wired far past any healthy limit. His desk is a wreck: towers of empty "
    "coffee cups, crushed plain energy cans, an orange pill bottle with a blank label tipped on its side, an open box of "
    "powdered donuts that has left a suspicious little heap of white powder on the desk. BEHIND HIM a coworker is passed "
    "out face-down on his own desk, headset askew, drooling on the keyboard. The call center beyond is chaos: paper "
    "flying, a monitor throwing sparks, an old rotary phone ringing off its hook, someone standing on a desk, sticky notes "
    "on every surface, one fluorescent tube flickering. It is a dark comedy about burnout, funny and not grim.\n"
    "HARD RULES: absolutely no text, letters, numbers, logos or brand names anywhere in the picture. Every label, sticky "
    "note, screen, mug and can is blank. No real brands. One single picture, no border, no panels, no caption.")

FRAMES = [
    ("portrait", "FRAMING: tight hero portrait, chest up. His face fills the upper half of the picture; the passed-out "
                 "coworker and the chaos read small but clear behind him."),
    ("wide", "FRAMING: wide view of the whole call-center floor. The salesman is at the front desk, left of centre; the "
             "passed-out coworker is at the desk right behind him; rows of chaos recede into the room."),
    ("low angle", "FRAMING: extreme low angle from the desk top looking up at him, wide lens. Coffee cups, cans and the "
                  "pill bottle loom huge in the foreground; the ceiling lights and flying paper fill the top."),
    ("mascot", "FRAMING: full-body mascot pose. He leans out toward the viewer from a rolling office chair that is "
               "mid-spin, phone cord stretched tight, a strong clear silhouette that still reads at thumbnail size; the "
               "coworker and call center sit behind him, simpler and darker."),
]

CONCEPTS = {
    'A': ("BOILER ROOM", "STYLE: hand-painted satirical magazine caricature, the kind on the cover of a humour magazine "
          "from the 1970s to 90s: exaggerated heads, rubbery faces, rich gouache colour, every wrinkle and bead of sweat "
          "lovingly overdone. Late-80s penny-stock boiler room: wood panelling, beige phones, suspenders, cigarette-yellow "
          "light, warm browns and mustard with a red tie."),
    'B': ("GRAVEYARD SHIFT", "STYLE: modern adult animated sitcom look: flat colour, thick clean outlines, simple shapes, "
          "limited palette, deadpan staging. A 3 a.m. cubicle farm lit sickly fluorescent green with deep teal shadows; "
          "the only warm colours are his red eyes and the orange pill bottle."),
    'C': ("RUBBER HOSE", "STYLE: 1930s rubber-hose cartoon: pie-cut eyes blown up huge, noodle limbs, white gloves, "
          "bouncy squash-and-stretch poses, inked on aged cream paper with film grain and a faded limited palette of "
          "cream, black, brick red and dull teal. Period office: candlestick and rotary phones, wooden desks, a switchboard."),
    'D': ("JACKPOT POSTER", "STYLE: glossy slot-machine key art: a polished 3D cartoon character with big appealing "
          "shapes, rim lighting, saturated purple and gold with hot pink accents, shiny highlights, depth-of-field blur "
          "behind. Flying around him like a jackpot burst: gold coins, banknotes, green dollar signs as solid shapes, "
          "blank speech-message bubbles, phone handsets."),
    'E': ("CLAY", "STYLE: stop-motion claymation: hand-sculpted plasticine figures with visible thumbprints, glass-bead "
          "eyes bulging out of the head, a real miniature cardboard-and-wire office set, practical tiny props, warm desk "
          "lamp key light with a cold blue fill, shallow depth of field like a macro photo of a model."),
}

def gen(job):
    cid, i = job
    name, style = CONCEPTS[cid]
    out = os.path.join(RAW, '%s%d.png' % (cid, i + 1))
    if os.path.exists(out): return out, 'skip', 0
    body = {'model': MODEL, 'modalities': ['image', 'text'],
            'image_config': {'aspect_ratio': '2:3', 'image_size': '1K'},
            'messages': [{'role': 'user', 'content': [{'type': 'text', 'text':
                'Paint one picture: hero art for a comedy slot-machine game.\n' + style + '\n' + FRAMES[i][1] + '\n' + SCENE}]}],
            'usage': {'include': True}}
    last = ''
    for a in range(3):
        try:
            req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                                         headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
            d = json.load(urllib.request.urlopen(req, timeout=480))
            cost = d.get('usage', {}).get('cost') or 0
            imgs = d['choices'][0]['message'].get('images') or []
            if not imgs:
                last = 'no image: ' + json.dumps(d['choices'][0]['message'].get('content'))[:200]
                continue
            raw = base64.b64decode(imgs[0]['image_url']['url'].split(',', 1)[1])
            Image.open(io.BytesIO(raw)).convert('RGB').save(out)
            open(os.path.join(HERE, 'spend.jsonl'), 'a').write(json.dumps(
                {'name': os.path.basename(out), 'cost': cost, 't': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
            return out, 'ok', cost
        except urllib.error.HTTPError as e:
            last = 'HTTP %s %s' % (e.code, e.read().decode(errors='replace')[:200]); time.sleep(15 * (a + 1))
        except Exception as e:
            last = 'ERR %s' % e; time.sleep(10)
    return out, last, 0

def sheet(cid):
    """2 x 2 so each picture stays large on a phone."""
    name, _ = CONCEPTS[cid]
    f = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    big, small = ImageFont.truetype(f, 50), ImageFont.truetype(f, 36)
    cw, ch, pad, head = 832, 1248, 14, 86
    W, H = pad + 2 * (cw + pad), head + 2 * (ch + pad)
    im = Image.new('RGB', (W, H), (18, 18, 20)); dr = ImageDraw.Draw(im)
    dr.text((pad, 16), 'COLD CALL  ·  %s  ·  %s' % (cid, name), font=big, fill=(245, 240, 225))
    n = 0
    for i in range(4):
        p = os.path.join(RAW, '%s%d.png' % (cid, i + 1))
        x, y = pad + (i % 2) * (cw + pad), head + (i // 2) * (ch + pad)
        if os.path.exists(p):
            im.paste(Image.open(p).convert('RGB').resize((cw, ch), Image.LANCZOS), (x, y)); n += 1
        else:
            dr.rectangle([x, y, x + cw, y + ch], outline=(90, 90, 90))
        tag = '%s%d  %s' % (cid, i + 1, FRAMES[i][0])
        tw = dr.textlength(tag, font=small)
        dr.rectangle([x, y, x + tw + 24, y + 54], fill=(18, 18, 20)); dr.text((x + 12, y + 6), tag, font=small, fill=(255, 214, 80))
    out = os.path.join(HERE, 'sheet_%s.jpg' % cid); im.save(out, quality=88)
    return out, n

if __name__ == '__main__':
    ids = [a for a in sys.argv[1:] if a in CONCEPTS] or list(CONCEPTS)
    jobs = [(c, i) for c in ids for i in range(4)]
    total = 0
    with ThreadPoolExecutor(5) as ex:
        for out, st, cost in ex.map(gen, jobs):
            total += cost; print(os.path.basename(out), st, cost, flush=True)
    for c in ids: print('SHEET', *sheet(c), flush=True)
    print('TOTAL COST %.2f' % total)
