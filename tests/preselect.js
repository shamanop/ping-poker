'use strict';
// Pre-select: fires once, clears on a raise, never auto-acts for a different amount.
const { startServer, mk, waitFor, sleep } = require('./lib.js');

(async () => {
  const srv = await startServer(3218, { ann: 10000, bob: 10000, cat: 10000 });
  let fail = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
  try {
    const cs = await mk(srv, ['Ann', 'Bob', 'Cat']);
    for (const c of cs) { c.pre = null; c.sock.on('your_cards', d => { c.pre = d.preselect || null; }); }
    const byIdx = i => cs.find(c => c.idx() === i);
    const cur = () => cs[0].gs && cs[0].gs.currentPlayerIdx;
    const emitPre = (c, kind, amount) => c.emit('preselect', { roomId: 'POKERPING', mode: kind, amount });

    await waitFor(() => cs[0].gs && cs[0].gs.status === 'playing' && cs[0].gs.handNum === 1 && cur() !== null, 12000);
    await sleep(300);
    const gs = () => cs[0].gs;
    const dealer = gs().dealerIdx, sb = (dealer + 1) % 3, bb = (dealer + 2) % 3;
    const utg = byIdx(dealer), sbC = byIdx(sb), bbC = byIdx(bb);
    check(cur() === dealer, 'preflop first to act is the dealer (3-handed)');

    // invalid input is rejected and arms nothing
    const rej = async (c, payload, msg) => { const n = c.errors.length; c.emit('preselect', { roomId: 'POKERPING', ...payload }); await sleep(250); check(c.errors.length === n + 1 && c.pre === null, msg); };
    await rej(utg, { mode: 'checkfold' }, 'rejected on own turn');
    await rej(sbC, { mode: 'bogus' }, 'rejected: unknown mode');
    await rej(sbC, { mode: 'call', amount: '10' }, 'rejected: non-numeric amount');
    await rej(sbC, { mode: 'call' }, 'rejected: missing amount');
    await rej(sbC, { mode: 'call', amount: -10 }, 'rejected: negative amount');

    // a) call exactly 10 pre-selected by the small blind fires once when UTG just calls
    emitPre(sbC, 'call', 999);
    await sleep(250);
    check(sbC.pre === null && sbC.errors.length > 0, 'wrong call amount is rejected');
    emitPre(sbC, 'call', 10);
    await waitFor(() => sbC.pre && sbC.pre.mode === 'call', 2000);
    check(sbC.pre && sbC.pre.amount === 10, 'call 10 accepted and echoed back privately');
    check(!cs.some(c => c !== sbC && c.pre), 'pre-select is not visible to other players');
    utg.act('call');
    await waitFor(() => gs().players[sb].lastAction === 'CALL', 3000);
    check(gs().players[sb].lastAction === 'CALL' && gs().currentPlayerIdx === bb, 'small blind auto-called 10 when it came round');
    check(sbC.pre === null, 'pre-select cleared after firing (fires once)');
    bbC.act('check');

    // b) flop: SB bets 60, BB sits, dealer pre-selects call 60, BB raises -> cleared, dealer must decide
    await waitFor(() => gs().street === 'flop' && cur() === sb, 4000);
    check(gs().street === 'flop' && cur() === sb, 'flop reached, small blind on turn');
    sbC.act('raise', 60);
    await waitFor(() => gs().currentBet === 60 && cur() === bb, 2000);
    emitPre(utg, 'call', 60);
    await waitFor(() => utg.pre && utg.pre.amount === 60, 2000);
    check(utg.pre && utg.pre.amount === 60, 'dealer queued call 60');
    bbC.act('raise', 120);
    await waitFor(() => gs().currentBet === 120 && cur() === dealer, 3000);
    await sleep(900);
    check(utg.pre === null, 'pre-select cleared when the bet was raised');
    check(cur() === dealer && gs().players[dealer].roundBet === 0 && !gs().log.some(l => l.startsWith(gs().players[dealer].name + ' calls 60') || l.startsWith(gs().players[dealer].name + ' calls 120')), 'dealer was NOT auto-called for the new amount and still holds the decision');
    utg.act('call');
    await waitFor(() => cur() === sb, 2000);
    sbC.act('call');

    // c) turn: all check, dealer check/fold -> auto-check
    await waitFor(() => gs().street === 'turn' && cur() === sb, 4000);
    emitPre(utg, 'checkfold');
    await waitFor(() => utg.pre && utg.pre.mode === 'checkfold', 2000);
    sbC.act('check');
    await waitFor(() => cur() === bb, 2000);
    bbC.act('check');
    // v2: the street closes the moment the dealer's auto-check lands and lastAction is cleared with it, so the transient CHECK on the turn is never visible: the proof is the river arriving with the dealer still in
    await waitFor(() => gs().street === 'river', 3000);
    check(gs().street === 'river' && !gs().players[dealer].folded, 'check/fold auto-checked when nothing was owed');

    // d) river: SB bets 40, dealer check/fold with a bet outstanding -> auto-fold
    await waitFor(() => gs().street === 'river' && cur() === sb, 4000);
    sbC.act('raise', 40);
    await waitFor(() => gs().currentBet === 40 && cur() === bb, 2000);
    emitPre(utg, 'checkfold');
    await waitFor(() => utg.pre && utg.pre.mode === 'checkfold', 2000);
    bbC.act('call');
    await waitFor(() => gs().players[dealer].folded || gs().handNum > 1, 3000);
    check(gs().players[dealer].folded || gs().handNum > 1, 'check/fold auto-folded facing a bet');

    // e) never leaks into the next hand
    await waitFor(() => gs().handNum === 2, 15000);
    await sleep(300);
    check(cs.every(c => c.pre === null), 'no pre-select survives into the next hand');
  } catch (e) { console.log('ERR', e); fail++; }
  srv.stop();
  process.exit(fail ? 1 : 0);
})();
