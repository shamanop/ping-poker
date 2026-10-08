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
  // ---- money formats: Play $ = dollars and cents, Chips = whole chips; mx in hundredths
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function money(units, mode) {
    const n = Math.round(Number(units) || 0);
    if (mode === 'chips') return group(n);
    const a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + group(Math.floor(a / 100)) + '.' + String(a % 100).padStart(2, '0');
  }
  const mxText = (mx) => group(Math.floor(mx / 100)) + '.' + String(mx % 100).padStart(2, '0') + 'x';
  window.CampaignCopy = { news, pctOf, oddsWords, money, mxText, hash, NEWS };
})();
