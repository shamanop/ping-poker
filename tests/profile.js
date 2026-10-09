// Profile: rename (rules, rate limit, propagation to a live seat, money keyed by account) and custom avatar photo. Temp data, port 4791.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { io } = (() => { try { return require(process.env.SIO_CLIENT || 'socket.io-client'); } catch { return require('/home/isabelle/.cache/node_modules/socket.io-client'); } })();   // SIO_CLIENT, else the repo's own node_modules, else Isabelle's cache dir
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppfl-'));
const PORT = Number(process.env.PROFILE_PORT || 4791), ROOT = path.join(__dirname, '..');
const F = { bank: path.join(dir, 'bank.json'), ledger: path.join(dir, 'ledger.json'), acc: path.join(dir, 'accounts.json'), tables: path.join(dir, 'tables.json') };
fs.writeFileSync(F.bank, JSON.stringify({ chris: 100000 }));
const env = { SIGNUP_PLAY_CENTS: '1000000', ...process.env, PORT: String(PORT), AUTO_START_MS: '600000', AUTH_CLOCK_SKEW: '0', AUTH_SIGNUP_LIMIT: '100', BANK_FILE: F.bank, LEDGER_FILE: F.ledger, ACCOUNTS_FILE: F.acc, TABLES_FILE: F.tables };
const proc = spawn('node', ['server.js'], { cwd: ROOT, env });
let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function client() {
  const c = { ev: [], gs: null };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.onAny((e, d) => c.ev.push([e, d]));
  c.s.on('game_state', g => { c.gs = g; });
  c.call = async (ev, payload, ...want) => {
    const start = c.ev.length;
    c.s.emit(ev, payload);
    for (let i = 0; i < 80; i++) {
      const hit = c.ev.slice(start).find(([e]) => want.includes(e));
      if (hit) return hit;
      await sleep(30);
    }
    return [null, null];
  };
  c.has = (name, fn) => c.ev.some(([e, d]) => e === name && (!fn || fn(d)));
  return c;
}
async function signup(name) {
  const c = client();
  const [e, d] = await c.call('auth_signup', { name, pin: '1234', avatar: 'a02' }, 'auth_ok', 'auth_error');
  if (e !== 'auth_ok') throw new Error('signup failed ' + name + ' ' + JSON.stringify(d));
  c.key = d.account.key;
  return c;
}
async function waitFor(fn, ms = 4000) { for (let t = 0; t < ms; t += 40) { if (fn()) return true; await sleep(40); } return false; }
const crc = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
function png(w = 16, seed = 0) {
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = seed < 0 ? require('crypto').randomBytes((w * 3 + 1) * w) : Buffer.alloc((w * 3 + 1) * w); if (seed >= 0) for (let y = 0; y < w; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13 + seed) & 255;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const settings = () => ({ name: 'Profile Night', mode: 'play', buyIn: { min: 500, max: 5000, default: 1000 }, blinds: { sb: 5, bb: 10 }, seats: 8, actionTimerSec: 60, rebuys: true, isPrivate: false });

(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const A = await signup('Alice'), B = await signup('Bobby');
    const upd = async (c, p) => { const n = c.ev.length; c.s.emit('profile_update', p); await sleep(160); return c.ev.slice(n); };
    const errOf = evs => { const x = evs.find(([e]) => e === 'profile_error'); return x ? x[1] : null; };
    const accFile = () => JSON.parse(fs.readFileSync(F.acc, 'utf8')).accounts;
    const flushWait = () => sleep(200);

    // ── seat both at a table first so propagation can be checked ──
    let [e, d] = await A.call('table_create', { settings: settings() }, 'table_created', 'error');
    const T = d.table.id;
    await A.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    await B.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    await waitFor(() => B.gs && B.gs.players.length === 2);
    ok(B.gs.players.some(p => p.name === 'Alice'), 'seat shows Alice before rename');

    // ── rename rules ──
    for (const [label, name] of [['too short', 'x'], ['too long', 'abcdefghijklmnopq'], ['bad chars', 'Al<ice>'], ['emoji', 'Ali\u{1F600}']]) {
      const ev = await upd(A, { display: name });
      ok(errOf(ev) && errOf(ev).field === 'display', 'rename rejected: ' + label);
    }
    let ev = await upd(A, { display: 'bobby' });
    ok(errOf(ev) && /taken/i.test(errOf(ev).message), "rename to another account's name (any case) rejected");
    ev = await upd(A, { display: 'Alicia' });
    ok(!errOf(ev) && ev.some(([x, y]) => x === 'profile' && y.display === 'Alicia' && y.key === 'alice'), 'rename ok: display changes, key stays');
    ok(ev.some(([x, y]) => x === 'self_changed' && y.display === 'Alicia'), 'own sockets get self_changed');
    ev = await upd(A, { display: 'Alicia2' });
    ok(errOf(ev) && /seconds/.test(errOf(ev).message), 'second rename within 30s is rate limited');
    ev = await upd(A, { display: 'Alicia' });
    ok(!errOf(ev), 'resubmitting the same name is a no-op, not an error');
    await A.call('__test_skew', { ms: 31000 }, 'ok');
    ev = await upd(A, { display: 'ALICIA' });
    ok(!errOf(ev) && ev.some(([x, y]) => x === 'profile' && y.display === 'ALICIA'), 're-casing own name allowed after the gap');
    await flushWait();
    ok(accFile().alice && accFile().alice.display === 'ALICIA' && !accFile().alicia, 'accounts.json: same key, new display');

    // ── propagation ──
    ok(await waitFor(() => B.gs.players.some(p => p.name === 'ALICIA')) && !B.gs.players.some(p => p.name === 'Alice'), 'other seat sees the new name without leaving');
    ok(B.gs.players.length === 2 && B.gs.players.find(p => p.name === 'ALICIA').chips === 1000, 'seat and stack unchanged');
    ok(B.has('room_update', r => r.players.some(p => p.name === 'ALICIA')), 'room_update carries the new name');
    ok(B.has('account_changed', v => v.key === 'alice' && v.display === 'ALICIA'), 'everyone gets account_changed');
    [e, d] = await B.call('table_preview', { code: T }, 'table_info', 'error');
    ok(d.seated.some(s => s.key === 'alice' && s.display === 'ALICIA'), 'table_info seated list uses the new name');
    [e, d] = await B.call('profile_get', { key: 'alice' }, 'profile', 'error');
    ok(d.display === 'ALICIA' && d.key === 'alice', 'profile_get shows the new name');

    // ── login/signup with names ──
    const L = client();
    [e, d] = await L.call('auth_login', { name: 'alicia', pin: '1234' }, 'auth_ok', 'auth_error');
    ok(e === 'auth_ok' && d.account.key === 'alice' && d.account.display === 'ALICIA', 'login by new display name resolves to the same account');
    [e, d] = await L.call('auth_login', { name: 'alice', pin: '1234' }, 'auth_ok', 'auth_error');
    ok(e === 'auth_ok' && d.account.key === 'alice', 'login by original key still works');
    [e, d] = await client().call('auth_signup', { name: 'Alicia', pin: '1234', avatar: 'a01' }, 'auth_ok', 'auth_error');
    ok(e === 'auth_error' && d.code === 'name_taken', "signup with someone's current display name is rejected");
    [e, d] = await client().call('auth_signup', { name: 'Zed Test', pin: '1234', avatar: 'a01' }, 'auth_ok', 'auth_error');
    ok(e === 'auth_ok', 'normal signup still works');

    // ── money stays on the account key ──
    // v2: check_balance is deleted, the account's money arrives as the `money` event right after auth_ok
    const [, d2] = await client().call('auth_login', { name: 'alice', pin: '1234' }, 'money');
    await sleep(400); // v2: bank.json is a debounced (250 ms) write-only mirror
    const bankBefore = JSON.parse(fs.readFileSync(F.bank, 'utf8'));
    [e, d] = await client().call('auth_login', { name: 'ALICIA', pin: '1234' }, 'money');
    ok(d && d2 && d.chips === d2.chips, 'bank balance by new display equals balance by key');
    await sleep(200);
    const bankAfter = JSON.parse(fs.readFileSync(F.bank, 'utf8'));
    ok(!('alicia' in bankAfter) && Object.keys(bankAfter).length === Object.keys(bankBefore).length, 'no second bank entry created for the new name');
    const rows = JSON.parse(fs.readFileSync(F.ledger, 'utf8'));
    ok(!rows.some(r => r.key && r.key === 'alicia'), 'ledger rows stay keyed by account key');

    // ── avatar photo ──
    const good = dataUrl('image/png', png(16));
    ev = await upd(A, { avatarPic: dataUrl('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')) });
    ok(errOf(ev) && errOf(ev).field === 'avatarPic', 'svg rejected');
    ev = await upd(A, { avatarPic: dataUrl('image/gif', Buffer.from('GIF89a' + 'x'.repeat(40))) });
    ok(errOf(ev), 'gif rejected');
    ev = await upd(A, { avatarPic: dataUrl('image/png', Buffer.from('<svg xmlns="x"></svg>----------------')) });
    ok(errOf(ev), 'png label with non-png bytes rejected');
    ev = await upd(A, { avatarPic: dataUrl('image/png', png(128, -1)) });
    ok(errOf(ev), 'oversized (>40KB) picture rejected: ' + dataUrl('image/png', png(128, -1)).length);
    ev = await upd(A, { avatarPic: 'javascript:alert(1)' });
    ok(errOf(ev), 'non data-url rejected');
    ok(!accFile().alice.avatarPic, 'rejected pictures were not stored');

    ev = await upd(A, { avatarPic: good });
    const pr = ev.find(([x]) => x === 'profile');
    ok(!errOf(ev) && pr && /^\/apic\/alice\/[a-f0-9]{10}$/.test(pr[1].pic), 'valid PNG accepted, profile exposes a short URL: ' + (pr && pr[1].pic));
    const url = pr && pr[1].pic;
    const r = await fetch(`http://localhost:${PORT}${url}`);
    const body = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get('content-type') === 'image/png' && /immutable/.test(r.headers.get('cache-control')) && body.equals(png(16)), 'GET /apic serves the image, immutable cache, exact bytes');
    ok((await fetch(`http://localhost:${PORT}/apic/nobody/0123456789`)).status === 404, 'missing pic is a 404');
    ok(await waitFor(() => B.gs.players.find(p => p.name === 'ALICIA').profilePic === url), 'seat for the other player carries the picture URL');
    const gsLen = JSON.stringify(B.gs).length;
    ok(gsLen < 6000 && !JSON.stringify(B.gs).includes('base64'), 'game_state stays small, no inline image bytes: ' + gsLen + ' bytes');
    [e, d] = await B.call('table_preview', { code: T }, 'table_info', 'error');
    ok(d.seated.find(s => s.key === 'alice').pic === url, 'seated list carries pic URL');
    B.s.emit('get_leaderboard', {}); await sleep(150);
    await flushWait();
    ok(accFile().alice.avatarPic === good, 'picture stored on the account');

    // re-seat after leaving keeps picture and name
    A.s.emit('table_leave', { tableId: T }); await sleep(250);
    await A.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    ok(await waitFor(() => { const p = B.gs.players.find(x => x.name === 'ALICIA'); return p && p.profilePic === url; }), 're-seat auto-applies name and picture');

    // new session (reload) still has it
    const A3 = client();
    [e, d] = await A3.call('auth_login', { name: 'Alicia', pin: '1234' }, 'auth_ok', 'auth_error');
    ok(d.account.pic === url && d.account.display === 'ALICIA', 'login payload carries pic and display');

    // changing while seated updates everyone
    const good2 = dataUrl('image/png', png(16, 50));
    ev = await upd(A, { avatarPic: good2 });
    const url2 = ev.find(([x]) => x === 'profile')[1].pic;
    ok(url2 !== url && await waitFor(() => B.gs.players.find(p => p.name === 'ALICIA').profilePic === url2), 'new picture reaches the seat while seated (new version URL)');

    // preset instead
    ev = await upd(A, { avatarPic: null });
    ok(ev.find(([x]) => x === 'profile')[1].pic === null && await waitFor(() => B.gs.players.find(p => p.name === 'ALICIA').profilePic === null), 'removing the picture clears the seat circle');
    await flushWait();
    ok(!accFile().alice.avatarPic, 'avatarPic removed from account');
    ok((await fetch(`http://localhost:${PORT}${url2}`)).status === 404, 'removed picture is gone');
    ev = await upd(A, { avatar: 'a07' });
    ok(B.gs.players.find(p => p.name === 'ALICIA') && ev.some(([x, y]) => x === 'profile' && y.avatar === 'a07'), 'preset change still works');

    ok(!/handler .* failed/.test(out), 'no handler exceptions logged');
  } catch (err) { console.log('FAIL exception', err); fails++; }
  try { proc.kill(); } catch {}
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
