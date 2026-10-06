"""One painting with one or more reference images.
usage: python3 gen_ref.py <name> <aspect> "<prompt>" <ref1> [ref2 ...] -> raw/<name>.png, logs spend.jsonl."""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.expanduser(os.environ.get('OR_KEY', '~/.openclaw/credentials/openrouter-isabelle.key'))).read().strip()
def url(p):
    im = Image.open(os.path.join(HERE, p)).convert('RGB'); im.thumbnail((1254, 1254))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
name, aspect, what, refs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
body = {'model': 'openai/gpt-5.4-image-2', 'modalities': ['image', 'text'],
        'image_config': {'aspect_ratio': aspect, 'image_size': os.environ.get('SIZE', '1K')},
        'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': what}] +
                     [{'type': 'image_url', 'image_url': {'url': url(r)}} for r in refs]}],
        'usage': {'include': True}}
req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                             headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
t = time.time(); d = json.load(urllib.request.urlopen(req, timeout=480))
cost = d.get('usage', {}).get('cost'); imgs = d['choices'][0]['message'].get('images') or []
if not imgs: print('no image', cost, json.dumps(d)[:400]); sys.exit(1)
im = Image.open(io.BytesIO(base64.b64decode(imgs[0]['image_url']['url'].split(',', 1)[1]))).convert('RGB')
os.makedirs(os.path.join(HERE, 'raw'), exist_ok=True); im.save(os.path.join(HERE, 'raw', name + '.png'))
open(os.path.join(HERE, 'spend.jsonl'), 'a').write(json.dumps({'name': name, 'cost': cost, 't': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
print('ok %s %.0fs cost=%s size=%s' % (name, time.time() - t, cost, im.size))
