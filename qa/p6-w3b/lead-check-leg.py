#!/usr/bin/env python3
# close-out lead's own check of one chain leg: the leg JSON against an independent replay of that leg's money.jsonl
import json,sys,re,collections
def check(jf, ledger):
    d=json.load(open(jf)); bad=[]
    key=re.search(r'\(key (\S+)\)', d['notes'][0]).group(1); cur=d['mode']
    acct=('play:' if cur=='play' else 'bank:')+key
    bal=collections.Counter(); byref={}; tot=collections.Counter()
    for line in open(ledger):
        e=json.loads(line); legs=e.get('batch') or [e]
        for l in legs:
            c=l.get('cur'); a=l['amount']
            bal[(l['from'],c)]-=a; bal[(l['to'],c)]+=a; tot[c]+=0
            m=re.match(r'coldcall:[^:]+:([0-9a-f]+)', e.get('ref',''))
            if m and c==cur:
                r=byref.setdefault(m.group(1),0)
                if l['from']==acct: byref[m.group(1)]-=a
                if l['to']==acct: byref[m.group(1)]+=a
    # conservation: every currency sums to zero over all accounts
    s=collections.Counter()
    for (a,c),v in bal.items(): s[c]+=v
    if any(s.values()): bad.append('ledger does not sum to 0: %s'%dict(s))
    neg=[(a,c,v) for (a,c),v in bal.items() if v<0 and not a.startswith(('mint:','house:','fx:'))]
    if neg: bad.append('negative holder: %s'%neg)
    esc=[(a,c,v) for (a,c),v in bal.items() if 'escrow' in a and v]
    if esc: bad.append('open escrow: %s'%esc)
    R=d['rounds']; prev=d['startBalance']['ledger']; seen=set(); nround=0
    for r in R:
        if r['before']!=prev: bad.append('r%d before %s != previous after %s'%(r['i'],r['before'],prev))
        if r['after']!=r['before']-r['cost']+r['win']+r.get('pot',0) and r['after']!=r['before']-r['cost']+r['win']: bad.append('r%d arithmetic'%r['i'])
        if r['meter']!=r['after'] or r['screenBefore']!=r['before']: bad.append('r%d meter'%r['i'])
        if not all(r['checks'].values()): bad.append('r%d checks %s'%(r['i'],[k for k,v in r['checks'].items() if not v]))
        if r['toasts'] or r['errs']: bad.append('r%d toasts/errs'%r['i'])
        rid=r.get('roundId')
        if r['serverRounds']==1:
            nround+=1
            if rid in seen: bad.append('r%d round id reused'%r['i'])
            seen.add(rid)
            if rid not in byref: bad.append('r%d round %s not in the ledger'%(r['i'],rid))
            elif byref[rid]!=r['after']-r['before']: bad.append('r%d ledger delta %s != json %s'%(r['i'],byref[rid],r['after']-r['before']))
        elif r['serverRounds']==0:
            if r['after']!=r['before']: bad.append('r%d zero rounds but balance moved'%r['i'])
        else: bad.append('r%d serverRounds %s'%(r['i'],r['serverRounds']))
        prev=r['after']
    extra=set(byref)-seen
    if extra: bad.append('ledger rounds the JSON does not list: %s'%sorted(extra))
    if bal[(acct,cur)]!=prev: bad.append('replayed balance %s != last after %s'%(bal[(acct,cur)],prev))
    e=d.get('end')
    if not e: bad.append('no end block (leg unfinished)')
    else:
        seat=sum(v for (a,c),v in bal.items() if a.startswith('seat:') and a.endswith(':'+key) and c==cur)  # a docked leg sits at a poker table: the shell plate shows bank + stack
        if not (e['screen']==e['wallet_get']==e['ledger']==prev and e['plate']==e['plateWant']==prev+seat): bad.append('end block disagrees (my seat total %s) %s'%(seat,e))
        if seat: print('   (seat stack at the poker table, from my replay: %d)'%seat)
        if e['escrowsNonZero'] or any(e['sumByCurrency'].values()): bad.append('end escrow/sum')
    forced=set(d.get('forced',{})); want=set(d.get('engineForces',[]))
    if want-forced: bad.append('forces not played: %s'%sorted(want-forced))
    buys={b['id'] for b in d.get('buys',[]) if b.get('ok')}; menu={b['id'] for b in d.get('buyMenu',[])}
    if menu-buys: bad.append('buys not played: %s'%sorted(menu-buys))
    cases=d.get('cases',{})
    for c in ('dbl','triple','spinWhileDecision','dblBuy','dblConfirm'):
        if not cases.get(c,{}).get('ok'): bad.append('case %s not ok: %s'%(c,cases.get(c)))
    if d.get('consoleErrors') or d.get('badResponses'): bad.append('console/bad responses: %s %s'%(d.get('consoleErrors'),d.get('badResponses')))
    if d.get('fails'): bad.append('fails: %s'%json.dumps(d['fails'])[:400])
    if d.get('pass') is not True: bad.append('pass flag %s'%d.get('pass'))
    if d.get('quick'): bad.append('quick run, not the full leg')
    big=d.get('big') or {}
    dec=d.get('decisions')
    print('%-22s %s %s docked=%s rounds=%d (actions %d) ledger rounds=%d start=%d end=%d forces=%d/%d buys=%d/%d decisions=%s big=%s x%s  %s' % (d['leg'],d['viewport'],cur,d.get('docked'),nround,len(R),len(byref),d['startBalance']['ledger'],prev,len(forced&want),len(want),len(buys&menu),len(menu),json.dumps(dec),big.get('tier'),(big.get('win',0)//max(1,big.get('bet',1))), 'OK' if not bad else 'BAD'))
    for b in bad: print('    !!',b)
    return not bad
ok=True
for a in sys.argv[1:]:
    jf,led=a.split('=')
    ok&=check(jf,led)
sys.exit(0 if ok else 1)
