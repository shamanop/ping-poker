'use strict';
// Money 1008 ZS-4: the games' own state files at the fresh start at zero.
//   node tests/money-1008-zs-games.js          (ZS_SKIP_TOOL=1 leaves the tool step out: the test must then be RED)
// Cold Call (coldcall-pull.json) keeps leads, an armed Callback and open rounds per player AND per mode; Campaign (campaign.json) keeps open runs. If they survive the fresh start, state earned with
// PRETEND Cash pays REAL Cash after it (an armed Cash Callback is played free at its stored bet; Cash leads arm one within a few paid spins). Proof: _scratch/money/fix-zs-games/FOUND-1.md.
// The REAL server.js is booted (DATA_DIR only, SIGNUP_PLAY_CENTS=0; tests/v2/lib.js supplies only the socket Bot; ports V2_PORT_BASE (5845) + 0..1):
//   1. an "old life": players get Cash by the admin path; Ann holds an ARMED Cash Callback, Bob Cash leads at 0.89 of the list (both written with the store's own setPlayer), Dee an open Cash Campaign
//      run, Cy an open Cash Cold Call decision round (escrows in the ledger); Eve holds CHIPS leads and an armed CHIPS Callback, Fay an open CHIPS Campaign run; server stopped;
//   2. the fresh start as RUNBOOK says (money files moved aside, bank.json = {}), then tools/zero-game-state.js --apply (dry run first: changes nothing; refuses while money.jsonl.lock is there);
//   3. boot; the admin sets Cash 50.00 on each; every Cash spin after the zero: no Callback, no free round, no Cash credit without a stake; the old round / run are gone; Eve's Chips Callback still plays;
//   4. the files: no Cash state left in coldcall-pull.json / campaign.json, the Chips half equal to what it was, the originals in the zeroed folder; the config files untouched; the ledger sums to 0.
// Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn, spawnSync } = require('child_process');
const L = require('./v2/lib.js');
const { createStore } = require('../games/coldcall-store.js');
const CE = require('../games/campaign-engine.js');

const SKIP_TOOL = process.env.ZS_SKIP_TOOL === '1';
const TOOL = path.join(__dirname, '..', 'tools', 'zero-game-state.js');
const PORT_BASE = Number(process.env.V2_PORT_BASE) || 5845;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } return c; };
const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zs-games-'));
const procs = new Set();
process.on('exit', () => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

// what the RUNBOOK fresh start moves aside (same list as tests/money-1008-zero-start.js ZERO_FILES)
const ZERO_FILES = ['money.jsonl', 'money.jsonl.ckpt', 'money.jsonl.ckpt.tmp', 'money.jsonl.ckpt.bad', 'money.jsonl.lock', 'money.jsonl.quarantine',
  'bank.json', 'wallet.json', 'stacks.json', 'bank.json.pre-v2', 'wallet.json.pre-v2', 'stacks.json.pre-v2', 'accounts.json.pre-v2'];
const portOpen = (port) => new Promise(res => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
async function startReal(dir, off) {
  const port = PORT_BASE + off, logf = path.join(root, `server-${off}.log`);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_CLAIM_PASSWORD: L.ADMIN_CLAIM, AUTH_SIGNUP_LIMIT: '100000', SIGNUP_PLAY_CENTS: '0' };
  for (const k of ['NODE_OPTIONS', 'NODE_ENV', 'BANK_FILE', 'MONEY_FILE', 'ACCOUNTS_FILE', 'LEDGER_FILE', 'RIG', 'FRESH_START_ID', 'LEGACY_IMPORT_FILE', 'RAILWAY_VOLUME_MOUNT_PATH', 'COLDCALL_PULL_FILE', 'CAMPAIGN_FILE']) delete env[k];
  const fd = fs.openSync(logf, 'a');
  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', fd, fd], env }); procs.add(proc);
  let up = false;
  for (let i = 0; i < 600 && proc.exitCode === null; i++) { if (await portOpen(port)) { up = true; break; } await L.sleep(25); }
  if (!up) throw new Error('server did not start on ' + port + ': ' + fs.readFileSync(logf, 'utf8').split('\n').slice(-4).join(' | ').slice(0, 300));
  await L.sleep(100);
  return { port, clients: [], log: () => fs.readFileSync(logf, 'utf8'),
    async stop(sig = 'SIGTERM') { try { proc.kill(sig); } catch {} await new Promise(r => { if (proc.exitCode !== null || proc.signalCode) return r(); proc.once('exit', r); setTimeout(r, 5000); }); procs.delete(proc); } };
}
const journal = (dir) => { try { return fs.readFileSync(path.join(dir, 'money.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); } catch { return []; } };
const legs = (r) => (r.batch || [r]);
function nets(dir) { const n = {}; for (const r of journal(dir)) for (const l of legs(r)) { if (!l.from) continue; const k = l.cur + '|'; n[k + l.from] = (n[k + l.from] || 0) - l.amount; n[k + l.to] = (n[k + l.to] || 0) + l.amount; } return n; }
const bal = (dir, cur, key) => nets(dir)[cur + '|' + (cur === 'play' ? 'play:' : 'bank:') + key] || 0;
const sumAll = (dir, cur) => Object.entries(nets(dir)).filter(([k]) => k.startsWith(cur + '|')).reduce((a, [, v]) => a + v, 0);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = L.sleep;

async function ccSpin(bot, payload) {
  await sleep(170);
  const p = bot.wait('g:coldcall:result', 4000), e = bot.wait('error', 4000);
  bot.emit('g:coldcall:spin', payload);
  const r = await Promise.race([p.then(x => ({ r: x })), e.then(x => ({ e: x }))]);
  return r.r ? r.r : { error: r.e || 'timeout' };
}
async function ccDecide(bot, res, d) { await sleep(170); const p = bot.wait('g:coldcall:result', 4000); bot.emit('g:coldcall:decide', { roundId: res.roundId, ...d }); return await p; }
const settleAll = async (bot, r) => { let g = 0; while (r && r.status === 'pending' && g++ < 10) r = await ccDecide(bot, r, r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false }); return r; };
const stateOf = (o) => ({ v: 1, lt: 0, avg: 0, cb: null, warm: [], warmBet: 0, coldAt: null, day: null, streak: 0, rounds: 20, callbacks: 0, carry: 0, ...o });

(async () => {
  const dir = path.join(root, 'live'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'coldcall-config.json'), JSON.stringify({ v: 1, note: 'config must survive' }));   // a config file the tool must not touch (the game reads it only when it is valid; a bad one is its own business)
  const cfgBefore = fs.readFileSync(path.join(dir, 'coldcall-config.json'));
  const PIN = { ann: '1111', bob: '2222', cy: '3333', dee: '4444', eve: '5555', fay: '6666' };
  let srv = await startReal(dir, 0);
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bots = {};
  for (const [k, pin] of Object.entries(PIN)) { bots[k] = new L.Bot(srv, k[0].toUpperCase() + k.slice(1)); await bots[k].connect(); const r = await bots[k].signup(pin); if (!r.account) throw new Error('signup ' + k + JSON.stringify(r)); }
  for (const k of ['ann', 'bob', 'cy', 'dee']) { const r = await adm.req('admin_set_play', { key: k, cents: 500000, opId: 'zsg.old.' + k }, 'admin_result', 4000); if (!r.ok) throw new Error('set cash ' + k + JSON.stringify(r)); }
  for (const k of ['ann', 'bob']) for (let i = 0; i < 6; i++) await settleAll(bots[k], await ccSpin(bots[k], { bet: 10, mode: 'play' }));        // real Cash play: real stored state before the plant
  for (let i = 0; i < 6; i++) await settleAll(bots.eve, await ccSpin(bots.eve, { bet: 10, mode: 'chips' }));
  const home = Object.keys(CE.MAP.states)[0];
  const startRun = async (bot, mode) => { await sleep(200); const p = bot.wait('g:campaign:run', 4000); bot.emit('g:campaign:start', { mode, bet: mode === 'play' ? 1000 : 100, home }); const r = await p; if (!r) throw new Error('no campaign run for ' + bot.name + ': ' + bot.errors.join('|')); return r.run && (r.run.roundId || r.roundId); };
  const deeRun = await startRun(bots.dee, 'play'), fayRun = await startRun(bots.fay, 'chips');
  let open = null;                                                                                                   // last: a decision round lives only decisionMs (20 s)
  for (let i = 0; i < 80 && !open; i++) { const r = await ccSpin(bots.cy, { bet: 100, mode: 'play', buyBonus: i % 3 === 2 ? 'bonus2' : 'bonus1' }); if (r && r.status === 'pending') open = r; else if (r && r.error) throw new Error('cy spin ' + JSON.stringify(r.error)); }
  if (!open) throw new Error('no pending Cash round for cy');
  await srv.stop('SIGKILL');                                                                                         // a stop inside the decision window: the open round is on disk
  {
    const st = createStore(path.join(dir, 'coldcall-pull.json'), { log: () => {}, alarm: () => {}, confirm: () => true });      // the store's own write path, journal replayed
    st.setPlayer('ann', 'play', stateOf({ cb: { bet: 1000, id: 'zsarmed1' } }));
    st.setPlayer('bob', 'play', stateOf({ lt: 4005, avg: 1000 }));                                                  // list 450 leads = 4500 tenths; 4005 = 0.89
    st.setPlayer('eve', 'chips', stateOf({ lt: 1234, avg: 500, cb: { bet: 500, id: 'zschips1' } }));
    st.flush(); st.close();
  }
  const before = readJson(path.join(dir, 'coldcall-pull.json')), campBefore = readJson(path.join(dir, 'campaign.json'));
  ok(before.players.ann.play.cb && before.players.bob.play.lt === 4005 && before.open['cy|play'] && campBefore.open.dee && campBefore.open.fay && before.players.eve.chips.cb,
    'old life: the files hold an armed Cash Callback (Ann), Cash leads (Bob), an open Cash round (Cy), an open Cash run (Dee), Chips leads + Callback (Eve), an open Chips run (Fay)');
  const eveChips = JSON.stringify(before.players.eve.chips), fayRec = JSON.stringify(campBefore.open.fay);

  // ---- the fresh start, RUNBOOK step 3 ----
  const Z = path.join(dir, 'zeroed-20261009'); fs.mkdirSync(Z);
  for (const f of ZERO_FILES) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(Z, f));
  fs.writeFileSync(path.join(dir, 'bank.json'), '{}');
  if (!SKIP_TOOL) {
    const filesBefore = fs.readdirSync(dir).sort().join(' '), ccBytes = fs.readFileSync(path.join(dir, 'coldcall-pull.json'));
    const dry = spawnSync('node', [TOOL, '--data-dir', dir, '--zeroed-dir', Z], { encoding: 'utf8' });
    ok(dry.status === 0 && /dry run: nothing was changed/.test(dry.stdout) && fs.readdirSync(dir).sort().join(' ') === filesBefore && Buffer.compare(fs.readFileSync(path.join(dir, 'coldcall-pull.json')), ccBytes) === 0,
      'tool: the dry run exits 0, prints "nothing was changed" and leaves the data dir as it was');
    fs.writeFileSync(path.join(dir, 'money.jsonl.lock'), 'x\n');
    const locked = spawnSync('node', [TOOL, '--data-dir', dir, '--zeroed-dir', Z, '--apply'], { encoding: 'utf8' });
    ok(locked.status === 3 && /may be running/.test(locked.stderr) && fs.existsSync(path.join(dir, 'campaign.json.bak')), 'tool: with money.jsonl.lock in the data dir it refuses (exit 3) and moves nothing');
    fs.rmSync(path.join(dir, 'money.jsonl.lock'));
    const run = spawnSync('node', [TOOL, '--data-dir', dir, '--zeroed-dir', Z, '--apply'], { encoding: 'utf8' });
    console.log(run.stdout.split('\n').filter(l => /Cash state found|Chips state kept|open runs|done:/.test(l)).map(l => '  | ' + l.trim()).join('\n'));
    ok(run.status === 0 && /done: \d+ file\(s\) moved/.test(run.stdout), 'tool: --apply exits 0 (' + run.status + ')');
    ok(fs.existsSync(path.join(Z, 'coldcall-pull.json')) && fs.existsSync(path.join(Z, 'campaign.json')), 'tool: the original game files are in the zeroed folder (coldcall-pull.json, campaign.json)');
    const again = spawnSync('node', [TOOL, '--data-dir', dir, '--zeroed-dir', Z, '--apply'], { encoding: 'utf8' });
    ok(again.status === 0 && /nothing to do/.test(again.stdout), 'tool: a second run finds no Cash state and does nothing');
  }
  const cc = readJson(path.join(dir, 'coldcall-pull.json')), cp = readJson(path.join(dir, 'campaign.json'));
  const cashLeft = Object.entries(cc.players).filter(([, p]) => p.play).map(([k]) => k).concat(Object.keys(cc.open).filter(k => /\|play$/.test(k)), cc.pot.play ? ['pot.play'] : [], Object.values(cp.open).filter(r => r.cur !== 'chips').map(r => 'run:' + r.key));
  ok(cashLeft.length === 0, 'files: no Cash Cold Call state and no open Cash Campaign run left in the kept files' + (cashLeft.length ? ' (still there: ' + cashLeft.join(', ') + ')' : ''));
  ok(JSON.stringify(cc.players.eve && cc.players.eve.chips) === eveChips && !!cp.open.fay && JSON.stringify(cp.open.fay) === fayRec, 'files: Eve\'s Chips state and Fay\'s open Chips run are byte-for-byte what they were');
  ok(Buffer.compare(cfgBefore, fs.readFileSync(path.join(dir, 'coldcall-config.json'))) === 0, 'files: coldcall-config.json untouched');

  // ---- the boot ----
  srv = await startReal(dir, 1);
  await sleep(400);
  const bootLog = srv.log();
  ok(!/QUARANTINED|CONFLICTS|fresh start|\*\*\*/.test(bootLog), 'boot: clean (no QUARANTINED / CONFLICTS / fresh start / store damage line)');
  const adm2 = new L.Bot(srv, 'chris'); await adm2.connect(); const al = await adm2.req('auth_login', { name: 'chris', pin: '4321' }, 'auth_ok', 3000); if (!al.account) throw new Error('admin login');
  const b2 = {};
  for (const [k, pin] of Object.entries(PIN)) { b2[k] = new L.Bot(srv, k[0].toUpperCase() + k.slice(1)); await b2[k].connect(); const r = await b2[k].login(pin); if (!r.account) throw new Error('login ' + k); }
  for (const k of ['ann', 'bob', 'cy', 'dee']) { const s = await adm2.req('admin_set_play', { key: k, cents: 5000, opId: 'zsg.fresh.' + k }, 'admin_result', 4000); if (!s.ok) throw new Error('fresh set cash ' + k); }
  await sleep(300);

  const a = await settleAll(b2.ann, await ccSpin(b2.ann, { bet: 10, mode: 'play' }));
  ok(a && !a.error && !a.callback && a.cost > 0, `(a) Ann's first Cash spin is a paid spin, not a free Callback (callback=${a && a.callback} cost=${a && a.cost}); Cash 5000 -> ${bal(dir, 'play', 'ann')}`);
  let freeB = null, spinsB = 0;
  for (; spinsB < 60 && !freeB; spinsB++) { const r = await settleAll(b2.bob, await ccSpin(b2.bob, { bet: 10, mode: 'play' })); if (r.error) break; if (r.callback || r.cost === 0) freeB = r; }
  ok(!freeB, `(b) Bob's 60 paid Cash spins: no Callback comes from leads earned before the zero (${freeB ? 'a free round WAS played after ' + spinsB + ' spins, win ' + freeB.totalWin : 'none in ' + spinsB + ' spins'})`);
  {
    const n0 = journal(dir).length;
    const er = b2.cy.wait('error', 2000), rr = b2.cy.wait('g:coldcall:result', 2000); b2.cy.emit('g:coldcall:decide', { roundId: open.roundId, ...(open.pending.k === 'pick' ? { k: 'pick', p: open.pending.choices[0] } : { k: 'more', take: false }) });
    const got = await Promise.race([er.then(x => x && { e: x }), rr.then(x => x && { r: x })]); await sleep(300);
    ok(!!(got && got.e) && journal(dir).length === n0 && bal(dir, 'play', 'cy') === 5000, `(c1) Cy's old Cash round gives an error (${got && got.e ? got.e.code : 'none'}), writes no ledger line, Cash stays 5000`);
  }
  {
    const n0 = journal(dir).length;
    const er = b2.dee.wait('error', 2000), rr = b2.dee.wait('g:campaign:result', 2000); b2.dee.emit('g:campaign:cash', { roundId: deeRun });
    const got = await Promise.race([er.then(x => x && { e: x }), rr.then(x => x && { r: x })]); await sleep(300);
    ok(!!(got && got.e) && journal(dir).length === n0 && bal(dir, 'play', 'dee') === 5000, `(c2) Dee's old Cash run gives an error (${got && got.e ? got.e.code : 'none'}), writes no ledger line, Cash stays 5000`);
  }
  const e1 = await settleAll(b2.eve, await ccSpin(b2.eve, { bet: 10, mode: 'chips' }));
  ok(e1 && !e1.error && e1.callback === true && e1.cost === 0, `Chips kept: Eve's armed Chips Callback still plays free (callback=${e1 && e1.callback} cost=${e1 && e1.cost})`);
  await sleep(300);
  const cashSum = sumAll(dir, 'play'), chipSum = sumAll(dir, 'chips');
  ok(cashSum === 0 && chipSum === 0, `ledger: the sum of all Cash accounts is ${cashSum} and of all Chips accounts ${chipSum} (both must be 0)`);
  const freeCash = journal(dir).filter(r => legs(r).some(l => l.cur === 'play' && l.from === 'house:coldcall' && /^play:/.test(l.to))).length;
  console.log(`  | house:coldcall Cash credits to players after the zero: ${freeCash}; house:coldcall Cash net ${nets(dir)['play|house:coldcall'] || 0}`);
  await Promise.all(Object.values(b2).concat(adm2).map(b => b.close())); await srv.stop();
  console.log(`${pass} passed, ${fail} failed${SKIP_TOOL ? ' (ZS_SKIP_TOOL=1: the tool step was left out)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
