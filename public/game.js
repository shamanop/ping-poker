'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  socket:         null,
  roomId:         null,
  myIdx:          null,
  myCards:        [],
  gameState:      null,
  selectedAvatar: '🤠',
};

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.socket = io();
  bindLanding();
  bindLobby();
  bindActions();
  bindSocket();

  // Auto-fill room code from URL
  const urlJoin = new URL(window.location.href).searchParams.get('join');
  if (urlJoin) document.getElementById('room-code-input').value = urlJoin;
});

// ─── Screen ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Landing ──────────────────────────────────────────────────────
function bindLanding() {
  document.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedAvatar = el.dataset.avatar;
    });
  });

  document.getElementById('btn-create').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    state.socket.emit('create_room', { name, avatar: state.selectedAvatar });
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) { showError('Enter a room code'); return; }
    state.socket.emit('join_room', { roomId: code, name, avatar: state.selectedAvatar });
  });

  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
}

function getPlayerName() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) { showError('Enter your name first'); return null; }
  return name;
}

function showError(msg) {
  const el = document.getElementById('landing-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Lobby ────────────────────────────────────────────────────────
function bindLobby() {
  document.getElementById('btn-start').addEventListener('click', () => {
    state.socket.emit('start_game', { roomId: state.roomId });
  });

  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const url = `${window.location.origin}?join=${state.roomId}`;
    navigator.clipboard.writeText(url).catch(() => {});
    const btn = document.getElementById('btn-copy-code');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy invite link'; }, 2000);
  });
}

function renderLobbyPlayers(players, hostName) {
  const list = document.getElementById('lobby-players-list');
  list.innerHTML = players.map(p => `
    <div class="player-lobby-item">
      <span class="p-avatar">${esc(p.avatar)}</span>
      <span class="p-name">${esc(p.name)}</span>
      ${p.name === hostName ? '<span class="host-badge">HOST</span>' : ''}
    </div>
  `).join('');

  const isHost = state.myIdx === 0;
  const btnStart = document.getElementById('btn-start');
  const waitMsg  = document.getElementById('waiting-msg');

  if (isHost) {
    btnStart.classList.remove('hidden');
    waitMsg.classList.add('hidden');
    const canStart = players.length >= 2;
    btnStart.disabled   = !canStart;
    btnStart.textContent = canStart ? 'Start Game' : 'Waiting for players…';
  } else {
    btnStart.classList.add('hidden');
    waitMsg.classList.remove('hidden');
  }
}

// ─── Socket ────────────────────────────────────────────────────────
function bindSocket() {
  const s = state.socket;

  s.on('room_joined', ({ roomId, playerIdx }) => {
    state.roomId = roomId;
    state.myIdx  = playerIdx;
    document.getElementById('lobby-room-code').textContent = roomId;
    window.history.replaceState({}, '', `?join=${roomId}`);
    showScreen('lobby-screen');
  });

  s.on('room_update', ({ players, hostName }) => {
    renderLobbyPlayers(players, hostName);
  });

  s.on('game_state', gs => {
    state.gameState = gs;
    if (gs.status === 'playing' || gs.status === 'waiting_next') {
      showScreen('game-screen');
      renderGame();
    }
  });

  s.on('your_cards', ({ cards, myIdx }) => {
    state.myIdx  = myIdx;
    state.myCards = cards;
    if (state.gameState) renderMyCards();
  });

  s.on('showdown_result', ({ winners, pot }) => {
    renderShowdown(winners, pot);
  });

  s.on('error', ({ message }) => {
    showError(message);
  });
}

// ─── Game Render ──────────────────────────────────────────────────
function renderGame() {
  const gs = state.gameState;
  if (!gs) return;
  renderSeats(gs);
  renderCommunity(gs);
  document.getElementById('street-label').textContent = gs.street?.toUpperCase() || '';
  document.getElementById('pot-display').textContent = gs.pot > 0 ? `POT  ${gs.pot.toLocaleString()}` : '';
  renderMyCards();
  renderControls(gs);
  renderLog(gs.log);
}

// ─── Seat Positions ────────────────────────────────────────────────
// [x%, y%] — my seat is always index 0 (bottom center)
const SEATS = {
  2: [[50,94],[50,4]],
  3: [[50,94],[14,20],[86,20]],
  4: [[50,94],[6,42],[50,4],[94,42]],
  5: [[50,94],[6,58],[16,8],[84,8],[94,58]],
  6: [[50,94],[6,62],[6,16],[50,4],[94,16],[94,62]],
  7: [[50,94],[8,72],[3,28],[28,3],[72,3],[97,28],[92,72]],
  8: [[50,94],[10,76],[3,44],[12,10],[50,3],[88,10],[97,44],[90,76]],
};

function renderSeats(gs) {
  const el = document.getElementById('player-seats');
  el.innerHTML = '';
  const n = gs.players.length;
  const pos = SEATS[Math.min(n, 8)] || SEATS[8];
  const myIdx = state.myIdx ?? 0;

  gs.players.forEach((p, i) => {
    const offset = (i - myIdx + n) % n;
    const [px, py] = pos[offset] || [50, 50];
    if (i === myIdx) return; // own cards shown in bottom panel

    const seat = document.createElement('div');
    seat.className = [
      'player-seat',
      p.isActive   ? 'is-active'  : '',
      p.folded     ? 'is-folded'  : '',
    ].join(' ').trim();
    seat.style.left = `${px}%`;
    seat.style.top  = `${py}%`;

    const betHtml = p.roundBet > 0
      ? `<span class="seat-bet">${p.roundBet.toLocaleString()}</span>` : '';

    seat.innerHTML = `
      <div class="seat-box">
        <div class="seat-avatar">${esc(p.avatar)}</div>
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">${p.chips.toLocaleString()}</div>
        <div class="seat-bet-row">${betHtml}</div>
        <div class="seat-tags">
          ${p.isDealer ? '<div class="dealer-btn">D</div>' : ''}
          ${p.allIn    ? '<div class="allin-tag">ALL IN</div>' : ''}
        </div>
      </div>
      <div class="seat-hole-cards">
        ${p.cardCount > 0 && !p.folded ? cardBacksHtml(p.cardCount, 'sm') : ''}
      </div>
    `;
    el.appendChild(seat);
  });

  // My own seat marker (dealer button only — cards shown in bottom panel)
  const myPlayer = gs.players[myIdx];
  if (myPlayer && myPlayer.isDealer) {
    const [mpx, mpy] = pos[0];
    const dSeat = document.createElement('div');
    dSeat.className = 'player-seat';
    dSeat.style.left = `${mpx}%`;
    dSeat.style.top  = `${mpy}%`;
    dSeat.innerHTML = `<div class="seat-box">
      <div class="seat-avatar">${esc(myPlayer.avatar)}</div>
      <div class="seat-name">${esc(myPlayer.name)}</div>
      <div class="seat-chips">${myPlayer.chips.toLocaleString()}</div>
      <div class="seat-bet-row">${myPlayer.roundBet > 0 ? `<span class="seat-bet">${myPlayer.roundBet.toLocaleString()}</span>` : ''}</div>
      <div class="seat-tags"><div class="dealer-btn">D</div></div>
    </div>`;
    el.appendChild(dSeat);
  } else if (myPlayer) {
    const [mpx, mpy] = pos[0];
    const mSeat = document.createElement('div');
    mSeat.className = `player-seat${myPlayer.isActive ? ' is-active' : ''}`;
    mSeat.style.left = `${mpx}%`;
    mSeat.style.top  = `${mpy}%`;
    mSeat.innerHTML = `<div class="seat-box">
      <div class="seat-avatar">${esc(myPlayer.avatar)}</div>
      <div class="seat-name">${esc(myPlayer.name)}</div>
      <div class="seat-chips">${myPlayer.chips.toLocaleString()}</div>
      <div class="seat-bet-row">${myPlayer.roundBet > 0 ? `<span class="seat-bet">${myPlayer.roundBet.toLocaleString()}</span>` : ''}</div>
      <div class="seat-tags">
        ${myPlayer.isDealer ? '<div class="dealer-btn">D</div>' : ''}
        ${myPlayer.allIn    ? '<div class="allin-tag">ALL IN</div>' : ''}
      </div>
    </div>`;
    el.appendChild(mSeat);
  }
}

function cardBacksHtml(count, size) {
  return Array(count).fill(0).map((_, i) =>
    `<div class="card back card-${size}" style="animation-delay:${i * 0.06}s">
      <div class="card-back-inner">
        <img class="back-logo" src="/images/vp-logo.png"
          style="width:${size === 'sm' ? '14px' : size === 'md' ? '28px' : '38px'}; height:auto;">
      </div>
    </div>`
  ).join('');
}

// ─── Community Cards ───────────────────────────────────────────────
function renderCommunity(gs) {
  const el = document.getElementById('community-cards');
  el.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    if (gs.community && gs.community[i]) {
      el.appendChild(buildFaceCard(gs.community[i], 'md', i));
    } else {
      const ph = document.createElement('div');
      ph.className = 'card card-md placeholder';
      el.appendChild(ph);
    }
  }
}

// ─── My Cards ─────────────────────────────────────────────────────
function renderMyCards() {
  const el = document.getElementById('hole-cards');
  el.innerHTML = '';

  if (state.myCards.length === 0) {
    for (let i = 0; i < 2; i++) {
      const ph = document.createElement('div');
      ph.className = 'card card-lg placeholder';
      el.appendChild(ph);
    }
    document.getElementById('my-hand-label').textContent = '';
    return;
  }

  state.myCards.forEach((card, i) => {
    el.appendChild(buildFaceCard(card, 'lg', i));
  });

  // Best hand display
  const gs = state.gameState;
  if (gs?.community?.length >= 3) {
    const label = evalHandLabel(state.myCards, gs.community);
    document.getElementById('my-hand-label').textContent = label;
  } else {
    document.getElementById('my-hand-label').textContent = '';
  }
}

// ─── Controls ──────────────────────────────────────────────────────
function renderControls(gs) {
  const controls = document.getElementById('action-controls');
  const waiting  = document.getElementById('waiting-action');
  const myPlayer = gs.players[state.myIdx];
  const isMyTurn = gs.currentPlayerIdx === state.myIdx;

  if (!isMyTurn || !myPlayer || myPlayer.folded || myPlayer.allIn || gs.status === 'waiting_next') {
    controls.classList.add('hidden');
    const showWait = gs.status === 'playing' && !myPlayer?.folded && !myPlayer?.allIn;
    waiting.classList.toggle('hidden', !showWait);
    return;
  }

  controls.classList.remove('hidden');
  waiting.classList.add('hidden');

  const toCall   = gs.currentBet - (myPlayer.roundBet || 0);
  const canCheck = toCall === 0;
  const callBtn  = document.getElementById('btn-check-call');
  callBtn.textContent = canCheck ? 'Check' : `Call  ${toCall.toLocaleString()}`;

  const raiseRow = document.getElementById('raise-row');
  const slider   = document.getElementById('raise-slider');
  const display  = document.getElementById('raise-display');
  const raiseBtn = document.getElementById('btn-raise');

  const minRaise = gs.currentBet + 20;
  const maxRaise = myPlayer.chips + (myPlayer.roundBet || 0);
  const canRaise = myPlayer.chips > toCall;

  if (!canRaise) {
    raiseBtn.classList.add('hidden');
    raiseRow.classList.add('hidden');
  } else {
    raiseBtn.classList.remove('hidden');
    raiseRow.classList.remove('hidden');
    raiseBtn.textContent = gs.currentBet === 0 ? 'Bet' : 'Raise';
    slider.min   = minRaise;
    slider.max   = maxRaise;
    slider.value = minRaise;
    display.textContent = Number(minRaise).toLocaleString();
    slider.oninput = () => {
      display.textContent = Number(slider.value).toLocaleString();
    };
  }
}

// ─── Action Sends ──────────────────────────────────────────────────
function bindActions() {
  document.getElementById('btn-fold').addEventListener('click', () => {
    sendAction('fold');
  });
  document.getElementById('btn-check-call').addEventListener('click', () => {
    const gs = state.gameState;
    if (!gs) return;
    const me   = gs.players[state.myIdx];
    const toCall = gs.currentBet - (me?.roundBet || 0);
    sendAction(toCall === 0 ? 'check' : 'call');
  });
  document.getElementById('btn-raise').addEventListener('click', () => {
    const amount = parseInt(document.getElementById('raise-slider').value);
    sendAction('raise', amount);
  });
}

function sendAction(action, amount = 0) {
  state.socket.emit('player_action', { roomId: state.roomId, action, amount });
  document.getElementById('action-controls').classList.add('hidden');
}

// ─── Log ──────────────────────────────────────────────────────────
function renderLog(entries) {
  const el = document.getElementById('log-entries');
  el.innerHTML = entries.map(line => {
    const isSep = line.startsWith('---');
    return `<div class="log-entry ${isSep ? 'log-sep' : ''}">${esc(line)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ─── Showdown ─────────────────────────────────────────────────────
function renderShowdown(winners, pot) {
  const overlay   = document.getElementById('showdown-overlay');
  const content   = document.getElementById('showdown-content');
  const countdown = document.getElementById('countdown');

  content.innerHTML = winners.map(w => `
    <div class="showdown-winner">
      <div class="showdown-winner-name">${esc(w.name)}</div>
      <div class="showdown-hand-name">${esc(w.handName)}</div>
      ${w.cards ? `<div class="showdown-winner-cards">${w.cards.map(c => buildFaceCard(c, 'md').outerHTML).join('')}</div>` : ''}
    </div>
    <div class="showdown-pot">Pot: ${pot.toLocaleString()} chips</div>
  `).join('');

  overlay.classList.remove('hidden');

  let secs = 5;
  countdown.textContent = secs;
  const timer = setInterval(() => {
    secs--;
    countdown.textContent = secs;
    if (secs <= 0) { clearInterval(timer); overlay.classList.add('hidden'); }
  }, 1000);
}

// ─── Card Builder ─────────────────────────────────────────────────
function buildFaceCard(card, size = 'md', delay = 0) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const el    = document.createElement('div');
  el.className = `card face card-${size} ${isRed ? 'red' : 'black'}`;
  el.style.animationDelay = `${delay * 0.07}s`;

  el.innerHTML = `
    <div class="rank-tl">
      <div>${esc(card.rank)}</div>
      <div class="card-suit">${esc(card.suit)}</div>
    </div>
    <div class="suit-ctr">${esc(card.suit)}</div>
    <div class="rank-br">
      <div>${esc(card.rank)}</div>
      <div class="card-suit">${esc(card.suit)}</div>
    </div>
  `;
  return el;
}

// ─── Hand Label (client-side display only) ────────────────────────
function evalHandLabel(hole, community) {
  const all  = [...hole, ...community];
  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const vals  = all.map(c => RANKS.indexOf(c.rank) + 2).sort((a,b) => b-a);
  const suits = all.map(c => c.suit);

  const freq = {};
  for (const v of vals) freq[v] = (freq[v]||0)+1;
  const counts = Object.values(freq).sort((a,b) => b-a);

  const flushSuit = ['♠','♥','♦','♣'].find(s => suits.filter(x=>x===s).length >= 5);
  const uv = [...new Set(vals)];
  let straight = false;
  for (let i = 0; i <= uv.length - 5; i++) if (uv[i]-uv[i+4]===4) { straight=true; break; }
  if (!straight && vals.includes(14)) {
    const low = [...new Set(vals.map(v => v===14?1:v))].sort((a,b)=>b-a);
    for (let i = 0; i <= low.length-5; i++) if (low[i]-low[i+4]===4) { straight=true; break; }
  }

  if (flushSuit && straight)                      return 'Straight Flush';
  if (counts[0] === 4)                            return 'Four of a Kind';
  if (counts[0] === 3 && (counts[1]||0) >= 2)    return 'Full House';
  if (flushSuit)                                  return 'Flush';
  if (straight)                                   return 'Straight';
  if (counts[0] === 3)                            return 'Three of a Kind';
  if (counts[0] === 2 && (counts[1]||0) === 2)   return 'Two Pair';
  if (counts[0] === 2)                            return 'Pair';
  return 'High Card';
}

// ─── Utils ────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
