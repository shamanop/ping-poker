'use strict';
// Table settings: validation, blind schedule, escalation level. Pure (no I/O, no clock). Contract: V2-DESIGN.md sections 2 and 5.
// Port of tables.js validateSettings/genSchedule/defaultsFor with the M7 rules. A rejection is
// { ok:false, code, field, message, min?, max?, have? } and `message` never contains a digit or a '$' (tests/v2/27_errors.js).

const MAX_SEATS = 8;                  // seats 9 used to be accepted and silently clamped (M7): now rejected
const MIN_SEATS = 2;
const TIMERS = [0, 15, 30, 45, 60];
const EVERY_MIN = [10, 15, 20, 30];
const MULTS = { standard: [1, 1.5, 2.5, 5, 7.5, 10, 15, 20], turbo: [1, 2, 4, 8, 16, 32, 64, 128] };
const MAX_UNITS = 100000000;
const NAME_MIN = 2, NAME_MAX = 24;
const LOOKS = ['basement', 'yacht', 'miami', 'redroom', 'ranch', 'vault', 'saucer'];   // table looks (room + table paintings, public/images/ui/looks/<id>/); the lobby stays the basement

const isInt = n => Number.isSafeInteger(n);

function defaultsFor(mode) {
  return mode === 'chips'
    ? { buyIn: { min: 500, max: 1000000, default: 2000 }, blinds: { sb: 25, bb: 50 } }
    : mode === 'play'
      ? { buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 } }
      : { buyIn: { min: 500, max: 50000, default: 10000 }, blinds: { sb: 50, bb: 100 } };
}

const range = (field, message, extra) => ({ ok: false, code: 'range', field, message, ...(extra || {}) });
const invalid = (field, message) => ({ ok: false, code: 'invalid', field, message });

// Returns { ok:true, value } or a rejection (see top). `raw` is the create-form shape.
function validateSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('settings', 'Bad table settings');
  const mode = raw.mode === undefined ? 'play' : raw.mode;
  if (!['chips', 'play'].includes(mode)) return invalid('mode', 'Mode must be chips or play');
  const unit = mode === 'chips' ? 'chips' : 'cents';
  if (raw.unit !== undefined && raw.unit !== unit) return invalid('unit', 'Unit does not match the mode');
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ') : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) return range('name', 'Table name is too short or too long', { min: NAME_MIN, max: NAME_MAX, have: name.length });
  const d = defaultsFor(mode);
  const bi = raw.buyIn === undefined ? d.buyIn : raw.buyIn;
  const bl = raw.blinds === undefined ? d.blinds : raw.blinds;
  if (!bi || typeof bi !== 'object' || !bl || typeof bl !== 'object') return invalid('buyIn', 'Bad buy-in or blinds');
  const buyIn = { min: bi.min, max: bi.max, default: bi.default === undefined ? Math.max(bi.min, Math.min(bi.max, d.buyIn.default)) : bi.default };
  for (const k of ['min', 'max', 'default']) {
    if (!isInt(buyIn[k]) || buyIn[k] < 1 || buyIn[k] > MAX_UNITS) return range('buyIn.' + k, 'Buy-in must be a whole number', { min: 1, max: MAX_UNITS, have: buyIn[k] });
  }
  if (buyIn.min > buyIn.max) return range('buyIn.max', 'Maximum buy-in is below the minimum', { min: buyIn.min, have: buyIn.max });
  if (buyIn.default < buyIn.min || buyIn.default > buyIn.max) return range('buyIn.default', 'Default buy-in must be between the minimum and the maximum', { min: buyIn.min, max: buyIn.max, have: buyIn.default });
  const blinds = { sb: bl.sb, bb: bl.bb };
  if (!isInt(blinds.sb) || !isInt(blinds.bb) || blinds.sb < 1 || blinds.bb < 2 || blinds.sb >= blinds.bb) return range('blinds', 'Blinds must be whole numbers with the small blind below the big blind', { min: 2, have: blinds.bb });
  // M7: a table nobody can play. Every legal buy-in must cover at least one big blind.
  if (buyIn.min < blinds.bb) return range('buyIn.min', 'Minimum buy-in is below the big blind', { min: blinds.bb, have: buyIn.min });
  const seats = raw.seats === undefined ? MAX_SEATS : raw.seats;
  if (!isInt(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return range('seats', 'Seat count is not supported', { min: MIN_SEATS, max: MAX_SEATS, have: seats });
  const timer = raw.actionTimerSec === undefined ? 30 : raw.actionTimerSec;
  if (!TIMERS.includes(timer)) return range('actionTimerSec', 'Action timer is not one of the allowed values', { have: timer });
  const bool = (v, def) => (v === undefined ? def : v);
  const rebuys = bool(raw.rebuys, true), isPrivate = bool(raw.isPrivate, true), autoStart = bool(raw.autoStart, true);
  if (typeof rebuys !== 'boolean' || typeof isPrivate !== 'boolean' || typeof autoStart !== 'boolean') return invalid('options', 'Bad option');
  const rebuyLimit = raw.rebuyLimit === undefined ? 0 : raw.rebuyLimit;
  if (!isInt(rebuyLimit) || rebuyLimit < 0 || rebuyLimit > 99) return range('rebuyLimit', 'Bad rebuy limit', { min: 0, max: 99, have: rebuyLimit });
  const bin = raw.blindIncrease === undefined ? {} : raw.blindIncrease;
  if (!bin || typeof bin !== 'object') return invalid('blindIncrease', 'Bad blind increase');
  const blindIncrease = { enabled: !!bin.enabled, everyMin: bin.everyMin === undefined ? 15 : bin.everyMin, schedule: bin.schedule === undefined ? 'standard' : bin.schedule };
  if (!EVERY_MIN.includes(blindIncrease.everyMin) || !MULTS[blindIncrease.schedule]) return invalid('blindIncrease', 'Bad blind increase');
  const look = raw.look === undefined ? 'basement' : raw.look;
  if (typeof look !== 'string' || !LOOKS.includes(look)) return invalid('look', 'Unknown table look');
  return { ok: true, value: { name, mode, unit, buyIn, blinds, blindIncrease, seats, actionTimerSec: timer, rebuys, rebuyLimit, isPrivate, autoStart, look } };
}

// The full escalation ladder for a starting blind pair: [{ sb, bb }] (level 0 first).
function genSchedule(sb, bb, kind) {
  const nice = v => Math.max(5, Math.round(v / 5) * 5);
  const out = [{ sb, bb }];
  const ratio = sb / bb;
  for (const m of MULTS[kind].slice(1)) {
    const prev = out[out.length - 1];
    const nb = Math.max(prev.bb + 1, nice(bb * m));
    const ns = Math.min(nb - 1, Math.max(1, Math.round(nb * ratio)));
    out.push({ sb: ns, bb: nb });
  }
  return out;
}

// Escalation level for a table at `now`. No timer: it is computed when a hand starts.
// `s` = validated settings (blinds, blindIncrease); `blindStartAt` = ms when the schedule (re)started.
// Returns { level, maxLevel, sb, bb, enabled, nextMs } (nextMs = ms to the next level, or null when off or at the top).
function levelAt(s, blindStartAt, now) {
  const inc = s.blindIncrease;
  if (!inc || !inc.enabled || !(blindStartAt > 0)) return { level: 0, maxLevel: 0, sb: s.blinds.sb, bb: s.blinds.bb, enabled: false, nextMs: null };
  const sched = genSchedule(s.blinds.sb, s.blinds.bb, inc.schedule);
  const every = inc.everyMin * 60000;
  const maxLevel = sched.length - 1;
  const level = Math.max(0, Math.min(maxLevel, Math.floor((now - blindStartAt) / every)));
  const nextMs = level >= maxLevel ? null : Math.max(0, blindStartAt + (level + 1) * every - now);
  return { level, maxLevel, sb: sched[level].sb, bb: sched[level].bb, enabled: true, nextMs };
}

module.exports = { validateSettings, genSchedule, defaultsFor, levelAt, MAX_SEATS, MIN_SEATS, LOOKS, TIMERS, MULTS, MAX_UNITS };
