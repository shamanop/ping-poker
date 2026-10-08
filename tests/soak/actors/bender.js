'use strict';
// Actor: Ballot Bender. Spins in both currencies at every bet level, with and without buyBonus, unaffordable spins, back-to-back spins.
// Actor interface (all actors): { name, weight, init(W)?, step(W) -> record | null }. W is the world object built in soak.js.
const { sleep } = require('../lib/bot');

// the server refuses a second spin from one socket inside 150 ms: wait it out unless the step is the deliberate back-to-back test
const pace = async (bot) => { const w = 165 - (Date.now() - (bot.lastSpinAt || 0)); if (w > 0) await sleep(w); bot.lastSpinAt = Date.now(); };
const costOf = (W, bet, buy) => Math.round((buy ? W.cfg.buyCostX[buy] : 1) * bet);

// Sends one spin and waits for its answer (a result or an error). Returns { kind: 'result'|'refused'|'timeout', code?, cost }.
async function spinOnce(W, bot, { mode, bet, buy }) {
  await pace(bot);
  const cost = costOf(W, bet, buy);
  W.checker.poll();
  const have = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
  const rec = { key: bot.key, mode, bet, buy: buy || null, cost };
  W.inflightSpins.push(rec); bot.spinsInFlight++;
  const r = await bot.req('g:bender:spin', { bet, mode, buyBonus: buy || null }, 'g:bender:result', 5000);
  bot.spinsInFlight--;
  const i = W.inflightSpins.indexOf(rec); if (i >= 0) W.inflightSpins.splice(i, 1);
  if (r.timeout) throw new Error(`no answer to a spin from ${bot.key} within 5 s (harness problem, not a money disagreement)`);
  if (r.error) {
    const code = r.error.code;
    W.counters.spinsRefused++;
    if (code === 'funds') {
      W.checker.poll();
      const now = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
      if (now >= cost && have >= cost) W.warn('spin_refused_affordable', `${bot.key} ${mode} had ${now}, cost ${cost}`);
    } else if (code !== 'rate') W.warn('spin_error_' + code, `${bot.key} ${mode} bet ${bet} buy ${buy}: ${r.error.message}`);
    return { kind: 'refused', code, cost, have };
  }
  const d = r.data;
  return { kind: 'result', cost, win: d.totalWin, roundId: d.roundId, have };
}

module.exports = {
  name: 'bender', weight: 22,
  spinOnce,
  async step(W) {
    const bots = W.connectedBots();
    if (!bots.length) return null;
    const bot = W.rng.pick(bots);
    const mode = W.rng.chance(0.5) ? 'play' : 'chips';
    const levels = W.cfg.betLevels;
    const kind = W.rng.weighted([[60, 'plain'], [14, 'bonus'], [14, 'unaffordable'], [12, 'double'], [8, 'switch']]);
    let bet = W.rng.pick(levels), buy = null;
    if (kind === 'bonus') buy = W.rng.pick(['election', 'landslide']);
    if (kind === 'unaffordable') {
      const have = W.checker.balance(mode, (mode === 'chips' ? 'bank:' : 'play:') + bot.key);
      let found = null;
      for (const b of [...levels].reverse()) for (const by of ['landslide', 'election', null]) if (!found && costOf(W, b, by) > have) found = { bet: b, buy: by };
      if (found) { bet = found.bet; buy = found.buy; } else { bet = levels[levels.length - 1]; buy = 'landslide'; }
    }
    if (kind === 'switch') {
      // Cash and Chips in one sitting: Chips, Cash, Chips (or the other way round), one plain spin each. Each spin is judged by the model in its own currency, the ledger by I10-I13.
      const first = mode, second = mode === 'play' ? 'chips' : 'play', seq = [first, second, first], got = [];
      for (const m of seq) {
        const b = W.rng.pick(levels.filter(x => x <= 100)), r = await spinOnce(W, bot, { mode: m, bet: b, buy: null });
        got.push(`${m} ${b}: ${r.kind === 'result' ? 'win ' + r.win : r.code}`);
      }
      W.counters.modeSwitches = (W.counters.modeSwitches || 0) + 1;
      return { actor: 'bender', what: 'mode_switch', who: bot.key, seq, answers: got };
    }
    if (bet <= 10 && !buy && W.rng.chance(0.5)) bet = W.rng.pick(levels.filter(b => b <= 50));
    if (kind === 'double') {
      // two spins back to back: the 150 ms rate limit may refuse the second; whatever results come back are what counts
      const bets = [bet, W.rng.pick(levels.filter(x => x <= 100))];
      await pace(bot);
      const recs = bets.map(b => ({ key: bot.key, mode, bet: b, buy: null, cost: b }));
      W.checker.poll();
      for (const r of recs) { W.inflightSpins.push(r); bot.spinsInFlight++; }
      const got = await bot.collect(['g:bender:result'], 2, 5000, () => { for (const b of bets) bot.emit('g:bender:spin', { bet: b, mode, buyBonus: null }); });
      for (const r of recs) { bot.spinsInFlight--; const i = W.inflightSpins.indexOf(r); if (i >= 0) W.inflightSpins.splice(i, 1); }
      if (got.length < 2) throw new Error(`a double spin from ${bot.key} got ${got.length} answers in 5 s (harness problem)`);
      for (const g of got) if (g.error) { W.counters.spinsRefused++; if (g.error.code !== 'rate' && g.error.code !== 'funds') W.warn('spin_error_' + g.error.code, g.error.message); }
      return { actor: 'bender', what: 'spin2', who: bot.key, mode, bets, answers: got.map(g => (g.error ? g.error.code : `win ${g.data.totalWin}`)) };
    }
    const r = await spinOnce(W, bot, { mode, bet, buy });
    await sleep(0);
    return { actor: 'bender', what: kind === 'unaffordable' ? 'spin_big' : 'spin', who: bot.key, mode, bet, buy, cost: r.cost, result: r.kind === 'result' ? `win ${r.win}` : r.code };
  },
};
