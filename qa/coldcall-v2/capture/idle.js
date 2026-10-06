const { launch, ready, shot, sleep } = require('./lib');
(async () => { const b = await launch(); try { await ready(b.page, '?nosplash&shot=idle'); await sleep(2500); await shot(b.page, 'idle'); } finally { await b.browser.close(); } })();
