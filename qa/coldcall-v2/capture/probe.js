// independent wallet probe: a second page (same browser) with its own socket for the same account; reads the server wallet fresh
const BASE = 'http://127.0.0.1:4610';
async function openProbe(browser, name, pin) {
  const ctx = await browser.newContext(); const pg = await ctx.newPage();
  await pg.goto(BASE + '/socket.io/socket.io.js'); await pg.addScriptTag({ url: BASE + '/socket.io/socket.io.js' });
  await pg.evaluate(({ name, pin }) => new Promise((res, rej) => {
    const s = (window.__s = io()); let tried = false;
    s.on('connect', () => s.emit('auth_login', { name, pin }));
    s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin, avatar: 'a01' }); } else rej('auth'); });
    s.on('auth_ok', () => res(1)); setTimeout(() => rej('auth timeout'), 10000);
  }), { name, pin });
  const read = () => pg.evaluate(() => new Promise((res) => { __s.once('g:coldcall:state', (s) => res(s)); __s.emit('g:coldcall:state', {}); }));
  return { pg, read, close: () => ctx.close() };
}
module.exports = { openProbe };
if (require.main === module) (async () => {
  const { launch } = require('./qalib'); const b = await launch(); try { const p = await openProbe(b.browser, 'probe1', '1234'); const s = await p.read(); console.log(JSON.stringify(s).slice(0, 700)); } finally { await b.browser.close(); }
})();
