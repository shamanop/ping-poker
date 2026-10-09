// Social layer: big-win broadcast, daily bonus, stats/xp/streaks. In-process, temp data files.
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppso-'));
const { createAccounts } = require('../accounts.js');
const { open: openLedger } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const { createWalletAdapter } = require('../transport/wallet-adapter');
const { createSocial, levelOf, dayOf } = require('../social.js');
const games = require('../games');
const Eng = require('../games/bender-engine.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

let clock = Date.parse('2026-10-05T15:00:00Z');
const now = () => clock;
const mkSock = (acct) => { const h = {}; return { data: { acct }, ev: [], emit(e, d) { this.ev.push([e, d]); }, on(e, f) { h[e] = f; }, fire(e, p) { h[e] && h[e](p); }, last(e) { return [...this.ev].reverse().find(x => x[0] === e); }, all(e) { return this.ev.filter(x => x[0] === e); } }; };
const handlers = []; const socks = new Map();
const io = { sockets: { sockets: socks }, on(e, f) { handlers.push(f); } };
const accounts = createAccounts({ file: path.join(dir, 'accounts.json') });
// Money is the real ledger (ledger + service + ctx.money + the wallet adapter), the way tests/bender.js builds it: Bender plays only through ctx.money.
const ledger = openLedger(path.join(dir, 'money.jsonl'), { fsync: 'none', log: () => {} });
const service = createService(ledger);
let g = null;
const onChange = (k) => { if (g) g.pushWallet(k); };
const money = createGameMoney({ service, ledger, onChange, log: () => {} });
const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
const social = createSocial({ io, accounts, now });
g = games({ io, accounts, social, wallet, money, service, now, rng: () => 0.5 });
social.setWallet(wallet);
const join = (name) => { const a = accounts.signup(name, '1234', 'a01', { ip: 't-' + name }).account; service.ensureAccount(a.key); const s = mkSock(a.key); socks.set(name, s); handlers.forEach(f => f(s)); return s; };
const A = join('Ana'), B = join('Bo'), C = join('Cy');
const rw = (k) => social.achvView(k).list.filter(x => x.done).reduce((a, x) => a + x.rewardCents, 0); // achievement Cash paid so far
const rxp = (k) => social.achvView(k).list.filter(x => x.done).reduce((a, x) => a + x.xp, 0);
const pl = (k) => wallet.get(k).play;            // Cash: Bender plays in Cash here
const ch = (k) => wallet.get(k).chips;           // the daily bonus and achievement rewards are minted in chips (social.js credits 'chips'; Chips and Play $ are separate since bb298d2)
const anon = mkSock(null); socks.set('anon', anon);

// 1. big win broadcast
const spin = (s, mult) => {
  clock += 200; const orig = Eng.resolveRound;
  Eng.resolveRound = () => ({ costMult: 1, totalWinMult: mult, tier: mult >= 100 ? 'worldisyours' : 'nice', grid: [], cascades: [], finalGrid: [], scatters: 0, scatterPay: 0, bonus: null, maxed: false, steps: [], round: {} });
  try { s.fire('g:bender:spin', { bet: 100, mode: 'play' }); } finally { Eng.resolveRound = orig; }
};
const before = pl('ana');
spin(A, 150);
ok(!A.last('social:event') && B.last('social:event') && C.last('social:event'), 'bigwin goes to other signed-in sockets, not winner');
ok(!anon.last('social:event'), 'bigwin skips signed-out sockets');
const ev = B.last('social:event')[1];
ok(ev.kind === 'bigwin' && ev.game === 'bender' && ev.name === 'Ana' && ev.amountCents === 15000 && ev.tier === 'worldisyours', 'bigwin payload');
ok(pl('ana') === before - 100 + 15000, 'bender wallet math unchanged');
clock += 0; spin(A, 120); ok(B.all('social:event').length === 1, 'rate limited to 1 per 3s per game');
clock += 3000; spin(A, 99); ok(B.all('social:event').length === 1, '99x is not a bigwin');
spin(A, 200); ok(B.all('social:event').length === 2, 'next bigwin after 3s goes out');
const room = (won, pot, bb) => ({ bb, unit: 'cents', players: [{ name: 'Bo', acct: 'bo', chips: won ? 200 + pot : 100, handStartChips: 200, handBet: pot / 2 }, { name: 'Cy', acct: 'cy', chips: won ? 0 : 200 + pot, handStartChips: 200, handBet: pot / 2 }, { name: 'Bot', isBot: true, chips: 0, handStartChips: 5, handBet: 0 }] });
const n0 = A.all('social:event').length;
social.onHandEnd(room(true, 4900, 100)); ok(A.all('social:event').length === n0, 'pot < 50 BB: no poker bigwin');
social.onHandEnd(room(true, 5000, 100));
const pe = A.all('social:event').slice(n0).map(x => x[1]);
ok(pe.length === 1 && pe[0].game === 'poker' && pe[0].name === 'Bo' && pe[0].amountCents === 5000, 'pot >= 50 BB: poker bigwin to others');
ok(!B.all('social:event').some(x => x[1].game === 'poker'), 'poker winner skipped');

// 2. daily bonus
const p0 = wallet.get('bo');
B.fire('bonus:status'); let st = B.last('bonus:status')[1];
ok(st.available && st.amountCents === 10000 && st.streak === 1, 'status: available $100 streak 1');
B.fire('bonus:claim'); const cl = B.last('bonus:claimed')[1];
ok(cl.ok && wallet.get('bo').chips === p0.chips + 10000, 'claim credits chips');
B.fire('bonus:claim'); ok(B.last('bonus:claimed')[1].ok === false && wallet.get('bo').chips === p0.chips + 10000, 'second claim same day refused');
clock += 3600000 * 3; ok(!social.bonusInfo('bo').available, 'still claimed later same Chicago day');
const cityMidnight = Date.parse('2026-10-06T05:00:00Z'); clock = cityMidnight - 1000; ok(!social.bonusInfo('bo').available, 'not available 1s before Chicago midnight');
clock = cityMidnight + 1000; let bi = social.bonusInfo('bo'); ok(bi.available && bi.streak === 2 && bi.day === 2 && bi.amountCents === 12500, 'next Chicago day: streak 2, day 2, $125');
social.claimBonus('bo');
clock += 86400000; social.claimBonus('bo'); clock += 86400000 * 3; bi = social.bonusInfo('bo');
ok(bi.available && bi.streak === 1 && bi.amountCents === 10000, 'missed days reset streak');
// streak calendar (24h steps from noon Chicago so DST changes cannot repeat a date): $100,125,150,200,250,350,1000 then wraps to day 1
clock = Date.parse(dayOf(clock) + 'T18:00:00Z'); const pay = []; const w0 = () => ch('bo');
for (let i = 0; i < 8; i++) { const b4 = w0(), r = social.claimBonus('bo'); pay.push([r.day, w0() - b4, r.streak]); clock += 86400000; }
ok(pay.slice(0, 7).map(x => x[1]).join() === '10000,12500,15000,20000,25000,35000,100000', 'days 1-7 escalate to the $1,000 jackpot');
ok(pay.slice(0, 7).map(x => x[0]).join() === '1,2,3,4,5,6,7' && pay[6][2] === 7, 'day numbers 1..7, streak 7 on day 7');
ok(pay[7][0] === 1 && pay[7][1] === 10000 && pay[7][2] === 8, 'day 8 wraps to calendar day 1 ($100), streak keeps counting');
const jp = social.bonusInfo('bo'); ok(jp.day === 2 && jp.amountCents === 12500, 'info after wrap points at day 2');
for (let i = 0; i < 4; i++) { social.claimBonus('bo'); clock += 86400000; }
clock += 86400000; const rs = social.bonusInfo('bo');
ok(rs.available && rs.streak === 1 && rs.day === 1 && rs.amountCents === 10000, 'miss one day mid-calendar: back to day 1');
const bb = w0(); const rr = social.claimBonus('bo'); ok(rr.ok && rr.day === 1 && w0() - bb === 10000, 'reset claim pays day 1');
const dup = social.claimBonus('bo'); ok(!dup.ok && dup.code === 'claimed' && w0() - bb === 10000, 'idempotent within the day');
B.fire('bonus:status'); const sv = B.last('bonus:status')[1];
ok(Array.isArray(sv.schedule) && sv.schedule.length === 7 && sv.schedule[6] === 100000 && sv.day >= 1 && sv.day <= 7, 'status carries day + 7-day schedule');
clock += 86400000 * 6;
// day-7 payout exactly (fresh account walking the calendar)
clock = Date.parse(dayOf(clock) + 'T18:00:00Z');
const E = C; for (let i = 0; i < 6; i++) { social.claimBonus('cy'); clock += 86400000; }
const e0 = ch('cy'); E.fire('bonus:claim'); const d7 = E.last('bonus:claimed')[1];
ok(d7.ok && d7.day === 7 && d7.amountCents === 100000 && ch('cy') === e0 + 100000, 'day 7 claim pays $1,000 in chips');
accounts.flush(); const acc2 = createAccounts({ file: path.join(dir, 'accounts.json') });
ok(acc2.social('bo').bonus && acc2.social('bo').bonus.streak >= 1, 'bonus persisted in account record');
const un = mkSock(null); handlers.forEach(f => f(un)); un.fire('bonus:claim'); ok(un.last('error') && un.last('error')[1].code === 'auth', 'claim requires sign-in');

// 3. stats
const D = join('Di'); social.onHandEnd({ bb: 100, unit: 'cents', players: [{ name: 'Di', acct: 'di', chips: 300, handStartChips: 200, handBet: 100 }] });
D.fire('account:stats'); let s = D.last('account:stats')[1];
ok(s.hands === 1 && s.handsWon === 1 && s.winStreak === 1 && s.xp - rxp('di') === 11 && s.biggestPotCents === 100, 'hand win: +1 played +10 win');
social.onHandEnd({ bb: 100, unit: 'cents', players: [{ name: 'Di', acct: 'di', chips: 300, handStartChips: 200, handBet: 100 }] });
s = social.statsView('di'); ok(s.winStreak === 2 && s.bestStreak === 2 && s.xp - rxp('di') === 22, 'win streak builds');
social.onHandEnd({ bb: 100, unit: 'cents', players: [{ name: 'Di', acct: 'di', chips: 100, handStartChips: 200, handBet: 100 }] });
s = social.statsView('di'); ok(s.winStreak === 0 && s.bestStreak === 2 && s.xp - rxp('di') === 23 && s.hands === 3, 'loss resets streak, keeps best');
for (let i = 0; i < 5; i++) spin(D, 0);
s = social.statsView('di'); ok(s.benderSpins === 5 && s.xp - rxp('di') === 24, '+1 xp per 5 spins');
spin(D, 7.5); ok(social.statsView('di').benderBestMult === 7.5, 'best bender multiple tracked');
ok([0, 9, 10, 39, 40, 90].map(levelOf).join() === '1,1,2,2,3,4', 'level = floor(sqrt(xp/10))+1');
ok(D.all('account:stats').length > 3, 'account:stats pushed after changes');
social.onHandEnd(null); social.onSpin({ data: {} }, {}); ok(true, 'stat hooks never throw on junk');
const bad = { ...g }; ok(typeof bad.wallet.get === 'function', 'games still wired');
// 2b. lobby activity feed
const fv = social.feedView();
ok(fv.length > 0 && fv.length <= 8, 'feed ring buffer holds at most 8');
ok(fv[0].ts >= fv[fv.length - 1].ts, 'feed newest first');
ok(fv.some(e => e.kind === 'bonus' && e.day === 7 && e.name === 'Cy'), 'bonus claim logged with day N');
const raw = JSON.stringify(fv); ok(!/1234|pin|"key"|a01/i.test(raw), 'feed carries no PIN or account key');
ok(fv.every(e => typeof e.name === 'string' && e.name !== e.key && !('key' in e) && !('acct' in e)), 'feed entries hold display names only');
const f0 = social.feedView().length; for (let i = 0; i < 12; i++) { clock += 31000; social.onJoin(A, { players: 2 }); }
ok(social.feedView().length === 8 && social.feedView()[0].kind === 'join' && social.feedView()[0].name === 'Ana', 'join event enters feed, buffer capped at 8');
const jc = social.feedView().length; social.onJoin(A, { players: 2 }); ok(social.feedView().length === jc, 'join spam from one player rate limited');
const ids = social.feedView().map(e => e.id); ok(ids.every((v, i) => i === 0 || ids[i - 1] > v), 'feed ids strictly decreasing newest first');
const live = B.all('social:feed').filter(x => x[1] && x[1].event); ok(live.length > 0 && live[live.length - 1][1].event.kind === 'join', 'live events broadcast as social:feed {event}');
const snap = mkSock(null); handlers.forEach(f => f(snap)); ok(snap.all('social:feed').some(x => Array.isArray(x[1].list)), 'new connection receives the feed list');
snap.fire('social:feed'); ok(snap.last('social:feed')[1].list.length === 8, 'social:feed request returns the list');
const lv = social.feedView().length; clock += 1000;
const FE = D; for (let i = 0; i < 2; i++) social.onHandEnd({ bb: 100, unit: 'cents', players: [{ name: 'Di', acct: 'di', chips: 300, handStartChips: 200, handBet: 100 }] });
const EDS = join('Ed'); social.onHandEnd({ bb: 100, unit: 'cents', players: [{ name: 'Ed', acct: 'ed', chips: 300, handStartChips: 200, handBet: 100 }] });
ok(social.statsView('ed').level >= 2 && social.feedView().some(e => e.kind === 'levelup' && e.name === 'Ed' && e.level >= 2), 'level up enters feed');
clock += 50000; social.onSpin(FE, { bet: 100, totalWin: 300, tier: 'nice', mode: 'play', feature: 'free spins' });
ok(social.feedView()[0].kind === 'feature' && social.feedView()[0].game === 'bender', 'bender feature enters feed');
social.onJoin({ data: {} }, {}); social.onJoin(null); ok(true, 'onJoin never throws on junk');

// 3. achievements
const F = join('Fay'); const fw0 = wallet.get('fay').chips, pf0 = wallet.get('fay').play;
const FH = (extra = {}) => ({ bb: 5, unit: 'cents', nightId: 'n1', players: [{ name: 'Fay', acct: 'fay', chips: 300, handStartChips: 200, handBet: 100, ...extra }] });
social.onHandEnd(FH());
const unl = F.all('achv:unlocked').map(x => x[1].id);
ok(unl.includes('first_hand') && unl.includes('win_pot') && unl.length === 2, 'first hand + win a pot unlock once each');
ok(F.all('achv:unlocked').every(x => x[1].name && x[1].tier && x[1].rewardCents === 0), 'unlock payload has name and tier, reward 0 (badges only since 10/7)');
ok(wallet.get('fay').chips === fw0 && wallet.get('fay').play === pf0, 'unlocks mint nothing in either currency (TIER_REWARD is 0: no money mid-game)');
social.checkAchv('fay'); social.checkAchv('fay'); social.onHandEnd(FH());
ok(F.all('achv:unlocked').filter(x => x[1].id === 'first_hand').length === 1 && wallet.get('fay').chips === fw0, 'reward idempotent: re-check and more hands pay nothing again');
const xp1 = social.statsView('fay').xp; social.checkAchv('fay'); ok(social.statsView('fay').xp === xp1, 'xp not re-awarded on re-check');
social.onHandEnd(FH({ winHand: 'Full House' })); social.onHandEnd(FH({ winHand: 'Royal Flush' }));
const got = () => new Set(F.all('achv:unlocked').map(x => x[1].id));
ok(got().has('full_house') && got().has('royal') && got().has('streak_3'), 'Full House, Royal Flush, 3-win streak unlock');
ok(![A, B, C].some(x => x.all('achv:unlocked').some(e => e[1].id === 'royal')), 'unlock goes only to that account sockets');
social.onHandEnd(FH({ handStartChips: 1500, chips: 1600 })); ok(!got().has('comeback'), 'comeback needs under 20 big blinds at hand start');
social.onHandEnd(FH({ handStartChips: 50, chips: 500 })); ok(got().has('comeback'), 'win from under 20 BB unlocks comeback');
social.onHandEnd({ bb: 100, unit: 'cents', nightId: 'n1', players: [{ name: 'Fay', acct: 'fay', chips: 400, handStartChips: 200, handBet: 10000 }, { name: 'Zed', acct: null, isBot: true, chips: 0, handStartChips: 100, handBet: 100 }] });
ok(got().has('pot_100'), 'a $100+ pot unlocks Big Pot');
let nv = social.achvView('fay'); ok(nv.list.find(x => x.id === 'nights_5').progress === 1 && nv.list.find(x => x.id === 'nights_5').target === 5, 'nights counted once per night id');
for (const n of ['n2', 'n3', 'n4', 'n5']) social.onHandEnd(FH({ }), social.onHandEnd({ ...FH(), nightId: n }));
ok(got().has('nights_5'), '5 different nights unlock Night Owl');
F.ev.length = 0;
const spinK = (kind) => { clock += 200; const o = Eng.resolveRound; Eng.resolveRound = () => ({ costMult: 1, totalWinMult: 0, tier: 'nice', grid: [], cascades: [], finalGrid: [], scatters: 3, scatterPay: 0, bonus: kind ? { kind, spins: [], total: 0 } : null, maxed: false, steps: 0, round: {} }); try { F.fire('g:bender:spin', { bet: 100, mode: 'play' }); } finally { Eng.resolveRound = o; } };
spinK('election'); spinK('landslide'); ok(got().has('recount') && got().has('landslide'), 'Recount and Landslide bonuses unlock');
spin(F, 120); ok(got().has('bender_100') && got().has('bender_50') && got().has('bender_10'), '120x unlocks all three bender tiers');
for (let i = 0; i < 12; i++) social.onAction(F, 'sticker'); for (let i = 0; i < 5; i++) social.onAction(F, 'throw'); social.onAction(F, 'host');
ok(got().has('stickers_10') && got().has('throws_5') && got().has('host'), 'sticker, throw and host actions unlock');
ok(nv.total >= 20 && nv.list.every(x => ['bronze', 'silver', 'gold'].includes(x.tier)), 'at least 20 achievements, all tiered');
social.onAction({ data: {} }, 'host'); social.onAction(null, 'x'); social.checkAchv(null); social.checkAchv('nobody'); ok(true, 'achievement hooks never throw on junk');
accounts.recordNight('fay', { mode: 'cents', net: 500 }); ok(got().has('cash_out'), 'finishing a night ahead unlocks Cashed Out Ahead');
accounts.recordNight('fay', { mode: 'cents', net: -500 }); ok(F.all('achv:unlocked').filter(x => x[1].id === 'cash_out').length === 1, 'losing night does not re-unlock');
const lv5 = social.achvView('fay').list; ok(lv5.find(x => x.id === 'level_5').done === (social.statsView('fay').level >= 5), 'level achievement tracks level');
F.fire('achv:state'); const av = F.last('achv:state')[1]; ok(av.unseen > 0 && av.unlocked === av.list.filter(x => x.done).length, 'achv:state reports unseen count');
F.fire('achv:seen'); ok(F.last('achv:state')[1].unseen === 0, 'achv:seen clears the hint');
ok(JSON.stringify(accounts.social('fay').achv).length < 2000 && !/pin/i.test(JSON.stringify(accounts.social('fay').achv)), 'persisted achv object is small and PIN-free');
const wAfter = wallet.get('fay').chips, uAfter = social.achvView('fay').unlocked;

// 4. persistence across restart + biggest win band
accounts.flush();
const accounts2 = createAccounts({ file: path.join(dir, 'accounts.json') });
const bwFile = path.join(dir, 'bigwins.json');
let social2 = createSocial({ io: null, accounts: accounts2, now, file: bwFile }); social2.setWallet(wallet);
ok(social2.achvView('fay').unlocked === uAfter, 'unlocked achievements survive a restart');
social2.checkAchv('fay'); social2.onHandEnd(FH()); ok(wallet.get('fay').chips === wAfter, 'no re-reward after restart');
ok(social2.biggestView().win === null, 'empty band before any big win');
social2.broadcastBigWin('bender', 'fay', 15000, 'worldisyours', { mode: 'play' });
clock += 4000; social2.broadcastBigWin('poker', 'ana', 90000, 'bigpot', { unit: 'cents' });
clock += 4000; social2.broadcastBigWin('poker', 'bo', 500000, 'bigpot', { unit: 'chips' });
let bv = social2.biggestView(); ok(bv.win && bv.win.name === 'Ana' && bv.win.amountCents === 90000 && bv.win.game === 'poker', 'biggest win = largest single win, chips pots excluded');
ok(!/"key"|1234|pin/i.test(JSON.stringify(bv)), 'biggest win payload has no key or PIN');
const social3 = createSocial({ io: null, accounts: accounts2, now, file: bwFile }); ok(social3.biggestView().win && social3.biggestView().win.amountCents === 90000, 'biggest win survives a restart');
clock += 23 * 3600000; ok(social3.biggestView().win && social3.biggestView().win.amountCents === 90000, 'still shown inside 24h');
clock += 3 * 3600000; ok(social3.biggestView().win === null, 'drops out after 24h');
const bs = mkSock('ana'); const hb = {}; const io2 = { sockets: { sockets: new Map([['x', bs]]) }, on(e, f) { f(bs); } };
const social4 = createSocial({ io: io2, accounts: accounts2, now, file: path.join(dir, 'bw4.json') }); social4.setWallet(wallet);
ok(bs.last('social:biggest') && bs.last('social:biggest')[1].win === null, 'new connection receives the biggest-win state');
social4.broadcastBigWin('bender', 'ana', 20000, 'x', {}); ok(bs.last('social:biggest')[1].win.amountCents === 20000, 'live push on a new record');
const n4 = bs.all('social:biggest').length; clock += 4000; social4.broadcastBigWin('bender', 'ana', 10000, 'x', {}); ok(bs.all('social:biggest').length === n4, 'no push when record unchanged');

accounts.flush(); wallet; setTimeout(() => process.exit(fails ? 1 : 0), 100);
