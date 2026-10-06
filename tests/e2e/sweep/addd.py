"""python3 addd.py '<json>'  appends/updates a defect in defects.json (key: id)."""
import json, os, sys
f = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'defects.json'); D = json.load(open(f))
n = json.loads(sys.argv[1]); D = [d for d in D if d['id'] != n['id']] + [n]; json.dump(D, open(f, 'w'), indent=1); print('ok', n['id'], len(D))
