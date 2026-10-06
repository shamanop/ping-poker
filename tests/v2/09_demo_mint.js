'use strict';
// C5: create_demo seated the caller against bots holding chips from nowhere and cashed the winnings into a real bank. Audit repro 09.
// v2 has no demo at all: unauthenticated or as the admin (the only account 9440541 lets create one), create_demo makes no room, no seat, no money.
const { startServer, Bot, sleep, audit, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0);
  const admin = await new Bot(srv, 'chris').connect(); await admin.claimAdmin();
  for (const who of ['unauthenticated', 'admin']) {
    await T.check(`create-demo-${who}-makes-no-room-and-no-money`, ['C5'], async () => {
      const aud = await new Bot(srv, 'Auditor' + who[0]).connect();
      const a0 = await audit(aud);
      let joined = 0;
      for (let i = 0; i < 3; i++) {
        const b = who === 'admin' ? admin : await new Bot(srv, 'demoer' + i).connect();
        const n0 = b.events.filter(e => e.ev === 'room_joined').length;
        b.emit('create_demo', { name: b.name, avatar: 'x' });
        await sleep(300);
        if (b.events.filter(e => e.ev === 'room_joined').length > n0) joined++;
        if (who !== 'admin') b.close();
      }
      const a1 = await audit(aud); aud.close();
      expect(joined === 0, `${joined} of 3 create_demo calls seated the caller at a demo table`);
      expect(a1.rooms.length === a0.rooms.length, `rooms ${a0.rooms.length} -> ${a1.rooms.length}`);
      expect(moneyTotal(a1).total === moneyTotal(a0).total, `money changed by ${moneyTotal(a1).total - moneyTotal(a0).total}`);
    });
  }
  await srv.stop();
  await T.done();
})();
