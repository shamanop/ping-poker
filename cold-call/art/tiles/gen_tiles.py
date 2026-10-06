"""COLD CALL tile / prop design sheets in the look of concept still A1 (Chris's pick, 2026-10-05 18:45).
usage: python3 gen_tiles.py [1 2 ...] -> raw/T<n>.png, sheet_T<n>.jpg, spend.jsonl (skips files that exist).
A1 is passed as the style reference. No text is generated in the art; sheet titles are drawn by PIL."""
import base64, io, json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw'); os.makedirs(RAW, exist_ok=True)
REF = os.path.join(HERE, '..', 'concepts', 'raw', 'A1.png')
KEY = open(os.path.expanduser('~/.openclaw/credentials/openrouter-isabelle.key')).read().strip()
MODEL = 'openai/gpt-5.4-image-2'

LOOK = (
    "IMAGE 1 is the approved hero painting for our comedy slot-machine game about a burnt-out call-center salesman. "
    "Paint a DESIGN SHEET in EXACTLY the same hand: the same hand-painted gouache magazine-caricature style, the same "
    "visible brushwork and lovingly overdone detail, the same warm palette (cream, mustard, cigarette-yellow light, "
    "browns, brick red accents), the same late-1980s boiler-room office world.\n"
    "LAYOUT: six separate designs in a tidy grid, three across and two down, evenly spaced, the same size, none "
    "touching or overlapping. Each design sits alone on a flat, plain, dark slate-blue background with a soft drop "
    "shadow, lit from the upper left. These become slot-reel tiles, so each one is chunky and bold with a clear "
    "silhouette that still reads at thumbnail size.\n"
    "HARD RULES: no text, letters, numbers, logos or brand names anywhere. Labels, notes, screens, cards and buttons "
    "are blank. No captions, no grid lines, no frame around the sheet.\n")

SHEETS = {
    1: ("HIGH PAYS + WILD", ["wild: manic grin", "wild: screaming", "cash wad", "gold money sign", "powder pile", "pill bottle"],
        "THE SIX DESIGNS, left to right, top row then bottom row:\n"
        "1. The salesman's head alone, the same man as IMAGE 1: bulging bloodshot eyes, manic gritted grin, hair on end, "
        "sweat flying, phone handset jammed to his ear.\n"
        "2. The same man's head mid-scream of triumph, mouth wide open, eyes even bigger, tie flying up.\n"
        "3. A fat rubber-banded wad of green banknotes, a few notes peeling off (the notes have plain engraved patterns, no "
        "numbers or faces).\n"
        "4. A big solid gold money sign, sculpted like a dented trophy, gleaming.\n"
        "5. A small cartoon mountain of white powdered sugar with a powdered donut half-buried on its peak, on a paper plate.\n"
        "6. An orange pill bottle tipped over, white cap off, blank white label, round white tablets spilling out."),
    2: ("LOW + MID PAYS", ["headset", "energy can", "coffee mug", "sticky notes", "stress ball", "cup tower"],
        "THE SIX DESIGNS, left to right, top row then bottom row:\n"
        "1. A battered beige call-center headset with a bent microphone boom and a frayed curly cord.\n"
        "2. A crushed plain silver energy drink can, dented in the middle, a drip at the opening.\n"
        "3. A chipped cream coffee mug, stained rings, steam rising, coffee slopping over the rim.\n"
        "4. A pad of yellow sticky notes, the top notes curling up and peeling away, all blank.\n"
        "5. A red foam stress ball crushed in a clenched, white-knuckled fist, veins popping.\n"
        "6. A leaning tower of stacked empty paper coffee cups about to topple."),
    3: ("SCATTER + BONUS SYMBOLS", ["rotary phone", "golden phone", "quote bubble", "upsell bubble", "handset", "desk bell"],
        "THE SIX DESIGNS, left to right, top row then bottom row:\n"
        "1. A beige rotary desk phone ringing violently, handset jumping off the cradle, motion lines, curly cord whipping. "
        "The dial holes are empty: no numbers.\n"
        "2. The same rotary phone cast in gleaming gold with a warm glow and sparkles around it.\n"
        "3. A plump rounded text-message speech bubble, glossy green, completely blank inside, a small tail at the lower left.\n"
        "4. The same speech bubble in shining gold with a starburst behind it, completely blank inside.\n"
        "5. A single beige phone handset with a long curly cord tied in a knot.\n"
        "6. A brass desk call bell being slammed by a hand, ring lines radiating."),
    4: ("BONUS SCREENS + BUTTONS", ["dial close-up", "card machine", "blank card", "spin button", "approved seal", "desk frame"],
        "THE SIX DESIGNS, left to right, top row then bottom row:\n"
        "1. A rotary phone dial seen straight from above, large: ten empty finger holes, a metal finger stop, a blank "
        "centre disc. No numbers.\n"
        "2. A chunky 1980s credit card imprint machine with a blank carbon slip in it.\n"
        "3. A blank gold credit card at a jaunty angle with a plain chip shape and nothing printed on it.\n"
        "4. A big round red push button on a beige plastic base, worn and shiny from being hammered, completely blank.\n"
        "5. A round green wax-and-ribbon seal with a bold check mark shape pressed into it.\n"
        "6. An empty wood-panelled picture-frame shaped like a cubicle wall, with sticky notes and a phone cord draped "
        "over its corners, the middle empty and flat slate-blue."),
    5: ("THE SALESMAN: MOODS", ["idle twitch", "hype", "shock", "big win", "rage", "passed out"],
        "THE SIX DESIGNS are six half-body poses of the SAME man as IMAGE 1 (same face, hair, sweat-stained cream shirt, "
        "suspenders, red tie), left to right, top row then bottom row:\n"
        "1. Idle: phone to his ear, eye twitching, drumming his fingers, grin frozen.\n"
        "2. Hype: pumping one fist in the air, phone still clamped to his ear, teeth bared in joy.\n"
        "3. Shock: jaw dropped to his chest, eyes popping out, phone slipping out of his hand.\n"
        "4. Big win: both arms flung up, banknotes raining around him, howling with delight.\n"
        "5. Rage: slamming the handset down so hard it cracks, hair wilder, face red.\n"
        "6. Passed out: face-down on the desk among coffee cups, phone still gripped in one hand, a little drool."),
}

def ref_url():
    im = Image.open(REF).convert('RGB'); im.thumbnail((832, 1248))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=92)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def gen(n):
    out = os.path.join(RAW, 'T%d.png' % n)
    if os.path.exists(out): return n, 'skip', 0
    body = {'model': MODEL, 'modalities': ['image', 'text'],
            'image_config': {'aspect_ratio': '3:2', 'image_size': '1K'},
            'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': LOOK + SHEETS[n][2]},
                                                      {'type': 'image_url', 'image_url': {'url': ref_url()}}]}],
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
                last = 'no image: ' + json.dumps(d['choices'][0]['message'].get('content'))[:200]; continue
            raw = base64.b64decode(imgs[0]['image_url']['url'].split(',', 1)[1])
            Image.open(io.BytesIO(raw)).convert('RGB').save(out)
            open(os.path.join(HERE, 'spend.jsonl'), 'a').write(json.dumps(
                {'name': 'T%d.png' % n, 'cost': cost, 't': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
            return n, 'ok', cost
        except urllib.error.HTTPError as e:
            last = 'HTTP %s %s' % (e.code, e.read().decode(errors='replace')[:200]); time.sleep(15 * (a + 1))
        except Exception as e:
            last = 'ERR %s' % e; time.sleep(10)
    return n, last, 0

def sheet(n):
    """Title band on top, the six names under the picture in grid order."""
    p = os.path.join(RAW, 'T%d.png' % n)
    if not os.path.exists(p): return None
    f = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    title, names, _ = SHEETS[n]
    art = Image.open(p).convert('RGB'); W = 1500
    art = art.resize((W, round(art.height * W / art.width)), Image.LANCZOS)
    big, small = ImageFont.truetype(f, 46), ImageFont.truetype(f, 26)
    head, foot = 78, 92
    im = Image.new('RGB', (W, head + art.height + foot), (18, 18, 20)); dr = ImageDraw.Draw(im)
    dr.text((16, 14), 'COLD CALL  ·  sheet %d  ·  %s' % (n, title), font=big, fill=(245, 240, 225))
    im.paste(art, (0, head))
    for i, nm in enumerate(names):
        tag = '%d%s  %s' % (n, 'abcdef'[i], nm)
        dr.text((16 + (i % 3) * (W // 3), head + art.height + 10 + (i // 3) * 38), tag, font=small, fill=(255, 214, 80))
    out = os.path.join(HERE, 'sheet_T%d.jpg' % n); im.save(out, quality=90)
    return out

if __name__ == '__main__':
    ids = [int(a) for a in sys.argv[1:] if a.isdigit() and int(a) in SHEETS] or list(SHEETS)
    total = 0
    with ThreadPoolExecutor(5) as ex:
        for n, st, cost in ex.map(gen, ids):
            total += cost; print('T%d' % n, st, cost, flush=True)
    for n in ids: print('SHEET', sheet(n), flush=True)
    print('TOTAL COST %.2f' % total)
