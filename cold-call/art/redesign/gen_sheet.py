"""One redesign piece, painted in the hand of concept A1 (the approved look).
usage: python3 gen_piece.py <name> <aspect e.g. 3:2> "<prompt>" -> raw/<name>.png, logs spend.jsonl."""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.expanduser('~/.openclaw/credentials/openrouter-isabelle.key')).read().strip()
def url(p, box):
    im = Image.open(os.path.join(HERE, p)).convert('RGB'); im.thumbnail(box)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
name, aspect, what = sys.argv[1], sys.argv[2], sys.argv[3]
PROMPT = ("IMAGE 1 is an approved sheet of slot-game symbols, hand-painted gouache caricature on flat slate blue. Same hand, same brushwork.\n" + what)
body = {'model': 'openai/gpt-5.4-image-2', 'modalities': ['image', 'text'],
        'image_config': {'aspect_ratio': aspect, 'image_size': '1K'},
        'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT},
                     {'type': 'image_url', 'image_url': {'url': url('../tiles/raw/T2.png', (1254, 836))}}]}],
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
