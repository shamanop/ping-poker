"""FB4 painted-UI sheet generator (chris 10-06 FB4). Same model and pipeline as gen_ref.py, but: reads the MAIN key (OR_KEY path overrides), checks the account balance
before the call, refuses past the wave budget (BUDGET, default 6.00 USD of paint_* entries in spend.jsonl), logs every call.
usage: python3 paint_gen.py <name> <aspect> "<prompt>" <ref1> [ref2 ...]  -> raw/paint_<name>.png   (refs are paths relative to this folder)"""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
KEYF = os.path.expanduser(os.environ.get('OR_KEY', '~/.openclaw/credentials/openrouter.key'))
KEY = open(KEYF).read().strip(); BUDGET = float(os.environ.get('BUDGET', '6.00'))
H = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
def balance():
    d = json.load(urllib.request.urlopen(urllib.request.Request('https://openrouter.ai/api/v1/credits', headers=H), timeout=30))['data']
    return d['total_credits'] - d['total_usage']
def spent():
    t = 0.0
    for l in open(os.path.join(HERE, 'spend.jsonl')):
        try: j = json.loads(l)
        except Exception: continue
        if str(j.get('name', '')).startswith('paint_'): t += j.get('cost') or 0
    return t
def url(p):
    im = Image.open(os.path.join(HERE, p)).convert('RGB'); im.thumbnail((1254, 1254))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
name, aspect, what, refs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
bal, sp = balance(), spent()
print('balance %.2f, wave spend so far %.2f of %.2f' % (bal, sp, BUDGET))
if sp + 0.25 > BUDGET or bal < 0.5: print('STOP: budget'); sys.exit(2)
body = {'model': 'openai/gpt-5.4-image-2', 'modalities': ['image', 'text'],
        'image_config': {'aspect_ratio': aspect, 'image_size': os.environ.get('SIZE', '1K')},
        'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': what}] + [{'type': 'image_url', 'image_url': {'url': url(r)}} for r in refs]}],
        'usage': {'include': True}}
req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(), headers=H)
t = time.time(); d = json.load(urllib.request.urlopen(req, timeout=480))
cost = d.get('usage', {}).get('cost'); imgs = d['choices'][0]['message'].get('images') or []
open(os.path.join(HERE, 'spend.jsonl'), 'a').write(json.dumps({'name': 'paint_' + name, 'cost': cost, 't': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
if not imgs: print('no image', cost, json.dumps(d)[:400]); sys.exit(1)
im = Image.open(io.BytesIO(base64.b64decode(imgs[0]['image_url']['url'].split(',', 1)[1]))).convert('RGB')
im.save(os.path.join(HERE, 'raw', 'paint_' + name + '.png'))
print('ok %s %.0fs cost=%s size=%s' % (name, time.time() - t, cost, im.size))
