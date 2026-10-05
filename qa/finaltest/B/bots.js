'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/run1.js', 'utf8');
const head = src.slice(0, src.indexOf('(async () => {'));
eval(head.replace("'use strict';", '') + `
(async () => {
  const names = ['Bob', 'Dee', 'Fay'];
  const cs = names.map(n => new C(n));
  await Promise.all(cs.map(c => c.conn()));
  for (const c of cs) { c.s.emit('join_game', { name: c.name, avatar: 'x', password: 'ping' }); await sleep(150); }
  cs.forEach(c => c.policy = 'rand');
  console.log('bots joined; waiting for START signal file');
  while (!fs.existsSync(DIR + '/START')) await sleep(300);
  cs[0].s.emit('start_game', { roomId: ROOM });
  let lastH = -1;
  for (;;) { await sleep(200); const g = cs[0].gs; if (!g) continue;
    if (g.status !== 'playing' && g.handNum !== lastH) { lastH = g.handNum; console.log('hand', g.handNum, g.status, JSON.stringify(g.players.map(p => [p.name, p.chips]))); }
    for (const c of cs) { const me = c.me(); if (me && me.chips === 0 && g.status !== 'playing') c.s.emit('rebuy', { roomId: ROOM }); }
    if (fs.existsSync(DIR + '/STOP')) break; }
  process.exit(0);
})();`);
