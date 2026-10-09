// Money 1008 K1-3 (message side): transport/handlers/admin.js passes on what the admin object says (message, code, wallet / atTable / inRound / total)
// and keeps the old texts when the admin object says nothing more. Stub admin object, no server, no port.
const path = require('path');
const admin = require(path.join(__dirname, '..', 'transport', 'handlers', 'admin.js'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const NUM = ['wallet', 'atTable', 'inRound', 'total'];

function rig(adm) {
  const handlers = {}, sent = [];
  const socket = { emit: (ev, p) => sent.push([ev, p]) };
  const accounts = { keyOf: s => String(s).toLowerCase(), get: k => (k === 'ann' ? { key: 'ann' } : null), displayOf: k => k, resetPin: () => ({ ok: true }) };
  const auth = { requireAdmin: () => 'chris', signOutSockets: () => 0 };
  const ctx = { accounts, auth, adm, views: { bankOf: () => 0 }, presLedger: { log() {} }, afterWrite() {}, socketsOf: () => [] };
  admin.register(ctx, socket, (ev, fn) => { handlers[ev] = fn; });
  return { call: (ev, p) => { sent.length = 0; handlers[ev](p); return sent.map(([, x]) => x).pop(); } };
}
const full = { wallet: 700, atTable: 300, inRound: 200, total: 1200 };

(() => {
  // a refusal with a message and the four numbers (what admin/index.js on mf-k1-admin answers)
  let r = rig({ setPlay: () => ({ ok: false, code: 'cash_in_play', message: 'Cannot set Cash to 0.00: 3.00 at tables (3.00) is in play.', ...full }) })
    .call('admin_set_play', { key: 'ann', cents: 0, opId: 'op1' });
  ok(r.ok === false && r.code === 'cash_in_play' && r.message === 'Cannot set Cash to 0.00: 3.00 at tables (3.00) is in play.', 'set_play refusal: code and the admin message pass through');
  ok(NUM.every(f => r[f] === full[f]), 'set_play refusal: wallet / atTable / inRound / total pass through');
  ok(r.opId === 'op1' && r.op === 'set_play' && r.key === 'ann', 'set_play refusal: op, key and opId are echoed');
  r = rig({ setPlay: () => ({ ok: false, code: 'op_required', message: 'Every money edit needs an op id (one per confirmed click). Nothing was changed.' }) }).call('admin_set_play', { key: 'ann', cents: 5 });
  ok(r.code === 'op_required' && /needs an op id/.test(r.message) && NUM.every(f => !(f in r)), 'set_play op_required: message passes through, no numbers invented');
  // success
  r = rig({ setPlay: () => ({ ok: true, ...full }) }).call('admin_set_play', { key: 'ann', cents: 1200, opId: 'op2' });
  ok(r.ok === true && r.message === 'Play set' && NUM.every(f => r[f] === full[f]) && r.opId === 'op2', 'set_play success: the four numbers are added');
  r = rig({ setPlay: () => ({ ok: true, dup: true, wallet: 5, atTable: 0, inRound: 0, total: 5 }) }).call('admin_set_play', { key: 'ann', cents: 5, opId: 'op3' });
  ok(r.ok === true && r.wallet === 5 && r.atTable === 0 && r.inRound === 0 && r.total === 5, 'set_play success: zero values are kept');
  // an admin object that says nothing more (today\'s master): the old texts, no number keys
  r = rig({ setPlay: () => ({ ok: true }) }).call('admin_set_play', { key: 'ann', cents: 5, opId: 'x' });
  ok(r.ok === true && r.message === 'Play set' && NUM.every(f => !(f in r)), 'old admin object: success text unchanged, no number keys');
  r = rig({ setPlay: () => ({ ok: false, code: 'weird' }) }).call('admin_set_play', { key: 'ann', cents: 5, opId: 'x' });
  ok(r.ok === false && r.message === 'Could not set Play' && r.code === 'weird', 'old admin object: failure text unchanged');
  r = rig({ setPlay: () => ({ ok: false, code: 'range' }) }).call('admin_set_play', { key: 'ann', cents: 5, opId: 'x' });
  ok(r.message === 'Enter a Play amount in range', 'old admin object: range text unchanged');
  r = rig({ setPlay: () => { throw new Error('must not be called'); } }).call('admin_set_play', { key: 'nobody', cents: 5, opId: 'x' });
  ok(r.code === 'unknown_player' && r.message === 'Unknown player', 'unknown player unchanged');
  // admin_adjust
  r = rig({ adjust: () => ({ ok: false, code: 'op_required', message: 'Every money edit needs an op id (one per confirmed click). Nothing was changed.' }) }).call('admin_adjust', { key: 'ann', delta: 5, cur: 'play', reason: 'x' });
  ok(r.ok === false && r.code === 'op_required' && /needs an op id/.test(r.message), 'adjust op_required: the admin message passes through');
  r = rig({ adjust: () => ({ ok: false, code: 'insufficient' }) }).call('admin_adjust', { key: 'ann', delta: -5, cur: 'play', reason: 'x', opId: 'a' });
  ok(r.message === 'Not enough to remove' && r.opId === 'a', 'adjust: old insufficient text unchanged');
  r = rig({ adjust: () => ({ ok: false, code: 'bad_cur' }) }).call('admin_adjust', { key: 'ann', delta: -5, cur: 'zz', reason: 'x', opId: 'a' });
  ok(r.message === 'Could not adjust', 'adjust: old generic text unchanged');
  r = rig({ adjust: () => ({ ok: true }) }).call('admin_adjust', { key: 'ann', delta: 5, cur: 'play', reason: 'x', opId: 'a' });
  ok(r.ok === true && r.message === 'Adjusted', 'adjust success unchanged');
  // reset_pin: the message says what was done
  const rr = rig({}); r = rr.call('admin_reset_pin', { key: 'ann', newPin: '1234' });
  ok(r.ok === true && /signed out/i.test(r.message), 'reset_pin: ok message says the sessions were signed out');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
