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
  myBalance:      null,
  soundOn:        true,
  prevPot:        0,
};

let activeTray      = null;
const prevChipsMap  = {};
let turnTimerIval   = null;
let chatCollapsed   = window.innerWidth <= 768;
let balanceTimeout  = null;
let blindCountdownIval = null;

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.socket = io();
  bindLanding();
  bindLobby();
  bindActions();
  bindSocket();
  initSocialPanel();
  initSoundToggle();
  initChat();
  initLeaderboard();
  initBustOverlay();

  document.getElementById('player-seats').addEventListener('click', (e) => {
    const seatBox = e.target.closest('.seat-box[data-player-idx]');
    if (!seatBox) return;
    const playerIdx = parseInt(seatBox.dataset.playerIdx);
    if (playerIdx === state.myIdx) return;
    showThrowTray(playerIdx, seatBox);
  });

  // Pre-fill saved name
  const savedName = localStorage.getItem('ppName');
  if (savedName) {
    const nameInput = document.getElementById('player-name');
    nameInput.value = savedName;
    // Trigger balance lookup
    nameInput.dispatchEvent(new Event('input'));
  }
});

// ─── Screen ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Sound FX (Web Audio API) ──────────────────────────────────────
let _audioCtx = null;
function audioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playSound(type) {
  if (!state.soundOn) return;
  try {
    const ctx  = audioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const play = (freq, vol, dur, type = 'sine', freqEnd) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
    };

    switch (type) {
      case 'deal':  play(900, 0.06, 0.055); break;
      case 'chip':  play(1400, 0.10, 0.07, 'sine', 700); break;
      case 'fold':  play(280,  0.06, 0.12, 'sine', 190); break;
      case 'check': play(600,  0.05, 0.06); break;
      case 'raise': play(520, 0.08, 0.06); setTimeout(() => play(700, 0.08, 0.06), 70); break;
      case 'win': {
        [523, 659, 784, 1047].forEach((f, i) => {
          const g2 = ctx.createGain();
          const o2 = ctx.createOscillator();
          g2.connect(ctx.destination);
          o2.connect(g2);
          o2.frequency.value = f;
          const t = ctx.currentTime + i * 0.1;
          g2.gain.setValueAtTime(0.10, t);
          g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          o2.start(t); o2.stop(t + 0.22);
        });
        break;
      }
      case 'splat': play(140, 0.14, 0.18, 'sawtooth', 50); break;
      case 'timer_warn': play(880, 0.05, 0.08); break;
      case 'blinds_up': {
        [330, 415, 523, 622, 784].forEach((f, i) => {
          const g2 = ctx.createGain();
          const o2 = ctx.createOscillator();
          g2.connect(ctx.destination);
          o2.connect(g2);
          o2.type = 'sine';
          o2.frequency.value = f;
          const t = ctx.currentTime + i * 0.09;
          g2.gain.setValueAtTime(0.11, t);
          g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o2.start(t); o2.stop(t + 0.35);
        });
        break;
      }
    }
  } catch {}
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

  const photoInput = document.getElementById('photo-input');
  const photoArea  = document.getElementById('photo-upload-area');
  photoArea.addEventListener('click', () => photoInput.click());
  photoArea.addEventListener('dragover', e => { e.preventDefault(); photoArea.classList.add('drag-over'); });
  photoArea.addEventListener('dragleave', () => photoArea.classList.remove('drag-over'));
  photoArea.addEventListener('drop', e => {
    e.preventDefault(); photoArea.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) processPhotoUpload(file);
  });
  photoInput.addEventListener('change', () => { if (photoInput.files[0]) processPhotoUpload(photoInput.files[0]); });

  // Debounced balance lookup on name change
  document.getElementById('player-name').addEventListener('input', () => {
    clearTimeout(balanceTimeout);
    const name = document.getElementById('player-name').value.trim();
    if (!name) { document.getElementById('bank-display').classList.add('hidden'); return; }
    balanceTimeout = setTimeout(() => {
      state.socket.emit('check_balance', { name });
    }, 500);
  });

  document.getElementById('btn-demo').addEventListener('click', () => {
    const name = getPlayerName(); if (!name) return;
    localStorage.setItem('ppName', name);
    state.socket.emit('create_demo', { name, avatar: state.selectedAvatar, profilePic: state.profilePic });
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const name = getPlayerName(); if (!name) return;
    const password = document.getElementById('password-input')?.value.trim() || '';
    if (!password) { showError('Enter the table password'); return; }
    localStorage.setItem('ppName', name);
    state.socket.emit('join_game', { name, avatar: state.selectedAvatar, profilePic: state.profilePic, password });
  });

  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
  document.getElementById('password-input')?.addEventListener('keydown', e => {
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
    ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 80, 80);
    URL.revokeObjectURL(url);
    state.profilePic = canvas.toDataURL('image/jpeg', 0.65);
    const preview = document.getElementById('photo-preview-circle');
    preview.innerHTML = `<img src="${state.profilePic}" class="photo-preview-img" alt="Profile">`;
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
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Lobby ────────────────────────────────────────────────────────
function bindLobby() {
  document.getElementById('btn-start').addEventListener('click', () => {
    const blindInterval = parseInt(document.getElementById('blind-interval-select')?.value || '0');
    state.socket.emit('start_game', { roomId: state.roomId, blindInterval });
  });
}

function renderLobbyPlayers(players, hostName) {
  const list = document.getElementById('lobby-players-list');
  const secLabel = list.closest('.lobby-players-section')?.querySelector('.section-label');
  if (secLabel) secLabel.textContent = `AT THE TABLE — ${players.length} / 8`;
  list.innerHTML = players.map(p => {
    const pic = safePic(p.profilePic);
    return `<div class="player-lobby-item">
      ${pic ? `<img class="p-profile-pic" src="${pic}" alt="">` : `<span class="p-avatar">${esc(p.avatar)}</span>`}
      <span class="p-name">${esc(p.name)}</span>
      ${p.name === hostName ? '<span class="host-badge">HOST</span>' : ''}
    </div>`;
  }).join('');

  const isHost = state.myIdx === 0;
  const btnStart = document.getElementById('btn-start');
  const waitMsg  = document.getElementById('waiting-msg');
  if (isHost) {
    btnStart.classList.remove('hidden'); waitMsg.classList.add('hidden');
    const canStart = players.length >= 2;
    btnStart.disabled    = !canStart;
    btnStart.textContent = canStart ? 'Start Game' : 'Waiting for players…';
  } else {
    btnStart.classList.add('hidden'); waitMsg.classList.remove('hidden');
  }
  const blindSettings = document.getElementById('blind-settings');
  if (blindSettings) blindSettings.classList.toggle('hidden', !isHost);
}

// ─── Socket ────────────────────────────────────────────────────────
function bindSocket() {
  const s = state.socket;

  s.on('balance_data', ({ balance }) => {
    state.myBalance = balance;
    const el = document.getElementById('bank-display');
    const amt = document.getElementById('bank-amount');
    amt.textContent = balance.toLocaleString();
    el.classList.remove('hidden');
  });

  s.on('balance_update', ({ balance }) => {
    state.myBalance = balance;
  });

  s.on('room_joined', ({ roomId, playerIdx, balance }) => {
    state.roomId   = roomId;
    state.myIdx    = playerIdx;
    if (balance !== undefined) state.myBalance = balance;
    showScreen('lobby-screen');
  });

  s.on('room_update', ({ players, hostName }) => {
    renderLobbyPlayers(players, hostName);
  });

  s.on('game_state', gs => {
    const prevActiveIdx = state.gameState?.currentPlayerIdx;
    state.gameState = gs;

    if (gs.status === 'playing' || gs.status === 'waiting_next') {
      showScreen('game-screen');
      renderGame();
    }

    // Turn timer — only reset when active player changes
    if (gs.currentPlayerIdx !== prevActiveIdx) {
      if (gs.turnRemainingMs != null && gs.currentPlayerIdx !== null) {
        startTurnTimer(gs.turnRemainingMs);
      } else {
        clearTurnTimer();
      }
    }
  });

  s.on('your_cards', ({ cards, myIdx }) => {
    state.myIdx   = myIdx;
    state.myCards = cards;
    if (state.gameState) { renderMyCards(); playSound('deal'); }
  });

  s.on('showdown_result', ({ winners, pot }) => {
    renderShowdown(winners, pot);
    playSound('win');
    const myName = state.gameState?.players[state.myIdx]?.name;
    if (myName && winners.some(w => w.name === myName)) {
      setTimeout(() => showWinFloat(pot), 250);
    }
  });

  s.on('sticker_dropped', ({ emoji, fromName }) => { showFloatingSticker(emoji, fromName); });
  s.on('item_thrown',     ({ fromIdx, targetIdx, item }) => {
    const fromPos = getSeatTablePos(fromIdx);
    const toPos   = getSeatTablePos(targetIdx);
    animateProjectile(item, fromPos, toPos);
  });

  s.on('chat_message', ({ name, text }) => { appendChatMsg(name, text); });

  s.on('blinds_up', ({ level, sb, bb }) => {
    showBlindsUpBanner(level, sb, bb);
  });

  s.on('bust_out', ({ balance }) => { showBustOverlay(balance); });

  s.on('leaderboard_data', ({ entries }) => { renderLeaderboard(entries); });

  s.on('error', ({ message }) => { showError(message); });
}

// ─── Sound Toggle ──────────────────────────────────────────────────
function initSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  btn.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    btn.textContent = state.soundOn ? '🔊' : '🔇';
    btn.classList.toggle('muted', !state.soundOn);
  });
}

// ─── Chat ─────────────────────────────────────────────────────────
function initChat() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const colBtn  = document.getElementById('chat-collapse');

  // Apply initial collapsed state (mobile starts collapsed)
  if (chatCollapsed) {
    document.getElementById('chat-panel').classList.add('collapsed');
    colBtn.textContent = '▲';
  }

  const sendChat = () => {
    const text = input.value.trim();
    if (!text || !state.roomId) return;
    state.socket.emit('chat_message', { roomId: state.roomId, text });
    input.value = '';
  };

  sendBtn.addEventListener('click', sendChat);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  colBtn.addEventListener('click', () => {
    chatCollapsed = !chatCollapsed;
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('collapsed', chatCollapsed);
    colBtn.textContent = chatCollapsed ? '▲' : '▼';
  });
}

function appendChatMsg(name, text) {
  const el  = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span class="chat-name">${esc(name)}</span> <span class="chat-text">${esc(text)}</span>`;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
  // Auto-expand if collapsed
  if (chatCollapsed) {
    chatCollapsed = false;
    document.getElementById('chat-panel').classList.remove('collapsed');
    document.getElementById('chat-collapse').textContent = '▼';
  }
}

// ─── Bust Overlay ──────────────────────────────────────────────────
function initBustOverlay() {
  document.getElementById('btn-rebuy').addEventListener('click', () => {
    if (!state.roomId) return;
    state.socket.emit('rebuy', { roomId: state.roomId });
    document.getElementById('bust-overlay').classList.add('hidden');
  });
}

function showBustOverlay(balance) {
  document.getElementById('bust-overlay').classList.remove('hidden');
  document.getElementById('bust-balance').textContent = `Bank: ◈ ${balance.toLocaleString()}`;
  const rebuyBtn = document.getElementById('btn-rebuy');
  const brokeMsg = document.getElementById('bust-broke-msg');
  if (balance >= 20) {
    rebuyBtn.classList.remove('hidden');
    brokeMsg.classList.add('hidden');
    rebuyBtn.textContent = `Rebuy ◈ ${Math.min(1500, balance).toLocaleString()}`;
  } else {
    rebuyBtn.classList.add('hidden');
    brokeMsg.classList.remove('hidden');
  }
}

// ─── Leaderboard ───────────────────────────────────────────────────
function initLeaderboard() {
  document.getElementById('lb-toggle').addEventListener('click', () => {
    const panel = document.getElementById('leaderboard-panel');
    if (panel.classList.contains('hidden')) {
      state.socket.emit('get_leaderboard');
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });
  document.getElementById('lb-close').addEventListener('click', () => {
    document.getElementById('leaderboard-panel').classList.add('hidden');
  });
}

function renderLeaderboard(entries) {
  const el = document.getElementById('leaderboard-entries');
  el.innerHTML = entries.map((e, i) => `
    <div class="lb-row ${e.name.toLowerCase() === (state.gameState?.players[state.myIdx]?.name || '').toLowerCase() ? 'lb-me' : ''}">
      <span class="lb-rank">#${i + 1}</span>
      <span class="lb-name">${esc(e.name)}</span>
      <span class="lb-balance">◈ ${e.balance.toLocaleString()}</span>
    </div>
  `).join('');
}

// ─── Turn Timer ────────────────────────────────────────────────────
function startTurnTimer(remainingMs) {
  clearTurnTimer();
  const endAt = Date.now() + remainingMs;

  turnTimerIval = setInterval(() => {
    const rem  = Math.max(0, endAt - Date.now());
    const secs = Math.ceil(rem / 1000);
    const pct  = rem / 30000;

    // Color interpolation gold → red
    const r = Math.round(245 - (1 - pct) * 53)  | 0;
    const g = Math.round(185 * pct)              | 0;
    const b = Math.round(66  * pct + 48 * (1 - pct)) | 0;
    const col = `rgb(${r},${g},${b})`;

    document.querySelectorAll('.seat-timer').forEach(el => {
      el.textContent = secs;
      el.style.color = col;
      // Warning flash below 6s
      el.classList.toggle('timer-warn', secs <= 6);
    });

    // My-turn countdown strip
    const myTimer = document.getElementById('my-turn-timer');
    if (myTimer) {
      myTimer.textContent = secs;
      myTimer.style.color = col;
    }

    if (secs <= 6 && secs % 2 === 0) playSound('timer_warn');
    if (rem <= 0) clearTurnTimer();
  }, 200);
}

function clearTurnTimer() {
  if (turnTimerIval) { clearInterval(turnTimerIval); turnTimerIval = null; }
}

// ─── Blind Countdown ──────────────────────────────────────────────────────
function startBlindCountdown(remainingMs) {
  if (blindCountdownIval) { clearInterval(blindCountdownIval); blindCountdownIval = null; }
  const el = document.getElementById('blind-display');
  if (!el || remainingMs === null || remainingMs === undefined) return;

  const endAt = Date.now() + remainingMs;
  const update = () => {
    const rem  = Math.max(0, endAt - Date.now());
    const mins = Math.floor(rem / 60000);
    const secs = Math.floor((rem % 60000) / 1000);
    const gs   = state.gameState;
    if (!gs?.blindsEnabled) { el.textContent = `BLINDS  ${gs?.sb || 10} / ${gs?.bb || 20}`; return; }
    const sb = gs.sb || 10, bb = gs.bb || 20;
    el.textContent = `LEVEL ${gs.blindLevel + 1}  ·  ${sb} / ${bb}  ·  ↑ ${mins}:${secs.toString().padStart(2, '0')}`;
    el.classList.toggle('blind-display-warn', rem <= 30000);
    if (rem <= 0) { clearInterval(blindCountdownIval); blindCountdownIval = null; }
  };
  update();
  blindCountdownIval = setInterval(update, 1000);
}

// ─── Blinds Up Banner ─────────────────────────────────────────────────────
function showBlindsUpBanner(level, sb, bb) {
  const banner = document.getElementById('blinds-up-banner');
  if (!banner) return;
  banner.querySelector('.bub-level').textContent  = `LEVEL ${level + 1}`;
  banner.querySelector('.bub-value').textContent  = `${sb} / ${bb}`;
  banner.classList.remove('hidden', 'bub-out');
  banner.classList.add('bub-in');
  playSound('blinds_up');
  setTimeout(() => {
    banner.classList.remove('bub-in');
    banner.classList.add('bub-out');
    setTimeout(() => { banner.classList.add('hidden'); banner.classList.remove('bub-out'); }, 500);
  }, 3500);
}

// ─── Social Panel ─────────────────────────────────────────────────
function initSocialPanel() {
  const toggle = document.getElementById('sticker-toggle');
  const tray   = document.getElementById('sticker-tray');
  if (!toggle || !tray) return;

  toggle.addEventListener('click', e => { e.stopPropagation(); tray.classList.toggle('hidden'); });

  tray.querySelectorAll('.sticker-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!state.roomId) return;
      state.socket.emit('drop_sticker', { roomId: state.roomId, emoji: item.dataset.emoji });
      tray.classList.add('hidden');
    });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#social-panel')) tray.classList.add('hidden');
  });
}

// ─── Throw Tray ───────────────────────────────────────────────────
function showThrowTray(playerIdx, nearEl) {
  if (activeTray) { activeTray.remove(); activeTray = null; }
  const gs = state.gameState;
  if (!gs?.players[playerIdx] || !state.roomId) return;

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
    </div>`;

  const trayW = 168;
  const rawCx = rect.left + rect.width / 2;
  const cx    = Math.min(Math.max(rawCx, trayW / 2 + 8), window.innerWidth - trayW / 2 - 8);
  let   cy    = rect.bottom + 6;
  if (cy + 90 > window.innerHeight) cy = rect.top - 90;

  tray.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;transform:translateX(-50%);z-index:300;`;
  document.body.appendChild(tray);
  activeTray = tray;

  tray.querySelectorAll('.throw-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      state.socket.emit('throw_item', { roomId: state.roomId, targetIdx: playerIdx, item: opt.dataset.item });
      tray.remove(); activeTray = null;
    });
  });

  const autoClose = setTimeout(() => { if (activeTray === tray) { tray.remove(); activeTray = null; } }, 4000);
  const outside = e => {
    if (!tray.contains(e.target)) {
      clearTimeout(autoClose); tray.remove(); activeTray = null;
      document.removeEventListener('click', outside);
    }
  };
  setTimeout(() => document.addEventListener('click', outside), 10);
}

// ─── Seat Position Helper ─────────────────────────────────────────
function getSeatTablePos(playerIdx) {
  const gs = state.gameState;
  if (!gs) return [50, 50];
  const n      = gs.players.length;
  const pos    = SEATS[Math.min(n, 8)] || SEATS[8];
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
  const dx = ex - sx, dy = ey - sy;
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
  ], { duration: 680, easing: 'ease-out', fill: 'forwards' }).onfinish = () => {
    proj.remove(); showSplat(item, ex, ey);
  };
}

function showSplat(item, x, y) {
  playSound('splat');
  const map = { '💣': '💥', '🍅': '💢', '💦': '🌊', '🎉': '✨' };
  const el  = document.createElement('div');
  el.className  = 'throw-splat';
  el.textContent = map[item] || item;
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;font-size:54px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  el.animate([
    { opacity: 1, transform: 'translate(-50%,-50%) scale(0.08)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(2.5)', offset: 0.28 },
    { opacity: 0.8, transform: 'translate(-50%,-50%) scale(1.9)', offset: 0.62 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.5)', offset: 1 },
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
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.2)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.25)', offset: 0.18 },
    { opacity: 1, transform: 'translate(-50%,-68%) scale(1)',    offset: 0.65 },
    { opacity: 0, transform: 'translate(-50%,-98%) scale(0.8)',  offset: 1 },
  ], { duration: 2600 }).onfinish = () => el.remove();
}

// ─── Game Render ──────────────────────────────────────────────────
function renderGame() {
  const gs = state.gameState;
  if (!gs) return;
  renderSeats(gs);
  renderCommunity(gs);
  document.getElementById('street-label').textContent = gs.street?.toUpperCase() || '';

  // Pot display + pulse on increase
  const potEl  = document.getElementById('pot-display');
  const potTxt = gs.pot > 0 ? `POT  ${gs.pot.toLocaleString()}` : '';
  if (gs.pot > state.prevPot && gs.pot > 0) {
    potEl.classList.remove('pot-pulse');
    void potEl.offsetWidth; // reflow
    potEl.classList.add('pot-pulse');
    playSound('chip');
  }
  potEl.textContent = potTxt;
  state.prevPot = gs.pot;

  // Blind display
  const blindEl = document.getElementById('blind-display');
  if (blindEl) {
    const sb = gs.sb || 10, bb = gs.bb || 20;
    blindEl.textContent = gs.blindsEnabled
      ? `LEVEL ${gs.blindLevel + 1}  ·  ${sb} / ${bb}`
      : `BLINDS  ${sb} / ${bb}`;
  }
  if (gs.blindNextMs !== undefined) startBlindCountdown(gs.blindNextMs);

  // Sit out button
  const sitOutWrap = document.getElementById('sit-out-wrap');
  const sitOutBtn  = document.getElementById('btn-sit-out');
  const myPlayer   = gs.players[state.myIdx];
  if (sitOutWrap && sitOutBtn && myPlayer && gs.status === 'playing') {
    sitOutWrap.classList.remove('hidden');
    const will = myPlayer.sitOutRequest;
    sitOutBtn.textContent = will ? "I'm Back" : 'Sit Out Next Hand';
    sitOutBtn.classList.toggle('sit-out-active', will);
  } else if (sitOutWrap) {
    sitOutWrap.classList.add('hidden');
  }

  renderMyCards();
  renderControls(gs);
  renderLog(gs.log);
}

// ─── SB/BB Helper ─────────────────────────────────────────────────
function nextActiveSeat(fromIdx, players) {
  const n = players.length;
  for (let offset = 1; offset <= n; offset++) {
    const c = (fromIdx + offset) % n;
    if (!players[c].sittingOut && players[c].connected) return c;
  }
  return (fromIdx + 1) % n;
}

// ─── Seat Positions ────────────────────────────────────────────────
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
  const n     = gs.players.length;
  const pos   = SEATS[Math.min(n, 8)] || SEATS[8];
  const myIdx = state.myIdx ?? 0;
  const maxChips = Math.max(...gs.players.map(p => p.chips));
  const sbIdx = gs.status === 'playing' ? nextActiveSeat(gs.dealerIdx, gs.players) : -1;
  const bbIdx = gs.status === 'playing' ? nextActiveSeat(sbIdx, gs.players) : -1;

  gs.players.forEach((p, i) => {
    const offset   = (i - myIdx + n) % n;
    const [px, py] = pos[offset] || [50, 50];
    if (i === myIdx) return;

    const seat = document.createElement('div');
    seat.className = ['player-seat', p.isActive ? 'is-active' : '', p.folded ? 'is-folded' : '', p.sittingOut ? 'is-sitting-out' : ''].join(' ').trim();
    seat.style.left = `${px}%`;
    seat.style.top  = `${py}%`;

    const betHtml = p.roundBet > 0 ? `<span class="seat-bet">${p.roundBet.toLocaleString()}</span>` : '';

    const pl = p.chips - (p.chipsBought || p.chips);
    const plHtml = pl !== 0
      ? `<div class="seat-pnl ${pl > 0 ? 'pnl-up' : 'pnl-down'}">${pl > 0 ? '+' : ''}${pl.toLocaleString()}</div>`
      : '';
    seat.innerHTML = `
      <div class="seat-box throw-target" data-player-idx="${i}">
        ${avatarHtml(p)}
        <div class="seat-name">${esc(p.name)}</div>
        <div class="seat-chips">◈ ${p.chips.toLocaleString()}</div>
        ${plHtml}
        <div class="seat-bet-row">${betHtml}</div>
        <div class="seat-tags">
          ${p.isDealer ? '<div class="dealer-btn">D</div>' : ''}
          ${i === sbIdx ? '<div class="blind-btn sb-btn">SB</div>' : ''}
          ${i === bbIdx ? '<div class="blind-btn bb-btn">BB</div>' : ''}
          ${p.lastAction ? `<div class="action-badge action-${p.lastAction.toLowerCase()}">${p.lastAction}</div>` : ''}
          ${p.chips === maxChips && p.chips > 0 && gs.players.filter(p2 => p2.chips === maxChips).length === 1 ? '<div class="chip-leader-badge">👑</div>' : ''}
          ${p.allIn    ? '<div class="allin-tag">ALL IN</div>' : ''}
          ${p.isBot    ? '<div class="bot-badge">CPU</div>' : ''}
          ${p.sittingOut  ? '<div class="away-badge">AWAY</div>' : ''}
        </div>
        ${p.isActive ? '<div class="seat-timer">30</div>' : ''}
      </div>
      <div class="seat-hole-cards">
        ${p.cardCount > 0 && !p.folded ? cardBacksHtml(p.cardCount, 'sm') : ''}
      </div>`;
    el.appendChild(seat);
    seat.querySelectorAll('.seat-chips').forEach(chipEl => {
      if (prevChipsMap[i] !== p.chips) {
        chipEl.classList.add('ticking');
        setTimeout(() => chipEl.classList.remove('ticking'), 300);
      }
    });
    prevChipsMap[i] = p.chips;
  });

  // My seat
  const myPlayer = gs.players[myIdx];
  if (myPlayer) {
    const [mpx, mpy] = pos[0];
    const mSeat = document.createElement('div');
    mSeat.className = `player-seat${myPlayer.isActive ? ' is-active' : ''}`;
    mSeat.style.left = `${mpx}%`;
    mSeat.style.top  = `${mpy}%`;
    const myPl = myPlayer.chips - (myPlayer.chipsBought || myPlayer.chips);
    const myPlHtml = myPl !== 0
      ? `<div class="seat-pnl ${myPl > 0 ? 'pnl-up' : 'pnl-down'}">${myPl > 0 ? '+' : ''}${myPl.toLocaleString()}</div>`
      : '';
    mSeat.innerHTML = `<div class="seat-box" data-player-idx="${myIdx}">
      ${avatarHtml(myPlayer)}
      <div class="seat-name">${esc(myPlayer.name)}</div>
      <div class="seat-chips">◈ ${myPlayer.chips.toLocaleString()}</div>
      ${myPlHtml}
      <div class="seat-bet-row">${myPlayer.roundBet > 0 ? `<span class="seat-bet">${myPlayer.roundBet.toLocaleString()}</span>` : ''}</div>
      <div class="seat-tags">
        ${myPlayer.isDealer ? '<div class="dealer-btn">D</div>' : ''}
        ${myIdx === sbIdx ? '<div class="blind-btn sb-btn">SB</div>' : ''}
        ${myIdx === bbIdx ? '<div class="blind-btn bb-btn">BB</div>' : ''}
        ${myPlayer.lastAction ? `<div class="action-badge action-${myPlayer.lastAction.toLowerCase()}">${myPlayer.lastAction}</div>` : ''}
        ${myPlayer.chips === maxChips && myPlayer.chips > 0 && gs.players.filter(p2 => p2.chips === maxChips).length === 1 ? '<div class="chip-leader-badge">👑</div>' : ''}
        ${myPlayer.allIn    ? '<div class="allin-tag">ALL IN</div>' : ''}
      </div>
    </div>
    <div class="seat-my-cards" id="seat-my-cards"></div>
    <div class="my-hand-label seat-hand-label" id="my-hand-label"></div>`;
    el.appendChild(mSeat);
    mSeat.querySelectorAll('.seat-chips').forEach(chipEl => {
      if (prevChipsMap[myIdx] !== myPlayer.chips) {
        chipEl.classList.add('ticking');
        setTimeout(() => chipEl.classList.remove('ticking'), 300);
      }
    });
    prevChipsMap[myIdx] = myPlayer.chips;
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
  const prevCount = el.querySelectorAll('.card.face').length;
  el.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    if (gs.community?.[i]) {
      const card = buildFaceCard(gs.community[i], 'md', i);
      if (i >= prevCount) {
        card.classList.add('reveal-flash');
        card.style.animationDelay = `${(i - prevCount) * 0.12}s`;
      }
      el.appendChild(card);
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
  // Cards now live under the player's seat on the table
  const el = document.getElementById('seat-my-cards');
  if (!el) return;
  el.innerHTML = '';
  const labelEl = document.getElementById('my-hand-label');
  if (state.myCards.length === 0) {
    for (let i = 0; i < 2; i++) {
      const ph = document.createElement('div'); ph.className = 'card card-md placeholder'; el.appendChild(ph);
    }
    if (labelEl) labelEl.textContent = '';
    return;
  }
  state.myCards.forEach((card, i) => {
    const cardEl = buildFaceCard(card, 'md', 0);
    cardEl.classList.add('flip-in');
    cardEl.style.animationDelay = `${i * 0.08}s`;
    el.appendChild(cardEl);
  });
  const gs = state.gameState;
  if (labelEl) {
    if (gs?.community?.length >= 3) {
      labelEl.textContent = evalHandLabel(state.myCards, gs.community);
    } else {
      labelEl.textContent = evalPreflopLabel(state.myCards);
    }
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

  // Pot odds display
  const oddsEl = document.getElementById('pot-odds-display');
  if (oddsEl) {
    if (toCall > 0 && gs.pot > 0) {
      const pct = Math.round(toCall / (gs.pot + toCall) * 100);
      const cls = pct < 20 ? 'odds-good' : pct < 35 ? 'odds-ok' : 'odds-bad';
      oddsEl.className = `pot-odds-display ${cls}`;
      oddsEl.textContent = `POT ODDS  ·  ${pct}%  equity needed`;
      oddsEl.classList.remove('hidden');
    } else {
      oddsEl.classList.add('hidden');
    }
  }
  const canCheck = toCall === 0;
  const callBtn  = document.getElementById('btn-check-call');
  callBtn.textContent = canCheck ? 'Check' : `Call  ${toCall.toLocaleString()}`;

  const raiseRow = document.getElementById('raise-row');
  const slider   = document.getElementById('raise-slider');
  const display  = document.getElementById('raise-display');
  const raiseBtn = document.getElementById('btn-raise');
  const presets  = document.getElementById('raise-presets');

  const minRaise = gs.currentBet + (gs.bb || BIG_BLIND);
  const maxRaise = myPlayer.chips + (myPlayer.roundBet || 0);
  const canRaise = myPlayer.chips > toCall;

  if (!canRaise || maxRaise < minRaise) {
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

    slider.oninput = () => { display.textContent = Number(slider.value).toLocaleString(); };

    // Raise presets
    if (presets) {
      presets.querySelectorAll('.preset-btn').forEach(btn => {
        btn.onclick = () => {
          let val;
          const bb = gs.bb || BIG_BLIND;
          if (btn.dataset.preset === '2x')  val = Math.min(bb * 2, maxRaise);
          if (btn.dataset.preset === '3x')  val = Math.min(bb * 3, maxRaise);
          if (btn.dataset.preset === 'pot') val = Math.min(gs.pot + gs.currentBet, maxRaise);
          val = Math.max(val || minRaise, minRaise);
          slider.value = val;
          display.textContent = Number(val).toLocaleString();
          presets.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
    }
  }
}

const BIG_BLIND = 20;

// ─── Action Sends ──────────────────────────────────────────────────
function bindActions() {
  document.getElementById('btn-fold').addEventListener('click', () => {
    playSound('fold'); sendAction('fold');
  });
  document.getElementById('btn-check-call').addEventListener('click', () => {
    const gs = state.gameState; if (!gs) return;
    const me     = gs.players[state.myIdx];
    const toCall = gs.currentBet - (me?.roundBet || 0);
    const action = toCall === 0 ? 'check' : 'call';
    playSound(action === 'check' ? 'check' : 'chip');
    sendAction(action);
  });
  document.getElementById('btn-raise').addEventListener('click', () => {
    const amount = parseInt(document.getElementById('raise-slider').value);
    playSound('raise');
    sendAction('raise', amount);
  });
  document.getElementById('btn-sit-out')?.addEventListener('click', () => {
    if (!state.roomId) return;
    state.socket.emit('sit_out', { roomId: state.roomId });
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
  const community = state.gameState?.community || [];

  content.innerHTML = winners.map(w => {
    // Build all 7 card elements: 5 community + 2 hole
    const commHtml = community.map((c, i) => {
      return `<div class="showdown-card-wrap"><div class="card face card-md ${c.suit === '♥' || c.suit === '♦' ? 'red' : 'black'}" style="animation-delay:${i*0.07}s">
        <div class="rank-tl"><div>${esc(c.rank)}</div><div class="card-suit">${esc(c.suit)}</div></div>
        <div class="suit-ctr">${esc(c.suit)}</div>
        <div class="rank-br"><div>${esc(c.rank)}</div><div class="card-suit">${esc(c.suit)}</div></div>
      </div></div>`;
    }).join('');

    const holeHtml = w.cards ? w.cards.map((c, i) => {
      return `<div class="showdown-card-wrap best"><div class="card face card-md ${c.suit === '♥' || c.suit === '♦' ? 'red' : 'black'}" style="animation-delay:${(community.length + i)*0.07}s">
        <div class="rank-tl"><div>${esc(c.rank)}</div><div class="card-suit">${esc(c.suit)}</div></div>
        <div class="suit-ctr">${esc(c.suit)}</div>
        <div class="rank-br"><div>${esc(c.rank)}</div><div class="card-suit">${esc(c.suit)}</div></div>
      </div></div>`;
    }).join('') : '';

    const divider = community.length > 0 && holeHtml ? '<div class="showdown-divider"></div>' : '';

    return `
      <div class="showdown-winner">
        <div class="showdown-winner-name">${esc(w.name)}</div>
        <div class="showdown-hand-name">${esc(w.handName)}</div>
        <div class="showdown-all-cards">${commHtml}${divider}${holeHtml}</div>
      </div>
      <div class="showdown-pot">Pot: <strong>◈ ${pot.toLocaleString()}</strong></div>
    `;
  }).join('');

  overlay.classList.remove('hidden');

  // Confetti burst
  spawnConfetti(overlay);

  let secs = 5;
  countdown.textContent = secs;
  const timer = setInterval(() => {
    secs--;
    countdown.textContent = secs;
    if (secs <= 0) { clearInterval(timer); overlay.classList.add('hidden'); }
  }, 1000);
}

function spawnConfetti(container) {
  const colors = ['#F5B942', '#ffe066', '#fff', '#b8860b', '#ffd700'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.4;
    const dist  = 80 + Math.random() * 120;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;
    p.style.cssText = `
      background: ${colors[i % colors.length]};
      left: 50%; top: 50%;
      --tx: ${tx}px; --ty: ${ty}px;
      --rot: ${Math.floor(Math.random() * 720 - 360)}deg;
      --dur: ${0.6 + Math.random() * 0.5}s;
      --delay: ${Math.random() * 0.15}s;
    `;
    container.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

// ─── Card Builder ─────────────────────────────────────────────────
function buildFaceCard(card, size = 'md', delay = 0) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const el    = document.createElement('div');
  el.className = `card face card-${size} ${isRed ? 'red' : 'black'}`;
  el.style.animationDelay = `${delay * 0.07}s`;
  el.innerHTML = `
    <div class="rank-tl"><div>${esc(card.rank)}</div><div class="card-suit">${esc(card.suit)}</div></div>
    <div class="suit-ctr">${esc(card.suit)}</div>
    <div class="rank-br"><div>${esc(card.rank)}</div><div class="card-suit">${esc(card.suit)}</div></div>`;
  return el;
}

// ─── Hand Label ───────────────────────────────────────────────────
function evalHandLabel(hole, community) {
  const all   = [...hole, ...community];
  const RNKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const vals  = all.map(c => RNKS.indexOf(c.rank) + 2).sort((a, b) => b - a);
  const suits = all.map(c => c.suit);
  const freq  = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.values(freq).sort((a, b) => b - a);
  const flush  = ['♠','♥','♦','♣'].find(s => suits.filter(x => x === s).length >= 5);
  const uv = [...new Set(vals)];
  let str = false;
  for (let i = 0; i <= uv.length - 5; i++) if (uv[i] - uv[i+4] === 4) { str = true; break; }
  if (!str && vals.includes(14)) {
    const low = [...new Set(vals.map(v => v === 14 ? 1 : v))].sort((a, b) => b - a);
    for (let i = 0; i <= low.length - 5; i++) if (low[i] - low[i+4] === 4) { str = true; break; }
  }
  if (flush && str)                             return 'Straight Flush';
  if (counts[0] === 4)                          return 'Four of a Kind';
  if (counts[0] === 3 && (counts[1]||0) >= 2)  return 'Full House';
  if (flush)                                    return 'Flush';
  if (str)                                      return 'Straight';
  if (counts[0] === 3)                          return 'Three of a Kind';
  if (counts[0] === 2 && (counts[1]||0) === 2) return 'Two Pair';
  if (counts[0] === 2)                          return 'Pair';
  return 'High Card';
}

// ─── Pre-flop Label ───────────────────────────────────────────────
function evalPreflopLabel(hole) {
  if (!hole || hole.length < 2) return '';
  const [a, b] = hole;
  const RNKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const NAMES = { '2':'Twos','3':'Threes','4':'Fours','5':'Fives','6':'Sixes','7':'Sevens',
                  '8':'Eights','9':'Nines','10':'Tens','J':'Jacks','Q':'Queens','K':'Kings','A':'Aces' };
  const va = RNKS.indexOf(a.rank), vb = RNKS.indexOf(b.rank);
  const suited = a.suit === b.suit;
  const gap    = Math.abs(va - vb);
  if (gap === 0) return `Pocket ${NAMES[a.rank] || a.rank}`;
  const hi = RNKS[Math.max(va, vb)], lo = RNKS[Math.min(va, vb)];
  if (hi === 'A' && lo === 'K') return suited ? 'Ace-King Suited' : 'Big Slick';
  if (hi === 'A' && lo === 'Q') return suited ? 'Ace-Queen Suited' : 'Ace-Queen';
  if (hi === 'K' && lo === 'Q') return suited ? 'King-Queen Suited' : 'King-Queen';
  if (hi === 'A' && lo === 'J') return suited ? 'Ace-Jack Suited' : 'Ace-Jack';
  if (suited && gap === 1)      return 'Suited Connectors';
  if (suited)                   return 'Suited';
  if (gap === 1)                return 'Connectors';
  if (hi === 'A')               return 'Ace-High';
  return '';
}

// ─── Win Float ────────────────────────────────────────────────────
function showWinFloat(amount) {
  const potEl  = document.getElementById('pot-display');
  const mySeat = document.querySelector(`#player-seats .player-seat .seat-box[data-player-idx="${state.myIdx}"]`);
  if (!potEl || !mySeat) return;
  const potR  = potEl.getBoundingClientRect();
  const seatR = mySeat.getBoundingClientRect();
  const el    = document.createElement('div');
  el.className = 'win-float';
  el.textContent = `+${amount.toLocaleString()}`;
  el.style.cssText = `position:fixed;left:${potR.left + potR.width / 2}px;top:${potR.top + potR.height / 2}px;z-index:999;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  const dx = (seatR.left + seatR.width / 2) - (potR.left + potR.width / 2);
  const dy = (seatR.top  + seatR.height / 2) - (potR.top + potR.height / 2);
  el.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.4)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.1 },
    { opacity: 1, transform: `translate(calc(-50% + ${dx * 0.75}px),calc(-50% + ${dy * 0.75}px)) scale(1)`, offset: 0.78 },
    { opacity: 0, transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.7)`, offset: 1 },
  ], { duration: 950, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }).onfinish = () => el.remove();
}

// ─── Utils ────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function safePic(pic) {
  if (typeof pic !== 'string') return null;
  if (!pic.startsWith('data:image/')) return null;
  return pic;
}
