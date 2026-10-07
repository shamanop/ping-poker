"""FB4: register every assets/img/ui/ui_*.webp as a piece in assets/symbols.json (CSS gets --img-ui_<name>, assets.js preloads it). Run from the repo root."""
import json, os
P = 'public/games/coldcall/assets/symbols.json'; d = json.load(open(P))
for f in sorted(os.listdir('public/games/coldcall/assets/img/ui')):
    if f.startswith('ui_') and f.endswith('.webp'): d['pieces'][f[:-5]] = 'img/ui/' + f
open(P, 'w').write(json.dumps(d, indent=2, ensure_ascii=False))
print(len([k for k in d['pieces'] if k.startswith('ui_')]), 'ui pieces')
