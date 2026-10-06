"""One tile alone, in the look of sheet T1 (which was painted from concept A1).
usage: python3 gen_one.py <name> "<what to paint>" -> raw/<name>.png + <name>.jpg, logs spend.jsonl."""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.expanduser('~/.openclaw/credentials/openrouter-isabelle.key')).read().strip()
def url(p, box):
    im = Image.open(os.path.join(HERE, p)).convert('RGB'); im.thumbnail(box)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=92)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
name, what = sys.argv[1], sys.argv[2]
PROMPT = ("IMAGE 1 is an approved design sheet of slot-game tiles, hand-painted in gouache caricature style on a flat dark "
          "slate-blue background. Paint ONE new tile in exactly that hand: same brushwork, same warm cream palette, same "
          "light from the upper left, same soft drop shadow, same flat plain slate-blue background.\n"
          "THE TILE: " + what + "\n"
          "It sits alone in the middle of a square picture with a little space around it: chunky, bold, a clear silhouette "
          "that reads at thumbnail size. No text, letters, numbers or logos. No frame, no other objects.")
body = {'model': 'openai/gpt-5.4-image-2', 'modalities': ['image', 'text'],
        'image_config': {'aspect_ratio': '1:1', 'image_size': '1K'},
        'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT},
                     {'type': 'image_url', 'image_url': {'url': url('raw/T1.png', (1254, 836))}}]}],
        'usage': {'include': True}}
req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                             headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
t = time.time(); d = json.load(urllib.request.urlopen(req, timeout=480))
cost = d.get('usage', {}).get('cost'); imgs = d['choices'][0]['message'].get('images') or []
if not imgs: print('no image', cost, json.dumps(d)[:400]); sys.exit(1)
im = Image.open(io.BytesIO(base64.b64decode(imgs[0]['image_url']['url'].split(',', 1)[1]))).convert('RGB')
im.save(os.path.join(HERE, 'raw', name + '.png')); im.save(os.path.join(HERE, name + '.jpg'), quality=92)
open(os.path.join(HERE, 'spend.jsonl'), 'a').write(json.dumps({'name': name, 'cost': cost, 't': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
print('ok %.0fs cost=%s size=%s' % (time.time() - t, cost, im.size))
