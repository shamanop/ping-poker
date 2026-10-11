'use strict';
// Actor: Dino. Spins in both currencies at many bet levels: plain, ante (only at the ante levels), a bought feature, an ante the server must refuse, unaffordable spins, back-to-back spins.
// Same shape as actors/bender.js. Results are booked by the g:dino:result listener in soak.js (model.applySpin game 'dino'), a spin lost to a kill by reconcile().
const { sleep } = require('../lib/bot');

// the server refuses a second spin from one ACCOUNT inside 150 ms: wait it out unless the step is the deliberate back-to-back test
const pace = async (bot) => { const w = 165 - (Date.now() - (bot.lastDinoAt || 0)); if (w > 0) await sleep(w); bot.lastDinoAt = Date.now(); };
const costOf = (W, bet, opt) => Math.round((opt === 'buy' ? W.cfg.dino.buyCostX : opt === 'ante' ? W.cfg.dino.anteCost : 1) * bet);
const payloadOf = (bet, mode, opt) => ({ bet, mode, ante: opt === 'ante', buy: opt === 'buy' });

async function spinOnce(W, bot, { mode, bet, opt }) {
  await pace(bot);
  const cost = costOf(W, bet, opt);
  W.checker.poll();
  const have = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
  const legal = opt !== 'ante' || W.cfg.dino.anteLevels.includes(bet);
  const rec = { game: 'dino', key: bot.key, mode, bet, buy: opt || null, cost };
  if (legal) { W.inflightSpins.push(rec); bot.spinsInFlight++; }
  const r = await bot.req('g:dino:spin', payloadOf(bet, mode, opt), 'g:dino:result', 5000);
  if (legal) { bot.spinsInFlight--; const i = W.inflightSpins.indexOf(rec); if (i >= 0) W.inflightSpins.splice(i, 1); }
  if (r.timeout) throw new Error(`no answer to a dino spin from ${bot.key} within 5 s (harness problem, not a money disagreement)`);
  if (r.error) {
    const code = r.error.code;
    W.counters.spinsRefused++;
    if (!legal) { if (code !== 'ante_level' && code !== 'rate') W.warn('dino_ante_refused_as_' + code, `${bot.key} ante at ${bet}: ${r.error.message}`); }
    else if (code === 'funds') {
      W.checker.poll();
      const now = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
      if (now >= cost && have >= cost) W.warn('dino_refused_affordable', `${bot.key} ${mode} had ${now}, cost ${cost}`);
    } else if (code !== 'rate') W.warn('dino_error_' + code, `${bot.key} ${mode} bet ${bet} ${opt}: ${r.error.message}`);
    return { kind: 'refused', code, cost, have };
  }
  if (!legal) W.violate('I7', `dino accepted an ante at bet ${bet}, which is not an ante level`, { key: bot.key }, 'ante_level error', 'a result');
  const d = r.data;
  return { kind: 'result', cost, win: d.totalWin, roundId: d.roundId, have };
}

module.exports = {
  name: 'dino', weight: 14,
  spinOnce,
  async init(W) {
    const bot = W.connectedBots()[0];
    if (!bot) return;
    const st = await bot.req('g:dino:state', {}, 'g:dino:state', 5000);
    if (st.data) W.cfg.dino = { anteCost: st.data.anteCost, buyCostX: st.data.buyCostX, anteLevels: st.data.anteLevels, betLevels: st.data.betLevels };
  },
  async step(W) {
    const bots = W.connectedBots();
    if (!bots.length) return null;
    const bot = W.rng.pick(bots);
    const mode = W.rng.chance(0.5) ? 'play' : 'chips';
    const levels = (W.cfg.dino.betLevels || W.cfg.betLevels).filter(x => x <= 2500);
    const kind = W.rng.weighted([[50, 'plain'], [18, 'ante'], [8, 'buy'], [6, 'badante'], [10, 'unaffordable'], [8, 'double']]);
    let bet = W.rng.pick(levels.filter(x => x <= 100)), opt = null;
    if (kind === 'ante') { opt = 'ante'; bet = W.rng.pick(W.cfg.dino.anteLevels.filter(x => x <= 500)); }
    if (kind === 'buy') { opt = 'buy'; bet = W.rng.pick(levels.filter(x => x <= 20)); }
    if (kind === 'badante') { opt = 'ante'; bet = W.rng.pick(levels.filter(x => !W.cfg.dino.anteLevels.includes(x))); }
    if (kind === 'unaffordable') {
      const have = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
      let found = null;
      for (const b of [...levels].reverse()) for (const o of ['buy', null]) if (!found && costOf(W, b, o) > have) found = { bet: b, opt: o };
      if (found) { bet = found.bet; opt = found.opt; } else { bet = levels[levels.length - 1]; opt = 'buy'; }
    }
    if (kind === 'double') {
      // two spins back to back from one account: the 150 ms account rate limit may refuse the second; whatever results come back are what counts
      const bets = [bet, W.rng.pick(levels.filter(x => x <= 100))];
      await pace(bot);
      const recs = bets.map(b => ({ game: 'dino', key: bot.key, mode, bet: b, buy: null, cost: b }));
      W.checker.poll();
      for (const r of recs) { W.inflightSpins.push(r); bot.spinsInFlight++; }
      const got = await bot.collect(['g:dino:result'], 2, 5000, () => { for (const b of bets) bot.emit('g:dino:spin', payloadOf(b, mode, null)); });
      for (const r of recs) { bot.spinsInFlight--; const i = W.inflightSpins.indexOf(r); if (i >= 0) W.inflightSpins.splice(i, 1); }
      if (got.length < 2) throw new Error(`a double dino spin from ${bot.key} got ${got.length} answers in 5 s (harness problem)`);
      for (const g of got) if (g.error) { W.counters.spinsRefused++; if (g.error.code !== 'rate' && g.error.code !== 'funds') W.warn('dino_error_' + g.error.code, g.error.message); }
      return { actor: 'dino', what: 'spin2', who: bot.key, mode, bets, answers: got.map(g => (g.error ? g.error.code : `win ${g.data.totalWin}`)) };
    }
    const r = await spinOnce(W, bot, { mode, bet, opt });
    await sleep(0);
    return { actor: 'dino', what: kind, who: bot.key, mode, bet, opt, cost: r.cost, result: r.kind === 'result' ? `win ${r.win}` : r.code };
  },
};
