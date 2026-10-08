#!/usr/bin/env python3
# Independent check of one Campaign Trail browser leg: the leg JSON against its OWN replay of that leg's money.jsonl (no code shared with leg.js).
# usage: lead-check-leg.py <leg.json>=<money.jsonl> [...]    exit 0 = PASS, 1 = FAIL
import json, sys, re, collections
LEVELS = [100, 200, 500, 1000, 2500]
def check(jf, ledger):
    d = json.load(open(jf)); bad = []; key = d['key']; cur = d['mode']; other = 'chips' if cur == 'play' else 'play'
    acct = {'play': 'play:' + key, 'chips': 'bank:' + key}
    bal = collections.Counter(); runs = {}
    for line in open(ledger):
        line = line.strip()
        if not line: continue
        e = json.loads(line); legs = e.get('batch') or [e]
        m = re.match(r'campaign:([^:]+):([0-9a-f]+):(open|close|void)', e.get('ref', ''))
        for l in legs:
            c = l['cur'] if 'cur' in l else e['cur']; a = l['amount']
            bal[(l['from'], c)] -= a; bal[(l['to'], c)] += a
            if m and m.group(1) == key:
                r = runs.setdefault(m.group(2), {'kinds': [], 'delta': collections.Counter(), 'cur': c, 'reasons': []})
                if l['to'] == acct[c]: r['delta'][c] += a
                if l['from'] == acct[c]: r['delta'][c] -= a
        if m and m.group(1) == key: runs[m.group(2)]['kinds'].append(m.group(3)); runs[m.group(2)]['reasons'].append(e.get('reason'))
    s = collections.Counter()
    for (a, c), v in bal.items(): s[c] += v
    if any(s.values()): bad.append('ledger does not sum to 0 per currency: %s' % dict(s))
    neg = [(a, c, v) for (a, c), v in bal.items() if v < 0 and not a.startswith(('mint:', 'house:', 'fx:', 'admin:'))]
    if neg: bad.append('negative holder: %s' % neg)
    esc = [(a, c, v) for (a, c), v in bal.items() if a.startswith('escrow:') and v]
    if esc: bad.append('open escrow: %s' % esc)
    R = d['rounds']; prev = d['startBalance']['ledger']; seen = set()
    if d['startBalance']['screen'] != prev: bad.append('start screen %s != ledger %s' % (d['startBalance']['screen'], prev))
    for r in R:
        i = r['i']; rid = r.get('roundId')
        if r['before'] != prev: bad.append('r%d before %s != previous after %s' % (i, r['before'], prev))
        if rid in seen: bad.append('r%d round id reused' % i)
        seen.add(rid)
        run = runs.get(rid)
        if not run: bad.append('r%d round %s not in the ledger' % (i, rid)); prev = r['after']; continue
        if run['kinds'].count('open') != 1 or len(run['kinds']) != 2 or run['kinds'][1] not in ('close', 'void'): bad.append('r%d ledger lines of the run: %s' % (i, run['kinds']))
        want = -r['bet'] + r['win']
        if run['delta'][cur] != want: bad.append('r%d ledger delta %s != -bet+win %s' % (i, run['delta'][cur], want))
        if r['after'] != r['before'] + run['delta'][cur]: bad.append('r%d after %s != before + ledger delta' % (i, r['after']))
        if r['reason'] == 'scandal' and r['win'] != 0: bad.append('r%d scandal paid %s' % (i, r['win']))
        if r['reason'] == 'withdrawn' and r['win'] != r['bet']: bad.append('r%d withdraw did not refund the stake' % i)
        if r['reason'] in ('cashout', 'timeout') and r['win'] != r['bet'] * r['mx'] // 100: bad.append('r%d win %s != bet*mx/100' % (i, r['win']))
        if not (r['screen'] == r['plate'] == r['after']): bad.append('r%d screen %s / plate %s / ledger %s' % (i, r['screen'], r['plate'], r['after']))
        if not all(r['checks'].values()): bad.append('r%d checks %s' % (i, [k for k, v in r['checks'].items() if not v]))
        if r['toasts'] or r['errEvents'] or r['consoleErrors'] or r['badResponses']: bad.append('r%d toasts/errors: %s %s %s %s' % (i, r['toasts'], r['errEvents'], r['consoleErrors'], r['badResponses']))
        if r['afterOther'] != r['beforeOther']: bad.append('r%d other currency moved' % i)
        prev = r['after']
    extra = set(runs) - seen
    if extra: bad.append('ledger runs the JSON does not list: %s' % sorted(extra))
    if bal[(acct[cur], cur)] != prev: bad.append('replayed balance %s != last after %s' % (bal[(acct[cur], cur)], prev))
    e = d.get('end')
    if not e: bad.append('no end block (leg unfinished)')
    else:
        seat = sum(v for (a, c), v in bal.items() if a.startswith('seat:') and a.endswith(':' + key) and c == cur)
        if not (e['screen'] == e['ledger'] == prev and e['plate'] == prev + seat): bad.append('end block disagrees (seat %s) %s' % (seat, e))
        if e['escrowsNonZero'] or any(e['sumByCurrency'].values()): bad.append('end escrow/sum')
    # coverage of the plan
    kinds = collections.Counter(r['kind'] for r in R); stakes = collections.Counter(r['stake'] for r in R); how = collections.Counter(r['homeHow'] for r in R)
    if len(R) != 33: bad.append('rounds %d != 33' % len(R))
    if any(stakes[x] < 2 for x in LEVELS): bad.append('stakes not all >= 2: %s' % dict(stakes))
    need = {'cash1': 1, 'cash2': 1, 'cash5': 1, 'withdraw': 1, 'scandal1': 1, 'scandal2': 1, 'scandal4': 1, 'idle': 1, 'reload_mid': 1, 'reload_open': 1}
    for k, n in need.items():
        if kinds[k] < n: bad.append('plan lacks %s' % k)
    if sum(1 for r in R if r['kind'].startswith('eight') and r.get('options0') == 8) < 1: bad.append('no 8-option state played')
    if how['map'] < 2: bad.append('map-tap homes %d < 2' % how['map'])
    steps_ok = {r['kind']: r['endSteps'] for r in R}
    if d.get('consoleErrors') or d.get('badResponses'): bad.append('console/bad responses: %s %s' % (d.get('consoleErrors'), d.get('badResponses')))
    if d.get('fails'): bad.append('fails: %s' % json.dumps(d['fails'])[:400])
    if d.get('pass') is not True: bad.append('pass flag %s' % d.get('pass'))
    reasons = collections.Counter(r['reason'] for r in R)
    print('%-9s %s %s docked=%s rounds=%d ledger runs=%d start=%d end=%d reasons=%s stakes=%s homes=%s  %s' % (d['leg'], d['viewport'], cur, d.get('docked'), len(R), len(runs), d['startBalance']['ledger'], prev, dict(reasons), dict(sorted(stakes.items())), dict(how), 'OK' if not bad else 'BAD'))
    for b in bad: print('    !!', b)
    return not bad
ok = True
for a in sys.argv[1:]:
    jf, led = a.split('=')
    ok &= check(jf, led)
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
