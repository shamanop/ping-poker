'use strict';
// Chaos: SIGKILL (sometimes SIGTERM) the server at a chosen moment, start it again on the SAME data dir, sign every bot in again.
// The kill is the only place the harness accepts money it was not told about, and only the two shapes the brief allows (soak.js reconcile()).
const { sleep } = require('../lib/bot');
const poker = require('./poker');
const slot = require('./coldcall');

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
  if (kind === 'settle') {
    // a hand settles and the server dies before any client hears it: the clients' showdown_result is dropped on our side, then we kill the moment the line is in the ledger
    note = (await untilLive(W, 8000)) ? 'hand live' : 'no hand live';
    await W.settlePoll();
    W.checker.markKill();
    W.mute.showdown = true;
    const n0 = W.checker.lines.length, end = Date.now() + 10000;
    let seen = false;
    while (Date.now() < end && !seen) {
      if (W.connectedBots().filter(b => b.tableId).length < 2) await poker.ops.join(W); else await poker.ops.act(W);
      W.checker.poll();
      seen = W.checker.lines.slice(n0).some(L => L.hand);
      if (!seen) await sleep(2);
    }
    note += seen ? ', hand batch written, result muted' : ', no hand settled in 10 s';
    return finish(W, kind, sig, note);
  }
  if (kind === 'spinlost') {
    const bot = W.rng.pick(W.connectedBots()), mode = W.rng.chance(0.5) ? 'play' : 'chips', bet = W.rng.pick([1, 2, 10, 20, 50, 100]);
    await W.settlePoll();
    W.checker.markKill();
    W.mute.bender = true; W.mute.achv = true;
    W.inflightSpins.push({ key: bot.key, mode, bet, buy: null, cost: bet });
    const n0 = W.checker.lines.length;
    bot.emit('g:bender:spin', { bet, mode, buyBonus: null });
    const end = Date.now() + 2000;
    while (Date.now() < end) { W.checker.poll(); if (W.checker.lines.length > n0) break; await sleep(1); }
    return finish(W, kind, sig, `spin ${mode} ${bet} by ${bot.key}, answer dropped`, true);
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
  if (kind === 'slotopen') {
    // a Cold Call decision is open (the stake sits in escrow, the player has not answered) when the server dies: boot replays it with the default choices and settles it ONCE
    const bots = W.connectedBots().filter(b => !W.model.slot.hasOpen(b.key));
    let got = null;
    for (const bot of bots.slice().sort(() => W.rng() - 0.5).slice(0, 3)) {
      got = await slot.ops.openDecision(W, bot, W.rng.chance(0.5) ? 'play' : 'chips', 6);
      if (got) break;
    }
    if (W.rng.chance(0.4) && got) { const o = W.rng.pick([...W.model.slot.open.values()]); const b = W.bots.get(o.key); if (b && b.connected()) b.emit('g:coldcall:ready', { roundId: o.rid }); }
    note = got ? `a ${got.pending && got.pending.k} decision of ${got.key} (stake ${got.cost}) is open` : 'no decision could be opened';
    await W.settlePoll();
    W.checker.markKill();
    return finish(W, kind, sig, note);
  }
  if (kind === 'slotcb') {
    // a Callback is armed and then played; its ONE MORE CALL / PICK prompt is open when the server dies (a free round: the record is on disk before anything else, nothing in escrow)
    let got = null, spins = 0, armedOnly = false;
    for (const bot of W.connectedBots().slice().sort(() => W.rng() - 0.5).slice(0, 3)) {
      const mode = W.rng.chance(0.5) ? 'play' : 'chips', k = `${bot.key}|${mode}`;
      if (W.model.slot.openOf(bot.key, mode)) continue;
      for (let i = 0; i < 40 && !got; i++) {
        const bet = [1, 2, 5, 10].find(b => b <= W.checker.balance(mode, mode === 'chips' ? 'bank:' + bot.key : 'play:' + bot.key));
        if (!bet) break;
        const armed = W.model.slot.armed.has(k) && !W.model.slot.unsure.has(k);
        if (armed && W.rng.chance(0.15)) { armedOnly = true; break; }                // leave it armed across the kill (that is a case too)
        await slot.ops.spinOnce(W, bot, { mode, bet }); spins++;
        const o = W.model.slot.openOf(bot.key, mode);
        if (o && o.callback) got = o;
        else if (o) { await slot.ops.decideAny(W, bot, o); }                         // a paid round's decision: answer it and go on
      }
      if (got || armedOnly) break;
    }
    note = got ? `Callback of ${got.key} open (${got.pending && got.pending.k}) after ${spins} spins` : armedOnly ? `a Callback is armed, not played (${spins} spins)` : `no Callback open after ${spins} spins`;
    await W.settlePoll();
    W.checker.markKill();
    return finish(W, kind, sig, note);
  }
  if (kind === 'slotlost') {
    // a slot spin is sent and the server dies before the client hears anything: the answer is dropped on our side; the ledger may hold the round, its open, or nothing
    const bot = W.rng.pick(W.connectedBots().filter(b => !W.model.slot.hasOpen(b.key)));
    if (!bot) return finish(W, kind, sig, 'no free bot');
    const mode = W.rng.chance(0.5) ? 'play' : 'chips', buy = W.rng.chance(0.5) ? W.rng.pick(['bonus1', 'bonus2', 'call']) : null;
    const bet = slot.ops.pickBetFor(W, bot, mode, buy);
    if (!bet) return finish(W, kind, sig, 'nobody can afford a spin');
    await W.settlePoll();
    W.checker.markKill();
    W.mute.slot = true;
    W.slot.inflight.set(`${bot.key}|${mode}`, [{ key: bot.key, mode, bet, buy, force: null, cost: buy ? W.slot.buyPrice[bet][buy] : bet }]);
    const n0 = W.checker.lines.length;
    bot.emit('g:coldcall:spin', { bet, mode, buyBonus: buy });
    const end = Date.now() + 2000;
    while (Date.now() < end) { W.checker.poll(); if (W.checker.lines.length > n0) break; await sleep(1); }
    return finish(W, kind, sig, `slot spin ${mode} ${bet} ${buy || 'plain'} by ${bot.key}, answer dropped`);
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
  try { await W.killAndRestart(sig, { marked: true }); } finally { W.mute.showdown = W.mute.bender = W.mute.achv = W.mute.slot = false; }
  return { actor: 'chaos', what: 'kill', kind, sig, note };
}

module.exports = { step };
