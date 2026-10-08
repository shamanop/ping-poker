/* Campaign Trail: words. Ticker lines, odds in plain words, money formats. No rules here: every number comes from the server. */
(function () {
  'use strict';
  // ---- ticker lines (parody; no real people; parties only ever as colours). {S} state name, {P} growth like +10%
  const NEWS = {
    safe: [
      'Quiet night in {S}: {P}', 'Yard signs hold steady in {S}, {P}', '{S} yawns, then delivers {P}', 'Pancake breakfast carries {S}: {P}',
      'Safe seat, safe hands in {S}: {P}', 'Polls close early in {S}. Nobody is surprised: {P}', 'Bake sale tops the polls in {S}: {P}', 'Church bells and casseroles: {S} goes {P}'
    ],
    lean: [
      'Rally in {S}: {P}', 'Town hall packs the gym in {S}: {P}', 'Red and blue both claim {S}. The math says {P}', 'Bus tour rolls through {S}: {P}',
      'Pundits lean in on {S}: {P}', 'Diner poll in {S} breaks your way: {P}', 'Lawn signs multiply overnight in {S}: {P}', 'Phone banks hum in {S}: {P}'
    ],
    swing: [
      'Coin lands heads in {S}: {P}', 'Knife-edge night in {S}, and you cut it: {P}', 'Every network is camped in {S}. You take it: {P}', 'Recount crews stand down in {S}: {P}',
      '{S} swings your way, hard: {P}', 'Fireworks in {S}. Somebody owes somebody: {P}', 'The map holds its breath, then {S} says {P}', 'Swing state, big swing: {S} {P}'
    ],
    scandal: [
      'SCANDAL in {S}: the leaked memo was about a sandwich', 'SCANDAL in {S}: hot mic, hotter take', 'SCANDAL in {S}: the yacht had a second yacht',
      'SCANDAL in {S}: receipts, plural', 'SCANDAL in {S}: the tape was NOT a bit', 'SCANDAL in {S}: ghost voters, haunted spreadsheet',
      'SCANDAL in {S}: campaign bus found in a lake', 'SCANDAL in {S}: the donor list reads like a menu'
    ],
    landslide: ['LANDSLIDE! All 50 states carried. The networks run out of adjectives', 'LANDSLIDE in {S}: every state, every county, every diner'],
    deadend: ['Out of road in {S}: victory declared', '{S} is the end of the line: victory declared', 'No states left to carry past {S}: victory declared'],
    open: ['Polls open in {S}. This is home.', 'The bus pulls out of {S}. The night is young.', '{S} is home turf. Pick your first state.'],
    cashout: ['Victory declared. The room goes quiet, then loud.', 'You call it and walk. The count is final.', 'Concession speeches all round. You keep the win.'],
    withdrawn: ['Campaign suspended before it began: stake returned.', 'You pull out at the starting gate. Stake returned.'],
    timeout: ['The clock ran out: victory declared for you.', 'Too long on the stump. The night auto cashed you out.'],
    boot: ['The count was interrupted: you were cashed out at your standing.', 'Studio restart. The result was locked at your last multiplier.']
  };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function news(kind, vars, seed) {
    const list = NEWS[kind] || NEWS.cashout;
    const line = list[hash(String(seed || '') + kind) % list.length];
    return line.replace(/\{S\}/g, (vars && vars.S) || '').replace(/\{P\}/g, (vars && vars.P) || '');
  }
  const pctOf = (g100) => '+' + (g100 - 100) + '%';
  // ---- odds in words, from pFail only (CAMPAIGN-DESIGN section 4): never shown better than it is
  function oddsWords(pFail) {
    if (!(pFail > 0)) return 'no scandal risk';
    if (pFail <= 0.5) return '1 in ' + Math.floor(1 / pFail) + ' scandal';
    return '1 in ' + Math.ceil(1 / (1 - pFail)) + ' to win';
  }
  // the LANDSLIDE step is the one card whose odds are quoted as a WIN chance: say so in words that cannot be read as a scandal chance
  const oddsFinal = (pFail) => (pFail > 0.5 ? 'all or nothing: ' + oddsWords(pFail) : oddsWords(pFail));
  // ---- money formats: Cash = dollars and cents, Chips = whole chips; mx in hundredths
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // the site's own display preference (Money.pref in the shell page): Chips may be shown as dollars when the player chose that; default is whole chips
  function chipsAsUsd() { try { const M = window.parent && window.parent !== window ? window.parent.Money : null; return !!(M && (M.pref === 'usd' || (M.getPref && M.getPref() === 'usd'))); } catch (e) { return false; } }
  function money(units, mode) {
    const n = Math.round(Number(units) || 0);
    if (mode === 'chips' && !chipsAsUsd()) return group(n);
    const a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + group(Math.floor(a / 100)) + '.' + String(a % 100).padStart(2, '0');
  }
  const mxText = (mx) => group(Math.floor(mx / 100)) + '.' + String(mx % 100).padStart(2, '0') + 'x';
  // ---- server error codes -> plain sentences. `ctx` is what the player was doing when it came back (cash | step | start | ''). Nothing here is a rule: it only words what the server said.
  const SAFE = ' Your stake is safe. Try again.';
  const ERRS = {
    money_down: { cash: 'Cash-out refused: money is unavailable.' + SAFE, step: 'Step refused: money is unavailable.' + SAFE, start: 'Could not start: money is unavailable. Nothing was taken. Try again.', def: 'Money is unavailable right now.' + SAFE },
    internal: { cash: 'Cash-out refused: money is unavailable.' + SAFE, step: 'That step did not go through.' + SAFE, start: 'Could not start the run. Nothing was taken. Try again.', def: 'Something went wrong on our side. Try again.' },
    funds: { def: 'Not enough funds for that stake.' }, auth: { def: 'Sign in again to play.' }, rate: { def: 'Easy. One tap at a time.' },
    round_closed: { def: 'That run was already settled.' }, bad_bet: { def: 'That stake is not available. Pick another.' }, bad_home: { def: 'Pick a home state first.' }, bad_mode: { def: 'Pick Cash or Chips first.' },
    run_open: { def: 'A run is already open. Picking it up.' }
  };
  function errorText(code, ctx, serverMsg) {
    const e = ERRS[code]; if (e) { const t = e[ctx] || e.def; if (code === 'funds' && serverMsg && /^not enough/i.test(serverMsg)) return serverMsg; return t; }
    return serverMsg && serverMsg !== 'Server error' ? serverMsg : 'Something went wrong. Try again.';
  }
  window.CampaignCopy = { errorText, oddsFinal, oddsFinal, news, pctOf, oddsWords, money, mxText, hash, NEWS };
})();
