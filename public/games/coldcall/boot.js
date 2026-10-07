CC.core.boot().then(() => {
  // (chris 10-06 FB5) first-use GPU warm-up, loaded after the game is ready so it never sits on the load path (see warm.js)
  const s = document.createElement('script'); s.src = 'warm.js'; s.onload = () => { try { CC.warm.run(); } catch (e) { /* warm-up is optional */ } }; document.head.appendChild(s);
}).catch((e) => { console.error('coldcall boot failed', e); const g = document.getElementById('go'); if (g) g.textContent = 'Failed to load'; });
