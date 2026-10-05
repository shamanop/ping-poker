CC.core.boot().catch((e) => { console.error('coldcall boot failed', e); const g = document.getElementById('go'); if (g) g.textContent = 'Failed to load'; });
