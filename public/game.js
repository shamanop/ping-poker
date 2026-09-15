'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  socket:         null,
  roomId:         null,
  myIdx:          null,
  myCards:        [],
  gameState:      null,
  selectedAvatar: '🤠',
  profilePic:     null,
};

let activeTray = null; // currently open throw tray

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.socket = io();
  bindLanding();
  bindLobby();
  bindActions();
  bindSocket();
  initSocialPanel();

  // Seat click delegation for throw feature
  document.getElementById('player-seats').addEventListener('click', (e) => {
    const seatBox = e.target.closest('.seat-box[data-player-idx]');
    if (!seatBox) return;
    const playerIdx = parseInt(seatBox.dataset.playerIdx);
    if (playerIdx === state.myIdx) return;
    showThrowTray(playerIdx, seatBox);
  });

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
  // Avatar emoji selection
  document.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedAvatar = el.dataset.avatar;
    });
  });

  // Profile photo upload
  const photoInput = document.getElementById('photo-input');
  const photoArea  = document.getElementById('photo-upload-area');

  photoArea.addEventListener('click', () => photoInput.click());

  photoArea.addEventListener('dragover', e => {
    e.preventDefault();
    photoArea.classList.add('drag-over');
  });
  photoArea.addEventListener('dragleave', () => photoArea.classList.remove('drag-over'));
  photoArea.addEventListener('drop', e => {
    e.preventDefault();
    photoArea.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) processPhotoUpload(file);
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) processPhotoUpload(file);
  });

  // Room actions — include profilePic in all join events
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    state.socket.emit('create_room', { name, avatar: state.selectedAvatar, profilePic: state.profilePic });
  });

  document.getElementById('btn-demo').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    state.socket.emit('create_demo', { name, avatar: state.selectedAvatar, profilePic: state.profilePic });
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) return;
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) { showError('Enter a room code'); return; }
    state.socket.emit('join_room', { roomId: code, name, avatar: state.selectedAvatar, profilePic: state.profilePic });
  });

  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
}

function processPhotoUpload(file) {
  const canvas = document.createElement('canvas');
  canvas.width = 80; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const size = Math.min(img.width, img.height);
    const sx = (img.width  - size) / 2;
    const sy = (img.height - size) / 2;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 80, 80);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    state.profilePic = dataUrl;

    const preview = document.getElementById('photo-preview-circle');
    preview.innerHTML = `<img src="${dataUrl}" class="photo-preview-img" alt="Profile">`;
    preview.classList.add('has-photo');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
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
  list.innerHTML = players.map(p => {
    const pic = safePic(p.profilePic);
    return `
      <div class="player-lobby-item">
        ${pic
          ? `<img class="p-profile-pic" src="${pic}" alt="">`
          : `<span class="p-avatar">${esc(p.avatar)}</span>`
        }
        <span class="p-name">${esc(p.name)}</span>
        ${p.name === hostName ? '<span class="host-badge">HOST</span>' : ''}
      </div>
    `;
  }).join('');

  const isHost = state.myIdx === 0;
  const btnStart = document.getElementById('btn-start');
  const waitMsg  = document.getElementById('waiting-msg');

  if (isHost) {
    btnStart.classList.remove('hidden');
    waitMsg.classList.add('hidden');
    const canStart = players.length >= 2;
    btnStart.disabled    = !canStart;
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
    state.myIdx   = myIdx;
    state.myCards = cards;
    if (state.gameState) renderMyCards();
  });

  s.on('showdown_result', ({ winners, pot }) => {
    renderShowdown(winners, pot);
  });

  s.on('sticker_dropped', ({ emoji, fromName }) => {
    showFloatingSticker(emoji, fromName);
  });

  s.on('item_thrown', ({ fromIdx, targetIdx, item }) => {
    const fromPos = getSeatTablePos(fromIdx);
    const toPos   = getSeatTablePos(targetIdx);
    animateProjectile(item, fromPos, toPos);
  });

  s.on('error', ({ message }) => {
    showError(message);
  });
}

// ─── Social Panel — stickers ──────────────────────────────────────
function initSocialPanel() {
  const toggle = document.getElementById('sticker-toggle');
  const tray   = document.getElementById('sticker-tray');
  if (!toggle || !tray) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    tray.classList.toggle('hidden');
  });

  tray.querySelectorAll('.sticker-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!state.roomId) return;
      state.socket.emit('drop_sticker', { roomId: state.roomId, emoji: item.dataset.emoji });
      tray.classList.add('hidden');
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#social-panel')) {
      tray.classList.add('hidden');
    }
  });
}

// ─── Throw Tray ───────────────────────────────────────────────────
function showThrowTray(playerIdx, nearEl) {
  if (activeTray) { activeTray.remove(); activeTray = null; }

  const gs = state.gameState;
  if (!gs || !gs.players[playerIdx]) return;
  if (!state.roomId) return;

  const rect = nearEl.getBoundingClientRect();
  const tray = document.createElement('div');
  tray.className = 'throw-tray';
  tray.innerHTML = `
    <div class="throw-tray-label">Throw at <strong>${esc(gs.players[playerIdx].name)}</strong></div>
    <div class="throw-options">
      <div class="throw-option" data-item="💣" title="Bomb">💣</div>
      <div class="throw-option" data-item="🍅" title="Tomato">🍅</div>
      <div class="throw-option" data-item="💦" title="Splash">💦</div>
      <div class="throw-option" data-item="🎉" title="Celebrate">🎉</div>
    </div>
  `;

  const cx = Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90);
  let   cy = rect.bottom + 6;
  if (cy + 90 > window.innerHeight) cy = rect.top - 90;

  tray.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;transform:translateX(-50%);z-index:300;`;
  document.body.appendChild(tray);
  activeTray = tray;

  tray.querySelectorAll('.throw-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      state.socket.emit('throw_item', { roomId: state.roomId, targetIdx: playerIdx, item: opt.dataset.item });
      tray.remove(); activeTray = null;
    });
  });

  const autoClose = setTimeout(() => {
    if (activeTray === tray) { tray.remove(); activeTray = null; }
  }, 4000);

  const outside = (e) => {
    if (!tray.contains(e.target)) {
      clearTimeout(autoClose);
      tray.remove(); activeTray = null;
      document.removeEventListener('click', outside);
    }
  };
  setTimeout(() => document.addEventListener('click', outside), 10);
}

// ─── Seat Position Helper ─────────────────────────────────────────
function getSeatTablePos(playerIdx) {
  const gs = state.gameState;
  if (!gs) return [50, 50];
  const n    = gs.players.length;
  const pos  = SEATS[Math.min(n, 8)] || SEATS[8];
  const myIdx  = state.myIdx ?? 0;
  const offset = (playerIdx - myIdx + n) % n;
  return pos[offset] || [50, 50];
}

// ─── Projectile Animation ─────────────────────────────────────────
function animateProjectile(item, fromPos, toPos) {
  const table = document.getElementById('poker-table');
  if (!table) return;
  const r = table.getBoundingClientRect();

  const sx = r.left + r.width  * fromPos[0] / 100;
  const sy = r.top  + r.height * fromPos[1] / 100;
  const ex = r.left + r.width  * toPos[0]   / 100;
  const ey = r.top  + r.height * toPos[1]   / 100;
  const dx = ex - sx;
  const dy = ey - sy;
  const arc = Math.min(110, Math.hypot(dx, dy) * 0.36 + 28);

  const proj = document.createElement('div');
  proj.className = 'throw-projectile';
  proj.textContent = item;
  proj.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;z-index:999;font-size:28px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(proj);

  proj.animate([
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.45}px),calc(-50% + ${dy * 0.45 - arc}px)) scale(1.4) rotate(185deg)`, offset: 0.45 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.35) rotate(380deg)`, offset: 1 },
  ], { duration: 680, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
    proj.remove();
    showSplat(item, ex, ey);
  };
}

function showSplat(item, x, y) {
  const map = { '💣': '💥', '🍅': '🔴', '💦': '💧', '🎉': '✨' };
  const el  = document.createElement('div');
  el.className  = 'throw-splat';
  el.textContent = map[item] || item;
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;font-size:54px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);

  el.animate([
    { opacity: 1, transform: 'translate(-50%,-50%) scale(0.08)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(2.5)', offset: 0.28 },
    { opacity: 0.8, transform: 'translate(-50%,-50%) scale(1.9)', offset: 0.62 },
    { opacity: 0,   transform: 'translate(-50%,-50%) scale(1.5)', offset: 1 },
  ], { duration: 950 }).onfinish = () => el.remove();
}

function showFloatingSticker(emoji, fromName) {
  const table = document.getElementById('poker-table');
  if (!table) return;
  const r = table.getBoundingClientRect();

  const el = document.createElement('div');
  el.className = 'floating-sticker';
  el.innerHTML = `<div class="float-emoji">${emoji}</div><div class="float-from">${esc(fromName)}</div>`;
  el.style.cssText = `position:fixed;left:${r.left + r.width * 0.5}px;top:${r.top + r.height * 0.42}px;z-index:998;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);

  el.animate([
    { opacity: 0,   transform: 'translate(-50%,-50%) scale(0.2)' },
    { opacity: 1,   transform: 'translate(-50%,-50%) scale(1.25)', offset: 0.18 },
    { opacity: 1,   transform: 'translate(-50%,-68%) scale(1)',    offset: 0.65 },
    { opacity: 0,   transform: 'translate(-50%,-98%) scale(0.8)',  offset: 1 },
  ], { duration: 2600 }).onfinish = () => el.remove();
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

function avatarHtml(p) {
  const pic = safePic(p.profilePic);
  if (pic) return `<img class="seat-profile-pic" src="${pic}" alt="${esc(p.name)}">`;
  return `<div class="seat-avatar">${esc(p.avatar)}</div>`;
}

function renderSeats(gs) {
  const el = document.getElementById('player-seats');
  el.innerHTML = '';
  const n    = gs.players.length;
  const pos  = SEATS[Math.min(n, 8)] || SEATS[8];
  const myIdx = state.myIdx ?? 0;

  gs.players.forEach((p, i) => {
    const offset   = (i - myIdx + n) % n;
    const [px, py] = pos[offset] || [50, 50];
    if (i === myIdx) return;

    const seat = document.createElement('div');
    seat.className = [
      'player-seat',
      p.isActive ? 'is-active' : '',
      p.folded   ? 'is-folded' : '',
    ].join(' ').trim();
    seat.style.left = `${px}%`;
    seat.style.top  = `${py}%`;

    const betHtml = p.roundBet > 0
      ? `<span class="seat-bet">${p.roundBet.toLocaleString()}</span>` : '';

    seat.innerHTML = `
      <div class="seat-box throw-target" data-player-idx="${i}">
        ${avatarHtml(p)}
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">◈ ${p.chips.toLocaleString()}</div>
        <div class="seat-bet-row">${betHtml}</div>
        <div class="seat-tags">
          ${p.isDealer ? '<div class="dealer-btn">D</div>' : ''}
          ${p.allIn    ? '<div class="allin-tag">ALL IN</div>' : ''}
          ${p.isBot    ? '<div class="bot-badge">CPU</div>' : ''}
        </div>
      </div>
      <div class="seat-hole-cards">
        ${p.cardCount > 0 && !p.folded ? cardBacksHtml(p.cardCount, 'sm') : ''}
      </div>
    `;
    el.appendChild(seat);
  });

  // My own seat
  const myPlayer = gs.players[myIdx];
  if (myPlayer) {
    const [mpx, mpy] = pos[0];
    const mSeat = document.createElement('div');
    mSeat.className = `player-seat${myPlayer.isActive ? ' is-active' : ''}`;
    mSeat.style.left = `${mpx}%`;
    mSeat.style.top  = `${mpy}%`;
    mSeat.innerHTML = `<div class="seat-box" data-player-idx="${myIdx}">
      ${avatarHtml(myPlayer)}
      <div class="seat-name">${esc(myPlayer.name)}</div>
      <div class="seat-chips">◈ ${myPlayer.chips.toLocaleString()}</div>
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
const GHOST_SUITS = ['♠', '♥', '♣', '♦', '♥'];

function renderCommunity(gs) {
  const el = document.getElementById('community-cards');
  el.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    if (gs.community && gs.community[i]) {
      el.appendChild(buildFaceCard(gs.community[i], 'md', i));
    } else {
      const ph = document.createElement('div');
      ph.className = 'card card-md placeholder';
      ph.innerHTML = `<span class="placeholder-suit">${GHOST_SUITS[i]}</span>`;
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
    const me     = gs.players[state.myIdx];
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
  const all   = [...hole, ...community];
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

  if (flushSuit && straight)                     return 'Straight Flush';
  if (counts[0] === 4)                           return 'Four of a Kind';
  if (counts[0] === 3 && (counts[1]||0) >= 2)   return 'Full House';
  if (flushSuit)                                 return 'Flush';
  if (straight)                                  return 'Straight';
  if (counts[0] === 3)                           return 'Three of a Kind';
  if (counts[0] === 2 && (counts[1]||0) === 2)  return 'Two Pair';
  if (counts[0] === 2)                           return 'Pair';
  return 'High Card';
}

// ─── Utils ────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function safePic(pic) {
  if (typeof pic !== 'string') return null;
  if (!pic.startsWith('data:image/')) return null;
  return pic;
}
