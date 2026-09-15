'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  socket:      null,
  roomId:      null,
  myIdx:       null,
  myCards:     [],
  gameState:   null,
  selectedAvatar: '🤠',
};

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.socket = io();
  bindLanding();
  bindLobby();
  bindActions();
  bindSocket();
});

// ─── Screen Management ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Landing ──────────────────────────────────────────────────────
function bindLanding() {
  // Avatar selection
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
    if (!code) { showLandingError('Enter a room code'); return; }
    state.socket.emit('join_room', { roomId: code, name, avatar: state.selectedAvatar });
  });

  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });

  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
}

function getPlayerName() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) { showLandingError('Enter your name first'); return null; }
  return name;
}

function showLandingError(msg) {
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
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '⎘ Copy Link'; }, 2000);
  });
}

function renderLobbyPlayers(players, hostName) {
  const list = document.getElementById('lobby-players-list');
  list.innerHTML = players.map((p, i) => `
    <div class="player-lobby-item">
      <span class="avatar">${p.avatar}</span>
      <span class="pname">${escHtml(p.name)}</span>
      ${p.name === hostName ? '<span class="host-tag">HOST</span>' : ''}
    </div>
  `).join('');

  const isHost = state.myIdx === 0;
  const btnStart  = document.getElementById('btn-start');
  const waitMsg   = document.getElementById('waiting-msg');

  if (isHost) {
    btnStart.classList.remove('hidden');
    waitMsg.classList.add('hidden');
    btnStart.textContent = players.length < 2 ? 'Waiting for players…' : 'Start Game';
    btnStart.disabled = players.length < 2;
  } else {
    btnStart.classList.add('hidden');
    waitMsg.classList.remove('hidden');
  }
}

// ─── Socket Events ─────────────────────────────────────────────────
function bindSocket() {
  const s = state.socket;

  s.on('room_joined', ({ roomId, playerIdx }) => {
    state.roomId = roomId;
    state.myIdx  = playerIdx;
    document.getElementById('lobby-room-code').textContent = roomId;

    // Auto-join from URL param
    const url = new URL(window.location.href);
    if (!url.searchParams.get('join')) {
      window.history.replaceState({}, '', `?join=${roomId}`);
    }
    showScreen('lobby-screen');
  });

  s.on('room_update', ({ players, hostName }) => {
    renderLobbyPlayers(players, hostName);
  });

  s.on('game_state', (gs) => {
    state.gameState = gs;
    if (gs.status === 'playing' || gs.status === 'waiting_next') {
      showScreen('game-screen');
      renderGameState();
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
    showLandingError(message);
  });

  // Auto-join from URL
  const url = new URL(window.location.href);
  const autoJoin = url.searchParams.get('join');
  if (autoJoin) {
    document.getElementById('room-code-input').value = autoJoin;
  }
}

// ─── Game Rendering ───────────────────────────────────────────────
function renderGameState() {
  const gs = state.gameState;
  if (!gs) return;

  renderSeats(gs);
  renderCommunity(gs);
  renderPot(gs);
  renderLog(gs.log);
  renderMyCards();
  renderActionControls(gs);
}

// ─── Table Seats ──────────────────────────────────────────────────
const SEAT_POSITIONS = {
  // For N total players, positions[N][seatOffset] = [xPct, yPct]
  // seatOffset 0 = me (always bottom center)
  2: [[50, 95], [50,  3]],
  3: [[50, 95], [14, 22], [86, 22]],
  4: [[50, 95], [5,  40], [50,  3], [95, 40]],
  5: [[50, 95], [5,  55], [18,  8], [82,  8], [95, 55]],
  6: [[50, 95], [5,  60], [5,  18], [50,  3], [95, 18], [95, 60]],
  7: [[50, 95], [8,  70], [3,  28], [30,  3], [70,  3], [97, 28], [92, 70]],
  8: [[50, 95], [10, 75], [3,  42], [10, 12], [50,  3], [90, 12], [97, 42], [90, 75]],
};

function renderSeats(gs) {
  const container = document.getElementById('player-seats');
  container.innerHTML = '';

  const n = gs.players.length;
  const positions = SEAT_POSITIONS[Math.min(n, 8)] || SEAT_POSITIONS[8];

  gs.players.forEach((p, i) => {
    // Offset so my seat is always index 0 (bottom)
    const myIdx = state.myIdx ?? 0;
    const offset = (i - myIdx + n) % n;
    const pos = positions[offset] || [50, 50];

    const seat = document.createElement('div');
    seat.className = [
      'player-seat',
      p.isActive   ? 'is-active'  : '',
      p.folded     ? 'is-folded'  : '',
      p.sittingOut ? 'is-sitting-out' : '',
    ].join(' ').trim();

    seat.style.left = `${pos[0]}%`;
    seat.style.top  = `${pos[1]}%`;

    const toCallAmt = gs.currentBet - p.roundBet;
    const betDisplay = p.roundBet > 0 ? `${p.roundBet}` : '';

    seat.innerHTML = `
      <div class="seat-info">
        <div class="seat-avatar">${escHtml(p.avatar)}</div>
        <div class="seat-name">${escHtml(p.name)}</div>
        <div class="seat-chips">${p.chips.toLocaleString()}</div>
        <div class="seat-bet">${betDisplay ? `Bet: ${betDisplay}` : ''}</div>
        <div class="seat-tags">
          ${p.isDealer ? '<div class="tag-dealer">D</div>' : ''}
          ${p.allIn    ? '<div class="tag-allin">ALL IN</div>' : ''}
        </div>
      </div>
      <div class="seat-hole-cards" id="seat-cards-${i}">
        ${renderSeatCards(p, i)}
      </div>
    `;

    container.appendChild(seat);
  });
}

function renderSeatCards(p, playerIdx) {
  if (p.cardCount === 0 || p.folded) return '';
  if (playerIdx === state.myIdx) return ''; // own cards rendered in bottom panel
  // Show hidden backs for opponents
  return Array(p.cardCount).fill(0).map(() =>
    `<div class="card card-sm hidden-card"></div>`
  ).join('');
}

// ─── Community Cards ──────────────────────────────────────────────
function renderCommunity(gs) {
  const el = document.getElementById('community-cards');
  el.innerHTML = '';

  if (!gs.community || gs.community.length === 0) {
    // Placeholders
    for (let i = 0; i < 5; i++) {
      const ph = document.createElement('div');
      ph.className = 'card card-md card-placeholder';
      el.appendChild(ph);
    }
    return;
  }

  gs.community.forEach(card => {
    el.appendChild(buildCard(card, 'md'));
  });

  // Fill remaining placeholders
  for (let i = gs.community.length; i < 5; i++) {
    const ph = document.createElement('div');
    ph.className = 'card card-md card-placeholder';
    el.appendChild(ph);
  }

  document.getElementById('street-label').textContent = gs.street?.toUpperCase() || '';
}

function renderPot(gs) {
  const el = document.getElementById('pot-display');
  if (gs.pot > 0) {
    el.textContent = `POT: ${gs.pot.toLocaleString()}`;
  } else {
    el.textContent = '';
  }
}

// ─── My Cards ─────────────────────────────────────────────────────
function renderMyCards() {
  const el = document.getElementById('hole-cards');
  el.innerHTML = '';

  if (state.myCards.length === 0) {
    // Placeholders
    for (let i = 0; i < 2; i++) {
      const ph = document.createElement('div');
      ph.className = 'card card-lg card-placeholder';
      el.appendChild(ph);
    }
    return;
  }

  state.myCards.forEach(card => {
    el.appendChild(buildCard(card, 'lg'));
  });

  // Show best hand label if community cards exist
  const gs = state.gameState;
  if (gs && gs.community && gs.community.length >= 3 && state.myCards.length === 2) {
    const hand = evalClientHand(state.myCards, gs.community);
    document.getElementById('my-hand-label').textContent = hand;
  } else {
    document.getElementById('my-hand-label').textContent = '';
  }
}

// ─── Action Controls ──────────────────────────────────────────────
function renderActionControls(gs) {
  const controls = document.getElementById('action-controls');
  const waiting  = document.getElementById('waiting-action');

  const myPlayer = gs.players[state.myIdx];
  const isMyTurn = gs.currentPlayerIdx === state.myIdx;

  if (!isMyTurn || !myPlayer || myPlayer.folded || myPlayer.allIn || gs.status === 'waiting_next') {
    controls.classList.add('hidden');
    if (gs.status === 'playing' && !myPlayer?.folded) {
      waiting.classList.remove('hidden');
    } else {
      waiting.classList.add('hidden');
    }
    return;
  }

  controls.classList.remove('hidden');
  waiting.classList.add('hidden');

  const toCall = gs.currentBet - (myPlayer.roundBet || 0);
  const canCheck = toCall === 0;
  const callBtn = document.getElementById('btn-check-call');

  callBtn.textContent = canCheck ? 'Check' : `Call ${toCall.toLocaleString()}`;

  // Raise slider
  const raiseRow     = document.getElementById('raise-row');
  const raiseSlider  = document.getElementById('raise-slider');
  const raiseDisplay = document.getElementById('raise-display');
  const raiseBtn     = document.getElementById('btn-raise');

  const minRaise = gs.currentBet + 20; // BIG_BLIND increment
  const maxRaise = myPlayer.chips + (myPlayer.roundBet || 0);

  if (myPlayer.chips <= toCall) {
    // Can only call/fold (all-in territory)
    raiseBtn.classList.add('hidden');
    raiseRow.classList.add('hidden');
  } else {
    raiseBtn.classList.remove('hidden');
    raiseRow.classList.remove('hidden');
    raiseBtn.textContent = gs.currentBet === 0 ? 'Bet' : 'Raise';
    raiseSlider.min   = minRaise;
    raiseSlider.max   = maxRaise;
    raiseSlider.value = minRaise;
    raiseDisplay.textContent = minRaise.toLocaleString();
    raiseSlider.oninput = () => {
      raiseDisplay.textContent = parseInt(raiseSlider.value).toLocaleString();
    };
  }
}

// ─── Action Buttons ────────────────────────────────────────────────
function bindActions() {
  document.getElementById('btn-fold').addEventListener('click', () => {
    sendAction('fold');
  });

  document.getElementById('btn-check-call').addEventListener('click', () => {
    const gs = state.gameState;
    if (!gs) return;
    const myPlayer = gs.players[state.myIdx];
    const toCall   = gs.currentBet - (myPlayer?.roundBet || 0);
    sendAction(toCall === 0 ? 'check' : 'call');
  });

  document.getElementById('btn-raise').addEventListener('click', () => {
    const amount = parseInt(document.getElementById('raise-slider').value);
    sendAction('raise', amount);
  });
}

function sendAction(action, amount = 0) {
  state.socket.emit('player_action', {
    roomId: state.roomId,
    action,
    amount,
  });
  // Immediately hide controls to prevent double-click
  document.getElementById('action-controls').classList.add('hidden');
}

// ─── Game Log ─────────────────────────────────────────────────────
function renderLog(entries) {
  const el = document.getElementById('game-log');
  el.innerHTML = entries.map(entry => {
    const isSep = entry.startsWith('---');
    return `<div class="log-entry ${isSep ? 'log-sep' : ''}">${escHtml(entry)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ─── Showdown ─────────────────────────────────────────────────────
function renderShowdown(winners, pot) {
  const overlay  = document.getElementById('showdown-overlay');
  const content  = document.getElementById('showdown-content');
  const countdown = document.getElementById('countdown');

  content.innerHTML = winners.map(w => `
    <div class="showdown-winner">
      <div class="showdown-winner-name">${escHtml(w.name)}</div>
      <div class="showdown-hand-name">${escHtml(w.handName)}</div>
      ${w.cards ? `
        <div class="showdown-winner-cards">
          ${w.cards.map(c => buildCard(c, 'md').outerHTML).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');

  content.innerHTML += `<div class="showdown-pot">Pot: ${pot.toLocaleString()} chips</div>`;

  overlay.classList.remove('hidden');

  // Countdown
  let secs = 5;
  countdown.textContent = secs;
  const timer = setInterval(() => {
    secs--;
    countdown.textContent = secs;
    if (secs <= 0) {
      clearInterval(timer);
      overlay.classList.add('hidden');
    }
  }, 1000);
}

// ─── Card Builder ─────────────────────────────────────────────────
function buildCard(card, size = 'md') {
  const el = document.createElement('div');
  const isRed = card.suit === '♥' || card.suit === '♦';
  el.className = `card card-${size} ${isRed ? 'red' : 'black'}`;

  const rankTop = document.createElement('div');
  rankTop.className = 'rank-top';
  rankTop.textContent = card.rank;

  const suitCenter = document.createElement('div');
  suitCenter.className = 'suit-center';
  suitCenter.textContent = card.suit;

  const rankBot = document.createElement('div');
  rankBot.className = 'rank-bot';
  rankBot.textContent = card.rank;

  el.appendChild(rankTop);
  el.appendChild(suitCenter);
  el.appendChild(rankBot);
  return el;
}

// ─── Client-side Hand Evaluator (display only) ────────────────────
// Simplified rank detection for label display
function evalClientHand(hole, community) {
  const all = [...hole, ...community];
  if (all.length < 5) return '';
  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const vals  = all.map(c => RANKS.indexOf(c.rank) + 2).sort((a,b) => b-a);
  const suits = all.map(c => c.suit);

  const freq = {};
  for (const v of vals) freq[v] = (freq[v]||0)+1;
  const counts = Object.values(freq).sort((a,b) => b-a);

  const flushSuit = ['♠','♥','♦','♣'].find(s => suits.filter(x=>x===s).length >= 5);
  const uv = [...new Set(vals)];
  let straight = false;
  for (let i = 0; i <= uv.length - 5; i++) {
    if (uv[i] - uv[i+4] === 4) { straight = true; break; }
  }
  if (!straight && vals.includes(14)) {
    const low = uv.map(v => v===14?1:v).sort((a,b)=>b-a);
    for (let i = 0; i <= low.length - 5; i++) {
      if (low[i] - low[i+4] === 4) { straight = true; break; }
    }
  }

  if (flushSuit && straight) return 'Straight Flush';
  if (counts[0] === 4)        return 'Four of a Kind';
  if (counts[0] === 3 && counts[1] >= 2) return 'Full House';
  if (flushSuit)              return 'Flush';
  if (straight)               return 'Straight';
  if (counts[0] === 3)        return 'Three of a Kind';
  if (counts[0] === 2 && counts[1] === 2) return 'Two Pair';
  if (counts[0] === 2)        return 'Pair';
  return 'High Card';
}

// ─── Utils ────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
