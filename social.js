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
const emptyStats = () => ({ hands: 0, handsWon: 0, biggestPotCents: 0, benderSpins: 0, benderBestMult: 0, winStreak: 0, bestStreak: 0, xp: 0, level: 1 });

function createSocial({ io, accounts, now = Date.now } = {}) {
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
    const ev = { id: ++feedSeq, kind, name: accounts.displayOf(key), ts: t, ...data };
    feed.unshift(ev);
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    for (const s of sockets()) s.emit('social:feed', { event: ev, now: t });
    return true;
  }
  const feedView = () => feed.map((e) => ({ ...e }));

  function broadcastBigWin(game, key, amountCents, tier, extra) {
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

  function onSpin(socket, { bet, totalWin, tier, mode, feature }) {
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
    socket.on('social:feed', () => socket.emit('social:feed', { list: feedView(), now: now() }));
    socket.on('account:stats', guard((key) => socket.emit('account:stats', statsView(key))));
  }
  if (io && typeof io.on === 'function') io.on('connection', (s) => { onConnection(s); try { s.emit('social:feed', { list: feedView(), now: now() }); } catch (e) { /* best effort */ } });

  return { setWallet: (w) => { wallet = w; }, onSpin, onHandEnd, onConnection, onJoin, feedView, BONUS_DAYS, bonusInfo, claimBonus, statsView, broadcastBigWin, levelOf };
}

module.exports = { createSocial, levelOf, dayOf };
