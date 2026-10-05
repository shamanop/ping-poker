'use strict';
// Social layer: big-win broadcasts, daily Play $ bonus, per-account stats/xp/streaks.
// Everything here is best-effort: hooks are wrapped so they can never throw into game flow.
const TZ = 'America/Chicago';
const BONUS_DAYS = [10000, 12500, 15000, 20000, 25000, 35000, 100000]; // cents, day 1..7; day 8 wraps to day 1
const FEED_MAX = 8, FEED_JOIN_GAP_MS = 30000, BENDER_FEATURE_GAP_MS = 10000;
const BENDER_BIGWIN_X = 100, POKER_BIGWIN_BB = 50, EVENT_GAP_MS = 3000;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (ms) => dayFmt.format(new Date(ms));
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
const levelOf = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;
const fs = require('fs'), path = require('path');
const DAY_MS = 86400000, BIGWIN_KEEP = 40;
const TIER_REWARD = { bronze: 2500, silver: 7500, gold: 25000 }; // Play $ cents, paid once
const TIER_XP = { bronze: 20, silver: 50, gold: 150 };
// v: where progress comes from. s = stats field, c = achv counter, lvl = level. t = target.
const ACHIEVEMENTS = [
  { id: 'first_hand', name: 'Dealt In', desc: 'Play your first hand', tier: 'bronze', s: 'hands', t: 1 },
  { id: 'win_pot', name: 'Pot Winner', desc: 'Win a pot', tier: 'bronze', s: 'handsWon', t: 1 },
  { id: 'streak_3', name: 'Warming Up', desc: 'Win 3 hands in a row', tier: 'bronze', s: 'bestStreak', t: 3 },
  { id: 'streak_5', name: 'On a Roll', desc: 'Win 5 hands in a row', tier: 'silver', s: 'bestStreak', t: 5 },
  { id: 'streak_10', name: 'Unstoppable', desc: 'Win 10 hands in a row', tier: 'gold', s: 'bestStreak', t: 10 },
  { id: 'full_house', name: 'Full House', desc: 'Win a hand with a Full House', tier: 'silver', c: 'fullHouses', t: 1 },
  { id: 'royal', name: 'Royal Flush', desc: 'Win a hand with a Royal Flush', tier: 'gold', c: 'royals', t: 1 },
  { id: 'recount', name: 'Recount!', desc: 'Hit the Recount bonus in Ballot Bender', tier: 'silver', c: 'recounts', t: 1 },
  { id: 'landslide', name: 'Landslide', desc: 'Hit the Landslide bonus in Ballot Bender', tier: 'gold', c: 'landslides', t: 1 },
  { id: 'spins_100', name: 'Regular', desc: 'Spin Ballot Bender 100 times', tier: 'bronze', s: 'benderSpins', t: 100 },
  { id: 'spins_1000', name: 'Machine Rat', desc: 'Spin Ballot Bender 1,000 times', tier: 'silver', s: 'benderSpins', t: 1000 },
  { id: 'spins_5000', name: 'Hall of Spins', desc: 'Spin Ballot Bender 5,000 times', tier: 'gold', s: 'benderSpins', t: 5000 },
  { id: 'bender_10', name: 'Nice Pull', desc: 'Win 10x your bet on one spin', tier: 'bronze', s: 'benderBestMult', t: 10 },
  { id: 'bender_50', name: 'Big Pull', desc: 'Win 50x your bet on one spin', tier: 'silver', s: 'benderBestMult', t: 50 },
  { id: 'bender_100', name: 'World Is Yours', desc: 'Win 100x your bet on one spin', tier: 'gold', s: 'benderBestMult', t: 100 },
  { id: 'day7', name: 'Full Week', desc: 'Claim a Day 7 daily bonus', tier: 'silver', c: 'day7', t: 1 },
  { id: 'level_5', name: 'Level 5', desc: 'Reach level 5', tier: 'bronze', lvl: 1, t: 5 },
  { id: 'level_10', name: 'Level 10', desc: 'Reach level 10', tier: 'silver', lvl: 1, t: 10 },
  { id: 'stickers_10', name: 'Chatterbox', desc: 'Send 10 stickers or emotes', tier: 'bronze', c: 'stickers', t: 10 },
  { id: 'throws_5', name: 'Arm Day', desc: 'Throw 5 items at the table', tier: 'bronze', c: 'throws', t: 5 },
  { id: 'host', name: 'Host With the Most', desc: 'Host a table', tier: 'bronze', c: 'hosted', t: 1 },
  { id: 'nights_5', name: 'Night Owl', desc: 'Play 5 different nights', tier: 'silver', c: 'nights', t: 5 },
  { id: 'cash_out', name: 'Cashed Out Ahead', desc: 'Finish a night ahead', tier: 'bronze', c: 'ahead', t: 1 },
  { id: 'pot_100', name: 'Big Pot', desc: 'Take a pot of $100 or more', tier: 'silver', s: 'biggestPotCents', t: 10000 },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Win a pot after dropping under 20 big blinds', tier: 'silver', c: 'comebacks', t: 1 },
];
const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
const emptyStats = () => ({ hands: 0, handsWon: 0, biggestPotCents: 0, benderSpins: 0, benderBestMult: 0, winStreak: 0, bestStreak: 0, xp: 0, level: 1 });

function createSocial({ io, accounts, now = Date.now, file = null } = {}) {
  let wallet = null;
  const lastEvent = new Map(); // game -> ms
  const acctKey = (s) => { const a = s && s.data && s.data.acct; return a ? String(typeof a === 'object' ? a.key : a) : null; };
  const feed = []; // newest first, public display data only: never keys or PINs
  let feedSeq = 0;
  const lastFeedBy = new Map(); // kind|key -> ms
  const sockets = () => (io && io.sockets && io.sockets.sockets ? [...io.sockets.sockets.values()] : []);

  function pushFeed(kind, key, data, gapMs) {
    const t = now();
    if (gapMs) {
      const gk = kind + '|' + key;
      if (t - (lastFeedBy.get(gk) || -Infinity) < gapMs) return false;
      lastFeedBy.set(gk, t);
      if (lastFeedBy.size > 500) for (const [k, v] of lastFeedBy) if (t - v > gapMs) lastFeedBy.delete(k);
    }
    const ev = { id: ++feedSeq, kind, key, name: accounts.displayOf(key), ts: t, ...data };
    feed.unshift(ev);
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    for (const s of sockets()) s.emit('social:feed', { event: ev, now: t });
    return true;
  }
  const feedView = () => feed.map((e) => ({ ...e, ...(e.key ? { name: accounts.displayOf(e.key) } : {}) }));

  function broadcastBigWin(game, key, amountCents, tier, extra) {
    try { recordBigWin(key, game, amountCents, tier, extra && extra.unit); } catch (e) { /* best effort */ }
    const t = now();
    if (t - (lastEvent.get(game) || -Infinity) < EVENT_GAP_MS) return false;
    lastEvent.set(game, t);
    pushFeed('bigwin', key, { game, amountCents, tier, ...(extra && extra.unit ? { unit: extra.unit } : {}) });
    const payload = { kind: 'bigwin', name: accounts.displayOf(key), game, amountCents, tier, ...(extra || {}) };
    for (const s of sockets()) { const k = acctKey(s); if (k && k !== key) s.emit('social:event', payload); }
    return true;
  }

  function statsView(key) {
    const rec = accounts.social(key);
    if (!rec) return null;
    const st = { ...emptyStats(), ...(rec.stats || {}) };
    st.level = levelOf(st.xp);
    const lo = 10 * (st.level - 1) ** 2, hi = 10 * st.level ** 2;
    return { ...st, xpPct: Math.round(((st.xp - lo) / (hi - lo)) * 100), nextXp: hi };
  }
  const pushStats = (key) => { const v = statsView(key); if (!v) return; for (const s of sockets()) if (acctKey(s) === key) s.emit('account:stats', v); };

  function mutateStats(key, fn) {
    let from = 0, to = 0;
    accounts.social(key, (rec) => { const st = rec.stats = { ...emptyStats(), ...(rec.stats || {}) }; from = levelOf(st.xp); fn(st); st.level = to = levelOf(st.xp); });
    pushStats(key);
    if (to > from) pushFeed('levelup', key, { level: to });
  }


  // ── biggest win in the last 24h (poker pots + bender spins), persisted next to accounts.json ──
  let bigwins = [];
  if (file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j.wins)) bigwins = j.wins.filter((w) => w && Number.isFinite(w.amountCents) && Number.isFinite(w.ts)); } catch (e) { /* first run */ } }
  const pruneWins = () => { const t = now(); bigwins = bigwins.filter((w) => t - w.ts < DAY_MS && w.ts <= t + 60000); if (bigwins.length > BIGWIN_KEEP) { bigwins.sort((a, b) => b.amountCents - a.amountCents); bigwins.length = BIGWIN_KEEP; } };
  function saveWins() {
    if (!file) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ wins: bigwins })); fs.renameSync(tmp, file); } catch (e) { /* best effort */ }
  }
  function biggestView() {
    pruneWins();
    let best = null;
    for (const w of bigwins) if (!best || w.amountCents > best.amountCents || (w.amountCents === best.amountCents && w.ts > best.ts)) best = w;
    return { win: best ? { name: best.key ? accounts.displayOf(best.key) : best.name, game: best.game, amountCents: best.amountCents, tier: best.tier, ts: best.ts } : null, now: now() };
  }
  function recordBigWin(key, game, amountCents, tier, unit) {
    if (unit === 'chips' || !(amountCents > 0)) return;
    const before = biggestView().win;
    bigwins.push({ key, name: accounts.displayOf(key), game, amountCents, tier: tier || null, ts: now() });
    saveWins();
    const after = biggestView();
    if (!before || (after.win && (after.win.amountCents !== before.amountCents || after.win.ts !== before.ts))) for (const s of sockets()) s.emit('social:biggest', after);
  }

  // ── achievements ──
  const checking = new Set();
  const counters = (rec) => { const x = rec.achv || (rec.achv = {}); if (!x.u) x.u = {}; if (!x.c) x.c = {}; return x; };
  function progressOf(rec, a) {
    const v = a.s ? (rec.stats || {})[a.s] : a.c ? ((rec.achv || {}).c || {})[a.c] : levelOf((rec.stats || {}).xp || 0);
    return Math.min(a.t, Number(v) || 0);
  }
  function achvView(key) {
    const rec = accounts.social(key);
    if (!rec) return null;
    const u = (rec.achv && rec.achv.u) || {};
    const list = ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, tier: a.tier, target: a.t, progress: u[a.id] ? a.t : progressOf(rec, a), done: !!u[a.id], ts: u[a.id] || 0, rewardCents: TIER_REWARD[a.tier], xp: TIER_XP[a.tier], ...(a.s === 'biggestPotCents' ? { unit: 'cents' } : {}) }));
    return { list, unlocked: list.filter((x) => x.done).length, total: list.length, unseen: (rec.achv && rec.achv.unseen) || 0 };
  }
  const pushAchv = (key) => { const v = achvView(key); if (!v) return; for (const s of sockets()) if (acctKey(s) === key) s.emit('achv:state', v); };
  function unlockAchv(key, a) {
    accounts.social(key, (rec) => { const x = counters(rec); x.u[a.id] = now(); x.unseen = (x.unseen || 0) + 1; });
    try { wallet.credit(key, 'play', TIER_REWARD[a.tier], { game: 'achv', round: a.id }); }
    catch (e) { accounts.social(key, (rec) => { const x = counters(rec); delete x.u[a.id]; x.unseen = Math.max(0, (x.unseen || 1) - 1); }); return false; }
    mutateStats(key, (st) => { st.xp += TIER_XP[a.tier]; });
    const payload = { id: a.id, name: a.name, desc: a.desc, tier: a.tier, rewardCents: TIER_REWARD[a.tier], xp: TIER_XP[a.tier] };
    for (const s of sockets()) if (acctKey(s) === key) s.emit('achv:unlocked', payload);
    return true;
  }
  function checkAchv(key) {
    if (!key || checking.has(key)) return;
    checking.add(key);
    try {
      const skip = new Set();
      for (let pass = 0; pass < 6; pass++) {
        const rec = accounts.social(key);
        if (!rec) return;
        const u = (rec.achv && rec.achv.u) || {};
        const fresh = ACHIEVEMENTS.filter((a) => !u[a.id] && !skip.has(a.id) && progressOf(rec, a) >= a.t);
        if (!fresh.length) break;
        for (const a of fresh) if (!unlockAchv(key, a)) skip.add(a.id);
      }
      pushAchv(key);
    } catch (e) { /* never into game flow */ } finally { checking.delete(key); }
  }
  function bump(key, name, n = 1) { accounts.social(key, (rec) => { const x = counters(rec); x.c[name] = (x.c[name] || 0) + n; }); checkAchv(key); }
  function onAction(socket, kind) {
    try {
      const key = acctKey(socket);
      if (!key) return;
      const name = { sticker: 'stickers', throw: 'throws', host: 'hosted' }[kind];
      if (name) bump(key, name);
    } catch (e) { /* never into game flow */ }
  }
  if (accounts && typeof accounts.on === 'function') accounts.on('night', (key, { net } = {}) => { try { if (net > 0) bump(String(key), 'ahead'); } catch (e) { /* best effort */ } });

  function onSpin(socket, { bet, totalWin, tier, mode, feature, bonusKind }) {
    try {
      const key = acctKey(socket);
      if (!key || !(bet > 0)) return;
      const mult = totalWin / bet;
      const before = (accounts.social(key).stats || {}).benderSpins || 0;
      mutateStats(key, (st) => {
        st.benderSpins++;
        if (mult > st.benderBestMult) st.benderBestMult = Math.round(mult * 100) / 100;
        if (Math.floor(st.benderSpins / 5) > Math.floor(before / 5)) st.xp += 1;
      });
      if (bonusKind === 'election') bump(key, 'recounts'); else if (bonusKind === 'landslide') bump(key, 'landslides'); else checkAchv(key);
      if (mult >= BENDER_BIGWIN_X) broadcastBigWin('bender', key, totalWin, tier, { mode });
      else if (feature) pushFeed('feature', key, { game: 'bender', feature: String(feature).slice(0, 24) }, BENDER_FEATURE_GAP_MS);
    } catch (e) { /* never into game flow */ }
  }

  function onHandEnd(room) {
    try {
      const pot = room.players.reduce((sum, p) => sum + (p.handBet || 0), 0);
      const bigPot = pot >= POKER_BIGWIN_BB * (room.bb || Infinity);
      for (const p of room.players) {
        if (p.isBot || !p.acct || !(p.handStartChips > 0)) continue;
        const won = p.chips > p.handStartChips;
        mutateStats(p.acct, (st) => {
          st.hands++; st.xp += 1;
          if (won) { st.handsWon++; st.xp += 10; st.winStreak++; if (st.winStreak > st.bestStreak) st.bestStreak = st.winStreak; }
          else st.winStreak = 0;
          if (won && room.unit === 'cents' && pot > st.biggestPotCents) st.biggestPotCents = pot;
        });
        const nid = room.nightId || room.id;
        accounts.social(p.acct, (rec) => {
          const x = counters(rec);
          if (won && p.winHand === 'Full House') x.c.fullHouses = (x.c.fullHouses || 0) + 1;
          if (won && p.winHand === 'Royal Flush') x.c.royals = (x.c.royals || 0) + 1;
          if (won && room.bb > 0 && p.handStartChips < 20 * room.bb) x.c.comebacks = (x.c.comebacks || 0) + 1;
          if (nid) { const ids = x.nightIds || (x.nightIds = []); if (!ids.includes(nid)) { ids.push(nid); if (ids.length > 25) ids.shift(); x.c.nights = (x.c.nights || 0) + 1; } }
        });
        delete p.winHand;
        checkAchv(p.acct);
        if (won && bigPot) broadcastBigWin('poker', p.acct, pot, 'bigpot', { unit: room.unit });
      }
    } catch (e) { /* never into game flow */ }
  }

  const dayInCycle = (streak) => ((Math.max(1, streak) - 1) % BONUS_DAYS.length) + 1;
  function bonusInfo(key) {
    const rec = accounts.social(key) || {};
    const b = rec.bonus || { last: null, streak: 0 };
    const today = dayOf(now());
    const gap = b.last ? dayNum(today) - dayNum(b.last) : Infinity;
    const available = gap >= 1;
    const streak = available ? (gap === 1 ? b.streak + 1 : 1) : b.streak;
    const day = dayInCycle(streak);
    return { available, streak, day, amountCents: BONUS_DAYS[day - 1], today };
  }
  const bonusView = (i) => ({ available: i.available, amountCents: i.amountCents, streak: i.streak, day: i.day, schedule: BONUS_DAYS });

  function claimBonus(key) {
    const info = bonusInfo(key);
    if (!info.available) return { ok: false, code: 'claimed', ...info };
    // Persist first, so a failed credit cannot be retried into a double claim.
    const prev = (accounts.social(key) || {}).bonus;
    accounts.social(key, (rec) => { rec.bonus = { last: info.today, streak: info.streak }; });
    try { wallet.credit(key, 'play', info.amountCents, { game: 'bonus', round: info.today }); }
    catch (e) { accounts.social(key, (rec) => { rec.bonus = prev; }); throw e; }
    pushFeed('bonus', key, { day: info.day, streak: info.streak });
    if (info.day === 7) bump(key, 'day7'); else checkAchv(key);
    return { ok: true, available: false, streak: info.streak, day: info.day, amountCents: info.amountCents };
  }

  function onJoin(socket, { players } = {}) {
    try { const key = acctKey(socket); if (key) pushFeed('join', key, { players: Number(players) || 0 }, FEED_JOIN_GAP_MS); } catch (e) { /* never into game flow */ }
  }

  function onConnection(socket) {
    const guard = (fn) => () => {
      const key = acctKey(socket);
      if (!key) return socket.emit('error', { message: 'Sign in first', code: 'auth' });
      try { fn(key); } catch (e) { socket.emit('error', { message: 'Server error', code: 'internal' }); }
    };
    socket.on('bonus:status', guard((key) => { const i = bonusInfo(key); socket.emit('bonus:status', bonusView(i)); }));
    socket.on('bonus:claim', guard((key) => {
      const r = claimBonus(key);
      socket.emit('bonus:claimed', r.ok ? { ok: true, amountCents: r.amountCents, streak: r.streak, day: r.day, wallet: wallet.get(key) } : { ok: false, code: r.code });
      socket.emit('bonus:status', bonusView(r));
    }));
    socket.on('achv:state', guard((key) => socket.emit('achv:state', achvView(key))));
    socket.on('achv:seen', guard((key) => { accounts.social(key, (rec) => { counters(rec).unseen = 0; }); pushAchv(key); }));
    socket.on('social:biggest', () => socket.emit('social:biggest', biggestView()));
    socket.on('social:feed', () => socket.emit('social:feed', { list: feedView(), now: now() }));
    socket.on('account:stats', guard((key) => socket.emit('account:stats', statsView(key))));
  }
  if (io && typeof io.on === 'function') io.on('connection', (s) => { onConnection(s); try { s.emit('social:feed', { list: feedView(), now: now() }); s.emit('social:biggest', biggestView()); } catch (e) { /* best effort */ } });

  return { onAction, achvView, checkAchv, biggestView, ACHIEVEMENTS, setWallet: (w) => { wallet = w; }, onSpin, onHandEnd, onConnection, onJoin, feedView, BONUS_DAYS, bonusInfo, claimBonus, statsView, broadcastBigWin, levelOf };
}

module.exports = { createSocial, levelOf, dayOf };
