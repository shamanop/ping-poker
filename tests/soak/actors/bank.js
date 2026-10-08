'use strict';
// Actor: bank moves. New signups, Cash top-ups (with the refusal codes), the daily bonus (claimed twice in a row), admin plus / minus /
// minus-too-big / set-play, and a non-admin trying an admin event. Every expectation is computed from the harness' own model.
const { sleep } = require('../lib/bot');
const TOPUP_BELOW = 10000, START_PLAY = 1000000, COOLDOWN_MS = 3600000;      // V2-DESIGN "money/" top-up rule
const lastTopup = new Map();
let signups = 0, topupSeq = 0;

const unseated = W => W.connectedBots().filter(b => !b.tableId && b.spinsInFlight === 0);

async function signup(W) {
  if (W.bots.size >= W.nPlayers + 8) return null;
  const name = `New${W.seed % 1000}x${++signups}`;
  const b = W.addBot(name);
  await b.connect();
  const r = await b.signup();
  if (!r.data) { W.bots.delete(b.key); b.close(); throw new Error(`signup of ${name} failed: ${JSON.stringify(r.error || r)}`); }
  W.model.addPlayer(b.key);
  W.lastSignupAt = Date.now();
  await sleep(150);                                    // accounts.json is written 50 ms after a signup: never kill before that
  return { what: 'signup', who: b.key };
}

async function adminCall(W, ev, payload, op) {
  const r = await W.admin.req(ev, payload, 'admin_result', 4000, { pred: d => d.op === op });
  if (r.timeout) throw new Error(`${ev} got no admin_result (harness problem)`);
  return r;
}

// what the ledger says the player's wallet / bank holds right now (the account an admin edit or a spin acts on)
const walletOf = (W, key, cur) => { W.checker.poll(); return W.checker.balance(cur, (cur === 'chips' ? 'bank:' : 'play:') + key); };

// bb298d2 ("Cash is set by the admin"): wallet_topup is refused with topup_off for everybody, always, and mints nothing. The old rule (bring wallet + Play seats back to START_PLAY, hourly cooldown) is gone; a mint:topup
// line would break I2 (mint:topup is expected to stay 0). A `wallet` push that arrives meanwhile is another game's timer credit, not a grant.
async function topup(W) {
  const cand = unseated(W);
  if (!cand.length) return null;
  const b = W.rng.pick(cand), key = b.key;
  const r = await b.req('wallet_topup', {}, 'wallet', 1500, { pred: () => false });
  if (r.error) {
    if (r.error.code !== 'topup_off') W.violate('I7', `top-up refused with ${r.error.code}, expected topup_off`, { key }, 'topup_off', r.error.code);
    return { what: 'topup', who: key, note: 'refused ' + r.error.code };
  }
  return { what: 'topup', who: key, note: 'no answer (ok: Cash top-up is off)' };
}

async function bonus(W) {
  const b = W.rng.pick(W.connectedBots());
  if (!b) return null;
  const st = await b.req('bonus:status', {}, 'bonus:status', 3000);
  if (!st.data) return null;
  const c1 = await b.req('bonus:claim', {}, 'bonus:claimed', 3000);
  if (!c1.data) { W.violate('I7', `bonus:claim from ${b.key} got no answer`, { key: b.key }, 'bonus:claimed', JSON.stringify(c1.error || 'timeout')); return null; }
  if (st.data.available) {
    if (!c1.data.ok || c1.data.amountCents !== st.data.amountCents) W.violate('I7', `bonus for ${b.key}: status said ${st.data.amountCents}, claim answered ${JSON.stringify(c1.data)}`, { key: b.key }, st.data.amountCents, JSON.stringify(c1.data));
    if (c1.data.ok && !(st.data.schedule || W.bonusSchedule).includes(c1.data.amountCents)) W.violate('I2', `bonus amount ${c1.data.amountCents} is not in the schedule`, { key: b.key }, W.bonusSchedule.join(','), c1.data.amountCents);
  } else if (c1.data.ok) W.violate('I7', `bonus for ${b.key}: status said already claimed, the claim paid ${c1.data.amountCents}`, { key: b.key }, 'refused', JSON.stringify(c1.data));
  const c2 = await b.req('bonus:claim', {}, 'bonus:claimed', 3000);
  if (!c2.data || c2.data.ok) W.violate('I7', `second bonus claim in a row for ${b.key} was not refused`, { key: b.key }, '{ok:false}', JSON.stringify(c2.data || c2.error));
  return { what: 'bonus', who: b.key, first: c1.data.ok ? c1.data.amountCents : 'claimed', second: c2.data && c2.data.ok ? 'PAID' : 'refused' };
}

async function admin(W) {
  const bots = W.connectedBots();
  if (!bots.length || !W.admin.connected()) return null;
  const op = W.rng.weighted([[26, 'plus'], [18, 'minus'], [18, 'toobig'], [14, 'setplay'], [6, 'nonadmin']]);
  const t = W.rng.pick(bots), key = t.key;
  if (op === 'plus') {
    const cur = W.rng.pick(['chips', 'play']), delta = W.rng.range(1, 50000);
    const r = await adminCall(W, 'admin_adjust', { key, delta, cur, reason: 'soak plus' }, 'adjust');
    if (!(r.data && r.data.ok)) { W.violate('I7', `admin plus ${delta} ${cur} to ${key} refused`, { key }, 'ok', JSON.stringify(r.data || r.error)); return null; }
    W.model.applyAdmin(key, cur, delta);
    return { what: 'admin_plus', who: key, cur, amount: delta };
  }
  if (op === 'minus') {
    if (t.tableId) return null;
    const cur = W.rng.pick(['chips', 'play']), held = walletOf(W, key, cur);
    if (held < 1) return null;
    const delta = -W.rng.range(1, Math.min(held, 40000));
    const r = await adminCall(W, 'admin_adjust', { key, delta, cur, reason: 'soak minus' }, 'adjust');
    if (!(r.data && r.data.ok)) { W.violate('I7', `admin minus ${-delta} ${cur} from ${key} (holds ${held}, unseated) refused`, { key }, 'ok', JSON.stringify(r.data || r.error)); return null; }
    W.model.applyAdmin(key, cur, delta);
    return { what: 'admin_minus', who: key, cur, amount: delta };
  }
  if ((op === 'toobig' || op === 'setplay') && W.model.slot.hasOpen(key)) return null;     // see topup: a timer credit between our read and the server's would make a refusal / a delta wrong
  if (op === 'toobig') {
    const cur = W.rng.pick(['chips', 'play']);
    const delta = -(W.model.held(key, cur) + W.rng.range(1, 1000));    // more than everything the player holds (wallet and seats), so more than the wallet
    const r = await adminCall(W, 'admin_adjust', { key, delta, cur, reason: 'soak too big' }, 'adjust');
    if (!r.data || r.data.ok || r.data.code !== 'insufficient') { W.violate('I7', `admin minus ${-delta} ${cur} from ${key} was not refused with insufficient`, { key }, 'insufficient', JSON.stringify(r.data || r.error)); return null; }
    W.model.count.adminRefused++;
    return { what: 'admin_toobig', who: key, cur, amount: delta, result: 'refused' };
  }
  if (op === 'setplay') {
    if (t.tableId) return null;
    const cents = W.rng.chance(0.3) ? walletOf(W, key, 'play') : W.rng.range(0, 3000000);
    const delta = cents - walletOf(W, key, 'play');
    const r = await adminCall(W, 'admin_set_play', { key, cents }, 'set_play');
    if (!(r.data && r.data.ok)) { W.violate('I7', `admin_set_play ${cents} for ${key} refused`, { key }, 'ok', JSON.stringify(r.data || r.error)); return null; }
    if (delta !== 0) W.model.applyAdmin(key, 'play', delta);
    if (walletOf(W, key, 'play') !== cents && !t.tableId) W.warn('setplay_landed_elsewhere', `${key}: wallet ${walletOf(W, key, 'play')} after set_play ${cents}`);
    return { what: 'admin_setplay', who: key, cents, delta };
  }
  // a non-admin sending an admin event must be refused and move nothing (the ledger checks would show it)
  const plain = bots.find(b => !b.key.startsWith('chris'));
  if (!plain) return null;
  const r = await plain.req('admin_adjust', { key: plain.key, delta: 99999, cur: 'play', reason: 'sneaky' }, 'admin_result', 1500);
  if (r.data && r.data.ok) { W.violate('I7', `${plain.key} is not an admin and admin_adjust paid out`, { key: plain.key }, 'refused', JSON.stringify(r.data)); return null; }
  return { what: 'admin_nonadmin', who: plain.key, result: r.error ? r.error.code : 'ignored' };
}

module.exports = {
  name: 'bank', weight: 10,
  async step(W) {
    const op = W.rng.weighted([[8, signup], [24, topup], [30, bonus], [38, admin]]);
    const r = await op(W);
    return r ? { actor: 'bank', ...r } : null;
  },
};
