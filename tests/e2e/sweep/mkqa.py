"""Regenerates repo/QA-FRANK.md from defects.json (list of {id, sev, title, steps, expected, actual, shot, where, status, fix}) plus covered.json.
Usage: python3 tests/e2e/sweep/mkqa.py"""
import json, os
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.abspath(os.path.join(H, '..', '..', '..'))
D = json.load(open(os.path.join(H, 'defects.json')))
C = json.load(open(os.path.join(H, 'covered.json')))
out = ['# QA-FRANK: browser playtest sweep of v2-core (P5)', '',
       'Server under test: `repo/` head `%s`, play money only, throwaway data. Re-run: `%s`.' % (C['head'], C['rerun']), '',
       'Severity: S1 money or stuck table, S2 wrong or misleading, S3 looks. Status: open, fixed (commit), known.', '']
order = {'S1': 0, 'S2': 1, 'S3': 2}
D.sort(key=lambda d: (order[d['sev']], d['id']))
out.append('| id | sev | status | title |'); out.append('|---|---|---|---|')
for d in D: out.append('| %s | %s | %s | %s |' % (d['id'], d['sev'], d.get('status', 'open'), d['title']))
out.append('')
for d in D:
    out += ['## %s (%s) %s' % (d['id'], d['sev'], d['title']), '',
            '- Status: %s' % d.get('status', 'open') + ((' ' + d['fix']) if d.get('fix') else ''),
            '- Steps: %s' % d['steps'], '- Expected: %s' % d['expected'], '- Actual: %s' % d['actual']]
    if d.get('where'): out.append('- Where: %s' % d['where'])
    for k in ('shot', 'shot2'):
        if d.get(k): out.append('- Evidence: ![](qa/v2-sweep/%s)' % d[k])
    out.append('')
out += ['## Covered', ''] + ['- ' + x for x in C['covered']] + ['', '## NOT covered', ''] + ['- ' + x for x in C['not_covered']] + ['']
open(os.path.join(R, 'QA-FRANK.md'), 'w').write('\n'.join(out))
print('wrote QA-FRANK.md with %d defects' % len(D))
