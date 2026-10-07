'use strict';
// Thin boot (contract sections 1 and 9). No side effect on require: start() runs only when this file is the entry point.
// Order: paths -> money ledger (writer fence) -> accounts -> migrate -> service -> recover seats -> tables -> mirror -> listen LAST.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { bestHand, compareHands, evaluate5 } = require('./engine/evaluate');

const ROOM_PASSWORD = 'ping';

function start(env = process.env) {
  const log = (...a) => console.log(...a);
  const boot = require('./transport/boot');
  const paths = boot.resolvePaths(__dirname, env);
  boot.prepareDataDir(paths, env, log);

  const money = require('./money/ledger'), { createService } = require('./money/service'), migrate = require('./tools/migrate-v2');
  const ledger = money.open(paths.MONEY_FILE, { fsync: 'all', log: m => console.error('[v2] money:', m) });
  const { createAccounts } = require('./accounts'), { createLedger } = require('./ledger');
  const accounts = createAccounts({ file: paths.ACCOUNTS_FILE, roomPassword: ROOM_PASSWORD });
  const presLedger = createLedger({ file: paths.LEDGER_FILE, keyOf: k => accounts.keyForName(k), displayOf: k => (accounts.get(k) ? accounts.get(k).display : null), onWrite: () => { if (ctx.pushBank) ctx.pushBank(); } });
  accounts.migrateLegacy({ bank: boot.readJson(paths.BANK_FILE, {}), ledgerEntries: presLedger.entries() });
  boot.migrateIfNeeded({ ledger, paths, migrate, log });
  const service = createService(ledger);
  for (const a of Object.values(accounts.all())) service.ensureAccount(a.key);
  const bootId = Date.now().toString(36);
  const report = service.bootRecover(bootId);
  log(`boot recovery: ${report.seats.length} seats, ${report.pots.length} pots returned${report.errors.length ? ', ERRORS ' + report.errors.length : ''}`);
  if (report.errors.length) console.error('[v2] boot recovery errors:', JSON.stringify(report.errors).slice(0, 500));
  const mirror = boot.startMirror({ service, ledger, paths });
  const bankMap = service.mirror().bank;
  presLedger.seedBank(bankMap);
  boot.legacyImport({ presLedger, bank: bankMap, accounts, paths, env, keyOf: k => accounts.keyForName(String(k).toLowerCase().trim()) });

  const app = express(), server = http.createServer(app), io = new Server(server, { cors: { origin: '*' } });
  const ctx = { io, accounts, service, ledger, presLedger, paths, bootId, env, ROOM_PASSWORD };

  const { createSocial } = require('./social');
  ctx.social = createSocial({ io, accounts, now: () => Date.now(), file: paths.BIGWINS_FILE });
  const { createWalletAdapter } = require('./transport/wallet-adapter');
  ctx.wallet = createWalletAdapter({ service, ledger, onChange: k => { ctx.pushWallet(k); ctx.pushMoney(k); ctx.pushBank(); } });
  ctx.social.setWallet(ctx.wallet);
  ctx.social.setLedger(ledger);   // the daily bonus and achievement gates are the mint refs in the ledger (P6 A2/A3)
  const { createGameMoney } = require('./transport/game-money');
  ctx.gameMoney = createGameMoney({ service, ledger, onChange: k => { ctx.pushWallet(k); ctx.pushMoney(k); ctx.pushBank(); }, log: (...a) => console.error(...a) });

  const { createMoneyPort } = require('./tables/money-port'), { createRegistry } = require('./tables/registry'), { createViewlog } = require('./tables/viewlog');
  const { createViews } = require('./transport/views'), { createSafe } = require('./transport/safe'), { createTransport } = require('./transport');
  const { createAuth } = require('./auth'), { createAdmin } = require('./admin'), { createRig } = require('./transport/rig');
  const profileOf = key => { const a = accounts.get(key); return a ? { display: a.display, avatar: a.avatar, pic: accounts.picUrl(a) } : null; };
  const registryRef = { current: null };
  const safe = ctx.safe = createSafe({ registry: { seatOf: k => registryRef.current.seatOf(k), tables: { get: id => registryRef.current.tables.get(id) }, pauseAll: () => registryRef.current.pauseAll(), voidAll: r => registryRef.current.voidAll(r) } });
  const viewlog = createViewlog({ presLedger, accounts, social: ctx.social, bankOf: k => ledger.balance('bank:' + k, 'chips'), profileOf, nightNets: t => registryRef.current.nightOf(t) });
  ctx.money = createMoneyPort({ service, ledger, bootId, afterWrite: k => ctx.afterWrite(k), onFence: e => { console.error('[v2] MONEY FENCED', e && e.code); registryRef.current.pauseAll(); }, onWrite: w => viewlog.onWrite(w) });
  ctx.rig = env.RIG === '1' ? createRig(ctx) : null;
  const clock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h) };
  const rngSource = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
  const transportRef = {};
  ctx.registry = registryRef.current = createRegistry({
    money: ctx.money, service, ledger, clock, file: paths.TABLES_FILE, rng: rngSource, deckSource: ctx.rig ? ctx.rig.deckSource : null, viewlog, onError: safe.onError,
    out: { state: t => ctx.out.state(t), event: (t, k, d, to) => ctx.out.event(t, k, d, to) }, onLobby: () => ctx.pushLobby(),
    hooks: { profileOf, isAdmin: k => accounts.isAdmin(k) },
  });
  ctx.views = createViews({ registry: ctx.registry, accounts, presLedger, ledger, service, wallet: ctx.wallet });
  ctx.auth = createAuth({ accounts, registry: ctx.registry });
  ctx.adm = createAdmin({ service, ledger, accounts, registry: ctx.registry, views: ctx.views, onlineKeys: () => new Set(ctx.allSockets().filter(s => s.data && s.data.acct).map(s => s.data.acct)) });
  Object.assign(transportRef, createTransport(ctx));
  ctx.games = require('./games')({ io, accounts, social: ctx.social, now: () => Date.now(), wallet: ctx.wallet, money: ctx.gameMoney, service, rooms: ctx.registry.tables, tables: ctx.registry, ledger: presLedger, files: { coldcallPull: paths.COLDCALL_PULL_FILE, coldcallConfig: paths.COLDCALL_CFG_FILE } });
  const gr = ctx.games.recover();
  log(`game recovery: ${Object.entries(gr.games).map(([id, g]) => `${id} ${g.found} open/${g.settledOrVoidedByGame} by game/${g.kept} kept`).join(', ') || 'no games'}, ${gr.voided.length} escrows voided${gr.errors.length ? ', ERRORS ' + gr.errors.length : ''}`);
  if (gr.errors.length) console.error('[v2] game recovery errors:', JSON.stringify(gr.errors).slice(0, 500));
  ctx.registry.load();
  ctx.registry.startSweep();
  safe.installProcessHandlers();
  transportRef.start();

  // ---- HTTP ---------------------------------------------------------------------------------------------------
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/apic/:key/:ver', (req, res) => {
    const a = accounts.get(String(req.params.key).toLowerCase());
    const m = a && a.avatarPic && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(a.avatarPic);
    if (!m) { res.status(404).end(); return; }
    const current = accounts.picUrl(a).split('/').pop() === req.params.ver;
    res.set({ 'Content-Type': m[1], 'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(Buffer.from(m[2], 'base64'));
  });
  // Live slot math (no deploy): token-only (BENDER_ADMIN_TOKEN env), disabled when unset. Moved verbatim from the old server.js.
  const benderAdminOk = req => {
    const want = Buffer.from(env.BENDER_ADMIN_TOKEN || ''), got = Buffer.from(String(req.get('x-admin-token') || ''));   // BYTE lengths: a header with one non-ASCII character used to pass a character-length check and make timingSafeEqual throw
    if (!want.length || got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  };
  const benderMod = () => { try { return require('./games/bender.js'); } catch { return null; } };
  app.get('/api/admin/bender-config', (req, res) => {
    if (!benderAdminOk(req)) return res.status(403).json({ error: 'forbidden' });
    const m = benderMod(); if (!m) return res.status(404).json({ error: 'no slot' });
    res.json(m.liveInfo());
  });
  app.post('/api/admin/bender-config', express.json({ limit: '64kb' }), (req, res) => {
    if (!benderAdminOk(req)) return res.status(403).json({ error: 'forbidden' });
    const m = benderMod(); if (!m) return res.status(404).json({ error: 'no slot' });
    const b = req.body || {};
    try {
      const info = m.setLiveConfig(b.reset ? { overrides: {}, note: b.note || 'reset to defaults' } : { overrides: b.overrides || {}, rtpLabel: b.rtpLabel, note: b.note });
      io.emit('g:bender:cfg', { cfg: m.clientCfg(), rtp: info.rtpLabel });
      console.log('[bender] live config updated:', info.note || '(no note)');
      res.json({ ok: true, ...info });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  // Same switch for COLD CALL (same token, same header). GET current; POST {overrides, rtpLabel?, note?} swaps (400 + the reason on a bad config, nothing changes); POST {reset:true} restores the shipped math.
  const coldcallMod = () => { try { return require('./games/coldcall.js'); } catch { return null; } };
  app.get('/api/admin/coldcall-config', (req, res) => {
    if (!benderAdminOk(req)) return res.status(403).json({ error: 'forbidden' });
    const m = coldcallMod(); if (!m) return res.status(404).json({ error: 'no slot' });
    res.json(m.liveInfo());
  });
  app.post('/api/admin/coldcall-config', express.json({ limit: '64kb' }), (req, res) => {
    if (!benderAdminOk(req)) return res.status(403).json({ error: 'forbidden' });
    const m = coldcallMod(); if (!m) return res.status(404).json({ error: 'no slot' });
    const b = req.body, reset = !!b && b.reset === true;               // only the boolean true resets ("false", 1, "yes" are not a reset and do not drop the overrides sent with them)
    if (!b || typeof b !== 'object' || Array.isArray(b) || (!reset && (!b.overrides || typeof b.overrides !== 'object' || Array.isArray(b.overrides)))) return res.status(400).json({ ok: false, error: 'send {overrides: {...}} or {reset: true}' });
    try {
      const info = m.setLiveConfig(reset ? { overrides: {}, note: b.note || 'reset to defaults' } : { overrides: b.overrides, rtpLabel: b.rtpLabel, note: b.note });
      io.emit('g:coldcall:cfg', m.cfgEvent());
      console.log('[coldcall] live config updated:', info.note || '(no note)');
      res.json({ ok: true, ...info });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
  // Unauthenticated read gated only by the public room word (V2-DESIGN 12a Q8): unchanged in wave 2, flagged for deletion in wave 3.
  app.get('/api/bank-summary', (req, res) => {
    if (req.query.password !== ROOM_PASSWORD) return res.status(403).json({ error: 'Incorrect password' });
    const roomId = typeof req.query.room === 'string' && req.query.room ? req.query.room : 'POKERPING';
    if (!ctx.registry.tables.has(roomId)) return res.status(404).json({ error: 'Unknown room' });
    res.json(ctx.views.bankSummary(roomId));
  });

  // ---- shutdown: no cash-out writes, recovery is the boot rule only ---------------------------------------------
  let closing = false;
  function shutdown() {
    if (closing) return; closing = true;
    try { ctx.registry.stop(); ctx.registry.voidAll('shutdown'); } catch {}
    try { ctx.wallet.flush(); } catch {}
    try { mirror.write(); mirror.stop(); } catch {}
    try { ctx.registry.flush(); } catch {}
    try { accounts.flush(); } catch {}
    try { if (ctx.social.flush) ctx.social.flush(); } catch {}
    try { ledger.close(); } catch {}
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const PORT = env.PORT || 3000;
  server.listen(PORT, () => log(`Ping Poker server running on port ${PORT}`));
  return { ctx, server, io, shutdown };
}

if (require.main === module) start();

module.exports = { start, bestHand, compareHands, evaluate5 };
