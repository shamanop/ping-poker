CC.core.boot().then(() => {
  // (chris 10-06 FB6) motion / juice layer (juice.css + juice.js, see juice.js); ?nojuice loads neither, so one build gives the before and the after
  if (!/[?&]nojuice\b/.test(location.search)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'juice.css'; document.head.appendChild(l); const j = document.createElement('script'); j.src = 'juice.js'; document.head.appendChild(j); }
  // (chris 10-06 FB5) first-use GPU warm-up, loaded after the game is ready so it never sits on the load path (see warm.js)
  const s = document.createElement('script'); s.src = 'warm.js'; s.onload = () => { try { CC.warm.run(); } catch (e) { /* warm-up is optional */ } }; document.head.appendChild(s);
}).catch((e) => { console.error('coldcall boot failed', e); const g = document.getElementById('go'); if (g) g.textContent = 'Failed to load'; });
