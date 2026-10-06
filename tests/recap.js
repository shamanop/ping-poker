// Recap: scripted players play real hands; recap numbers are checked against what the clients saw. Temp files, port 3481.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppre-'));
const PORT = Number(process.env.TEST_PORT || 3481), ROOT = path.join(__dirname, '..');
const F = { bank: path.join(dir, 'bank.json'), ledger: path.join(dir, 'ledger.json'), acc: path.join(dir, 'accounts.json'), tables: path.join(dir, 'tables.json'), wallet: path.join(dir, 'wallet.json'), recap: path.join(dir, 'recap-hands.jsonl') };
fs.writeFileSync(F.bank, JSON.stringify({}));
const env = { ...process.env, PORT: String(PORT), AUTO_START_MS: '200', HAND_DELAY_MS: '120', TABLE_EMPTY_MS: '600000', AUTH_CLOCK_SKEW: '0', AUTH_SIGNUP_LIMIT: '100', BANK_FILE: F.bank, LEDGER_FILE: F.ledger, ACCOUNTS_FILE: F.acc, TABLES_FILE: F.tables, WALLET_FILE: F.wallet, RECAP_FILE: F.recap };
let proc = null;
const startServer = async () => { proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: process.env.DEBUG_SRV ? 'inherit' : 'ignore' }); for (let i = 0; i < 80; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await sleep(100); } } };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function client(label, strat) {
  const c = { label, ev: [], gs: null, tid: null, strat, sd: [], lastSig: '' };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.onAny((e, d) => c.ev.push([e, d]));
  c.s.on('game_state', g => { c.gs = g; drive(c); });
  c.s.on('showdown_result', d => c.sd.push(d));
  c.call = async (ev, payload, ...want) => {
    const start = c.ev.length; c.s.emit(ev, payload);
    for (let i = 0; i < 100; i++) { const hit = c.ev.slice(start).find(([e]) => want.includes(e)); if (hit) return hit; await sleep(30); }
    return [null, null];
  };
  return c;
}
function drive(c) {
  const g = c.gs;
  if (!c.strat || !g || g.status !== 'playing' || g.paused || g.currentPlayerIdx === null || !c.tid) return;
  const me = g.players.findIndex(p => p.name === c.label);
  if (me !== g.currentPlayerIdx) return;
  const sig = `${g.handNum}:${g.street}:${g.currentBet}:${g.pot}:${me}`;
  if (sig === c.lastSig) return; c.lastSig = sig;
  const toCall = g.currentBet - g.players[me].roundBet, n = g.handNum || 0;
  const act = c.strat(g, toCall, n, g.players[me]);
  setTimeout(() => c.s.emit('player_action', { roomId: c.tid, action: act[0], amount: act[1] }), 15);
}
const call = (toCall) => [toCall > 0 ? 'call' : 'check'];
const strats = {
  Ann: (g, toCall, n) => (n % 3 === 0 && g.street === 'preflop' && toCall <= 10 ? ['raise', 40 + (n % 4) * 10] : call(toCall)),
  Bo: (g, toCall, n) => (n === 7 && g.street === 'preflop' ? ['raise', 1200] : call(toCall)),
  Cy: (g, toCall, n) => (toCall > 0 && n % 2 === 0 ? ['fold'] : call(toCall)),
};
async function signup(label) {
  const c = client(label, strats[label]);
  let [e, d] = await c.call('auth_signup', { name: label, pin: '1234', avatar: 'a02' }, 'auth_ok', 'auth_error');
  if (e === 'auth_error' && d.code === 'name_taken') [e, d] = await c.call('auth_login', { name: label, pin: '1234' }, 'auth_ok', 'auth_error');
  if (e !== 'auth_ok') throw new Error('signup failed ' + label + ' ' + JSON.stringify(d));
  c.key = d.account.key; return c;
}
const settings = (over = {}) => ({ name: 'Recap night', mode: 'chips', unit: 'chips', buyIn: { min: 500, max: 8000, default: 3000 }, blinds: { sb: 5, bb: 10 }, seats: 8, actionTimerSec: 0, rebuys: true, isPrivate: false, autoStart: true, ...over });
const waitFor = async (pred, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (pred()) return true; } catch {} await sleep(40); } return false; };

async function playNight(mode, label) {
  const [A, B, C] = [await signup('Ann'), await signup('Bo'), await signup('Cy')];
  const [e, d] = await A.call('table_create', { settings: settings(mode === 'play' ? { name: label, mode: 'play', unit: 'cents' } : { name: label }) }, 'table_created', 'error');
  if (e !== 'table_created') throw new Error('create failed ' + JSON.stringify(d));
  const tid = d.table.id, nightId = d.table.nightId;
  if (mode === 'chips') { const s = await A.call('table_join', { tableId: tid, buyIn: 3000 }, 'table_joined', 'error'); if (s[0] !== 'table_joined') throw new Error('join: ' + JSON.stringify(s)); }
  for (const c of [A, B, C]) { c.tid = tid; if (c !== A || mode === 'play') { const s = await c.call('table_join', { tableId: tid, buyIn: mode === 'play' ? 3000 : 3000 }, 'table_joined', 'error'); if (s[0] !== 'table_joined') throw new Error('join ' + c.label + ': ' + JSON.stringify(s)); } }
  return { A, B, C, tid, nightId: nightId || (await (async () => { return null; })()) };
}

(async () => {
  try {
    await startServer();
    const { A, B, C, tid } = await playNight('chips', 'Recap night');
    ok(await waitFor(() => A.sd.length >= 26 || (A.gs && A.gs.status === 'waiting' && A.sd.length >= 12), 90000), 'played 12+ hands (saw ' + A.sd.length + ')');
    if (A.sd.length < 12) console.log('  stall dbg', JSON.stringify(A.gs && { st: A.gs.status, hn: A.gs.handNum, paused: A.gs.paused, cur: A.gs.currentPlayerIdx, pl: A.gs.players.map(p => [p.name, p.chips, p.status || p.folded]) }), A.ev.slice(-5).map(e => e[0]));
    // freeze the count: ask to end the night after the current hand
    const seenAtEnd = () => A.sd.length;
    A.s.emit('table_end_night', { tableId: tid });
    ok(await waitFor(() => A.ev.some(([e]) => e === 'settle_up'), 20000), 'night ended, settle_up received');
    const settle = A.ev.filter(([e]) => e === 'settle_up').pop()[1];
    const nightId = settle.nightId;
    const handsSeen = seenAtEnd();
    const pots = A.sd.map(x => x.pot), maxPot = Math.max(...pots);
    const winTally = {}; for (const x of A.sd) { const w = new Set(x.winners.filter(z => (z.amount || 0) > 0).map(z => z.name)); for (const n of w) winTally[n] = (winTally[n] || 0) + 1; }

    const R = await A.call('recap_get', { nightId }, 'recap_data', 'error');
    ok(R[0] === 'recap_data', 'recap_get returned data');
    const r = R[1];
    ok(r.scope.kind === 'night' && r.scope.ended === true && r.scope.unit === 'chips', 'scope: ended chips night');
    ok(r.totals.hands === handsSeen, `hand count matches what clients saw (${r.totals.hands} vs ${handsSeen})`);
    ok(r.totals.handNetSum === 0, 'hand nets sum to zero (no rake/bonus): ' + r.totals.handNetSum);
    ok(r.hands.every(h => h.players.reduce((s, p) => s + p.net, 0) === 0), 'every hand nets to zero across its players');
    ok(r.hands.every(h => h.players.reduce((s, p) => s + p.bet, 0) === h.pot), 'every hand pot equals the sum of what players put in');
    const biggest = r.superlatives.find(s => s.id === 'bigpot');
    ok(biggest && biggest.value === maxPot, `biggest pot ${biggest && biggest.value} equals max pot seen by clients ${maxPot}`);
    const byName = Object.fromEntries(r.players.map(p => [p.name, p]));
    ok(['Ann', 'Bo', 'Cy'].every(n => byName[n]), 'all three players present');
    const settleBy = Object.fromEntries(settle.players.map(p => [p.display, p.net]));
    ok(['Ann', 'Bo', 'Cy'].every(n => byName[n].net === settleBy[n] && byName[n].handNet === settleBy[n]), 'recap net equals settle-up net equals sum of hand nets: ' + JSON.stringify(settleBy));
    ok(r.players[0].net >= r.players[1].net && r.players[1].net >= r.players[2].net, 'standings sorted by net');
    ok(['Ann', 'Bo', 'Cy'].every(n => byName[n].won === (winTally[n] || 0)), 'hands won per player match showdown events: ' + JSON.stringify(winTally) + ' vs ' + JSON.stringify(Object.fromEntries(r.players.map(p => [p.name, p.won]))));
    const mw = r.superlatives.find(s => s.id === 'mostwins');
    const maxWins = Math.max(...Object.values(winTally));
    ok(!mw || mw.value === maxWins, 'most hands won superlative equals tally (' + (mw && mw.value) + ' / ' + maxWins + ')');
    ok(r.superlatives.every(s => s.names.length && s.names.every(n => byName[n])), 'every superlative names a real player');
    const ar = r.hands.find(h => h.actions.some(a => a.a === 'raise'));
    const badLog = r.hands.filter(h => !(h.actions.length >= 2 && h.actions[0].a === 'sb' && h.actions[1].a === 'bb'));
    if (badLog.length) console.log('  bad log hand', badLog[0].handNum, JSON.stringify(badLog[0].actions.slice(0, 4)));
    ok(!!ar && !badLog.length, 'every hand log starts with SB, BB; raises are logged');
    const showdowns = r.hands.filter(h => h.showdown);
    ok(showdowns.length === A.sd.filter(x => x.reveals).length, 'showdown count matches (' + showdowns.length + ')');
    const bh = r.superlatives.find(s => s.id === 'besthand');
    ok(!showdowns.length || (bh && bh.cards.length === 2 && bh.board.length === 5 && bh.cards.every(Boolean)), 'best hand has real hole cards and a 5-card board');
    // privacy: Ann sees her own cards; folded opponents' cards stay hidden
    const own = r.hands.every(h => { const me = h.players.find(p => p.name === 'Ann'); return !me || (me.cards[0] && me.cards[1]); });
    const hiddenOk = r.hands.every(h => h.players.every(p => p.name === 'Ann' || h.showdown && !p.folded && p.hand ? true : (!p.cards[0] && !p.cards[1])));
    ok(own, 'viewer sees own hole cards in every hand');
    ok(hiddenOk, 'unshown opponent cards are not sent');
    // a different viewer who never played in this night is refused
    const X = await signup('Zed');
    const rx = await X.call('recap_get', { nightId }, 'recap_data', 'error');
    ok(rx[0] === 'error', 'a non-participant cannot open the recap');
    const ra = await B.call('recap_get', { nightId }, 'recap_data', 'error');
    ok(ra[0] === 'recap_data' && ra[1].totals.hands === handsSeen, 'another participant gets the same recap');

    // Play $ night
    const P = await playNight('play', 'Play recap');
    ok(await waitFor(() => P.A.sd.length >= 8, 60000), 'Play $ table played 8+ hands (saw ' + P.A.sd.length + ')');
    if (P.A.sd.length < 8) console.log('  play dbg', JSON.stringify(P.A.gs && { st: P.A.gs.status, hn: P.A.gs.handNum, cur: P.A.gs.currentPlayerIdx, pl: P.A.gs.players.map(p => [p.name, p.chips]) }), P.A.ev.slice(-6).map(e => e[0]));
    const pn = P.A.ev.filter(([e]) => e === 'table_joined').pop()[1].table.nightId;
    const rp = await P.A.call('recap_get', { tableId: P.tid }, 'recap_data', 'error');
    ok(rp[0] === 'recap_data' && rp[1].scope.nightId === pn && rp[1].scope.unit === 'cents', 'Play $ recap via tableId resolves the live night');
    ok(rp[1].totals.handNetSum === 0 && !rp[1].scope.partialMoney, 'Play $ nets sum to zero; money history complete this boot');
    ok(rp[1].players.every(p => p.net === p.settleNet) || rp[1].players.some(p => p.settleNet === null), 'live Play $ net = cashed out + stack - buy-ins');
    const pTot = rp[1].players.reduce((s, p) => s + p.net, 0);
    ok(pTot === 0, 'Play $ live standings sum to zero (' + pTot + ')');
    P.A.s.emit('table_end_night', { tableId: P.tid });
    ok(await waitFor(() => P.A.ev.some(([e]) => e === 'settle_up'), 20000), 'Play $ night ended');

    // POKERPING session
    const [Dd, Ee] = [client('Dee', (g, toCall) => call(toCall)), client('Eli', (g, toCall, n) => (n % 4 === 1 && g.street === 'preflop' && toCall <= 10 ? ['raise', 60] : call(toCall)))];
    for (const c of [Dd, Ee]) { c.tid = 'POKERPING'; const s = await c.call('auth_signup', { name: c.label, pin: '1234', avatar: 'a02' }, 'auth_ok', 'auth_error'); if (s[0] !== 'auth_ok') throw new Error('signup ' + c.label); }
    for (const c of [Dd, Ee]) { const s = await c.call('table_join', { tableId: 'POKERPING', buyIn: 2000 }, 'table_joined', 'error'); if (s[0] !== 'table_joined') throw new Error('legacy join ' + JSON.stringify(s)); }
    ok(await waitFor(() => Dd.sd.length >= 6, 60000), 'POKERPING played 6+ hands');
    const rl = await Dd.call('recap_get', { tableId: 'POKERPING' }, 'recap_data', 'error');
    ok(rl[0] === 'recap_data' && rl[1].scope.kind === 'session' && rl[1].scope.sessions.length === 1, 'POKERPING recap is one session');
    ok(rl[1].totals.hands >= 6 && rl[1].totals.handNetSum === 0, 'POKERPING session hands and zero-sum nets (' + rl[1].totals.hands + ' hands)');
    ok(rl[1].notes.some(n => /4 hours/.test(n)), 'POKERPING session definition is stated in the notes');

    // restart: hand records persist, Play $ money history is flagged partial
    for (const c of [A, B, C, X, P.A, P.B, P.C, Dd, Ee]) try { c.s.close(); } catch {}
    proc.kill(); await sleep(600);
    await startServer();
    const V = client('Ann'); const lg = await V.call('auth_login', { name: 'Ann', pin: '1234' }, 'auth_ok', 'auth_error'); ok(lg[0] === 'auth_ok', 'Ann logs back in after restart');
    const r2 = await V.call('recap_get', { nightId }, 'recap_data', 'error');
    ok(r2[0] === 'recap_data' && r2[1].totals.hands === handsSeen && r2[1].players.length === 3, 'chips night recap survives a restart (' + (r2[1] && r2[1].totals && r2[1].totals.hands) + ' hands)');
    const r3 = await V.call('recap_get', { nightId: pn }, 'recap_data', 'error');
    ok(r3[0] === 'recap_data' && r3[1].scope.partialMoney === true && r3[1].notes.some(n => /memory/.test(n)) && r3[1].totals.hands >= 8, 'Play $ night after restart: hands kept, money flagged as memory-only');
    ok(r3[1].totals.handNetSum === 0 && r3[1].players.every(p => p.net === p.handNet), 'partial Play $ night falls back to hand nets and still sums to zero');
  } catch (e) { console.log('FAIL exception ' + (e && e.stack || e)); fails++; }
  finally { try { proc.kill(); } catch {} setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 400); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
})();
