'use strict';
// Bot daemon for the sweep: node socket bots driven by JSON lines on stdin (one command per line), answers one JSON line per command on stdout.
//   {"id":1,"op":"bot","name":"swa","mode":"signup|login|claim"}               -> account key
//   {"id":2,"op":"emit","name":"swa","ev":"table_join","payload":{...}}         -> fire and forget
//   {"id":3,"op":"req","name":"swa","ev":"table_create","payload":{...},"okEv":"table_created"} -> reply payload or {__err}
//   {"id":4,"op":"state","name":"swa"}  -> {gs, cards, errors, errorObjs, busts, showdowns, money, left}
//   {"id":5,"op":"rig","holes":[["As","Ks"],["Qd","Qc"]],"board":["2c","3d","4h","9s","Jd"],"name":"swa"} -> queue ONE rigged deck
//   {"id":6,"op":"policy","name":"swa","policy":"call|fold|checkfold|allin|none"}  background auto-play for that bot
//   {"id":7,"op":"act","name":"swa","action":"raise","amount":300}
//   {"id":8,"op":"audit"}   {"id":9,"op":"close","name":"swa"}   {"id":10,"op":"quit"}
const readline = require('readline');
const { Bot, rigDeck, sleep } = require('../../v2/lib.js');
const PORT = Number((process.env.E2E_BASE || 'http://127.0.0.1:4700').split(':').pop());
const srv = { port: PORT, clients: [] };
const bots = {}; const policies = {};
const out = (id, ok, result) => process.stdout.write(JSON.stringify({ id, ok, result }) + '\n');

function decide(b) {
  const pol = policies[b.name]; const gs = b.gs;
  if (!pol || pol === 'none' || !gs || !b.myTurn()) return;
  const i = b.idx(), me = gs.players[i], la = gs.legalActions || {};
  const toCall = Math.max(0, gs.currentBet - (me.roundBet || 0));
  let a;
  if (pol === 'call') a = [toCall ? 'call' : 'check'];
  else if (pol === 'fold') a = ['fold'];
  else if (pol === 'checkfold') a = [toCall ? 'fold' : 'check'];
  else if (pol === 'allin') a = la.canRaise ? ['raise', la.maxRaiseTo] : [toCall ? 'call' : 'check'];
  const sig = [gs.handNum, gs.street, gs.currentBet, me.roundBet, me.chips].join('|');
  if (b._sig === sig && Date.now() - b._sigT < 800) return;
  b._sig = sig; b._sigT = Date.now();
  setTimeout(() => b.act(a[0], a[1]), 250);
}

async function handle(m) {
  const b = m.name && bots[m.name];
  switch (m.op) {
    case 'bot': {
      const nb = await new Bot(srv, m.name).connect(); bots[m.name] = nb;
      nb.left = []; nb.sock.on('table_left', d => nb.left.push(d)); nb.sock.on('table_joined', d => { nb.tableId = d.tableId; }); nb.sock.on('state_poll', () => {});
      nb.sock.on('game_state', () => decide(nb));
      const pin = m.pin || '4321';
      const r = m.mode === 'login' ? await nb.login(pin) : m.mode === 'claim' ? await nb.claim(pin) : await nb.signup(pin);
      return r.__err ? { err: r.__err } : { key: nb.key, account: r.account && { key: r.account.key } };
    }
    case 'emit': b.emit(m.ev, m.payload); return 'sent';
    case 'req': return await b.req(m.ev, m.payload, m.okEv, m.ms || 6000);
    case 'state': return { gs: b.gs, cards: b.cards, errors: b.errors.slice(-10), errorObjs: b.errorObjs.slice(-10), busts: b.busts.slice(-3), showdowns: b.showdowns.slice(-3), money: b.money, left: b.left.slice(-3), idx: b.idx(), myTurn: b.myTurn() };
    case 'rig': return await b.req('__rig', { decks: [rigDeck(m.holes, m.board)] }, '__rig_ok');
    case 'policy': policies[m.name] = m.policy; decide(b); return 'ok';
    case 'act': b.act(m.action, m.amount); return 'sent';
    case 'audit': return await Object.values(bots)[0].req('__audit', {}, '__audit');
    case 'close': b.close(); delete bots[m.name]; return 'closed';
    case 'quit': for (const x of Object.values(bots)) x.close(); setTimeout(() => process.exit(0), 100); return 'bye';
    default: return { err: 'unknown op' };
  }
}
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  try { out(m.id, true, await handle(m)); } catch (e) { out(m.id, false, String(e && e.stack || e)); }
});
process.on('uncaughtException', e => process.stderr.write('botd error ' + e + '\n'));
