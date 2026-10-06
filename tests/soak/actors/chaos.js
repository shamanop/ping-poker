'use strict';
// Chaos: SIGKILL (sometimes SIGTERM) the server at a chosen moment, start it again on the SAME data dir, sign every bot in again.
// The kill is the only place the harness accepts money it was not told about, and only the two shapes the brief allows (soak.js reconcile()).
const { sleep } = require('../lib/bot');
const poker = require('./poker');

async function untilLive(W, ms) {            // let the table run until a hand with chips in the pot is live, acting for whoever is on turn
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (W.connectedBots().some(b => b.tableId && b.gs && b.gs.status === 'playing' && b.gs.pot > 0)) return true;
    if (W.connectedBots().filter(b => b.tableId).length < 2) await poker.ops.join(W); else await poker.ops.act(W);
    await sleep(20);
  }
  return false;
}

async function step(W, kind, sig) {
  let note = '';
  if (kind === 'midhand') {
    note = (await untilLive(W, 6000)) ? 'hand live' : 'no hand live';
    await W.settlePoll();
    W.checker.markKill();
    return finish(W, kind, sig, note);
  }
  if (kind === 'showdown') {
    let got = false;
    const hooks = W.botList().map(b => { const f = () => { got = true; }; b.on('showdown_result', f); return [b, f]; });
    const end = Date.now() + 9000;
    while (!got && Date.now() < end) { if (W.connectedBots().filter(b => b.tableId).length < 2) await poker.ops.join(W); else await poker.ops.act(W); await sleep(10); }
    for (const [b, f] of hooks) { const l = b.listeners.get('showdown_result'); const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); }
    note = got ? 'right after a showdown_result' : 'no showdown within 9 s';
    await W.settlePoll();
    W.checker.markKill();
    return finish(W, kind, sig, note);
  }
  if (kind === 'spin') {
    const bots = W.connectedBots();
    const bot = W.rng.pick(bots), mode = W.rng.chance(0.5) ? 'play' : 'chips', bet = W.rng.pick([1, 2, 10, 20, 50, 100]);
    await W.settlePoll();
    W.checker.markKill();
    W.inflightSpins.push({ key: bot.key, mode, bet, buy: null, cost: bet });
    bot.emit('g:bender:spin', { bet, mode, buyBonus: null });
    await sleep(W.rng.int(3));
    return finish(W, kind, sig, `spin ${mode} ${bet} by ${bot.key}`, true);
  }
  if (kind === 'buyins') {
    const tables = [...W.tables.values()].filter(t => !t.ended && !t.gone);
    const cand = W.connectedBots().filter(b => !b.tableId);
    await W.settlePoll();
    W.checker.markKill();
    let n = 0;
    for (const b of cand.slice(0, 4)) { const t = W.rng.pick(tables); b.emit('table_join', { tableId: t.id, buyIn: t.min + W.rng.int(400), fund: W.rng.chance(0.4) ? (t.cur === 'chips' ? 'play' : 'chips') : undefined }); n++; }
    await sleep(W.rng.int(8));
    return finish(W, kind, sig, `${n} buy-ins in a burst`, true);
  }
  throw new Error('unknown chaos kind ' + kind);
}

async function finish(W, kind, sig, note) {
  await W.killAndRestart(sig, { marked: true });
  return { actor: 'chaos', what: 'kill', kind, sig, note };
}

module.exports = { step };
