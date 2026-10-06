'use strict';
// tables/settings.js tests. Plain node: exit 0 on pass, 1 on fail.
const { validateSettings, genSchedule, defaultsFor, levelAt } = require('../../tables/settings');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
const base = { name: 'Tbl', mode: 'chips' };
const bad = (raw, field) => { const r = validateSettings(raw); ok(!r.ok, 'accepted ' + JSON.stringify(raw)); if (field) eq(r.field, field, 'field'); ok(!/[0-9$]/.test(r.message), 'digit or $ in message: ' + r.message); return r; };

t('defaults: chips table', () => {
  const r = validateSettings(base);
  ok(r.ok);
  eq(r.value, { name: 'Tbl', mode: 'chips', unit: 'chips', buyIn: { min: 500, max: 1000000, default: 2000 }, blinds: { sb: 25, bb: 50 }, blindIncrease: { enabled: false, everyMin: 15, schedule: 'standard' }, seats: 8, actionTimerSec: 30, rebuys: true, rebuyLimit: 0, isPrivate: true, autoStart: true });
});
t('defaults: play table uses cents and its own caps', () => {
  const r = validateSettings({ name: 'Pl' });
  ok(r.ok); eq(r.value.mode, 'play'); eq(r.value.unit, 'cents'); eq(r.value.buyIn.max, 50000);
});
t('defaultsFor an unknown mode is the old fallback', () => eq(defaultsFor('x').blinds, { sb: 50, bb: 100 }));
t('M7: min buy-in below the big blind', () => {
  const r = bad({ ...base, buyIn: { min: 1, max: 100000, default: 2000 }, blinds: { sb: 25, bb: 50 } }, 'buyIn.min');
  eq(r.code, 'range'); eq(r.min, 50); eq(r.have, 1);
});
t('M7: big blind above the max buy-in', () => bad({ ...base, buyIn: { min: 10, max: 100, default: 50 }, blinds: { sb: 500, bb: 1000 } }));
t('M7: min buy-in equal to the big blind is fine', () => ok(validateSettings({ ...base, buyIn: { min: 50, max: 100, default: 50 } }).ok));
t('M7: nine seats are rejected, not clamped', () => { const r = bad({ ...base, seats: 9 }, 'seats'); eq(r.max, 8); eq(r.have, 9); });
t('seats: 2 and 8 accepted, 1 rejected', () => { ok(validateSettings({ ...base, seats: 2 }).ok); ok(validateSettings({ ...base, seats: 8 }).ok); bad({ ...base, seats: 1 }, 'seats'); bad({ ...base, seats: 2.5 }, 'seats'); });
t('blinds: sb >= bb, bb < 2, non integers', () => {
  bad({ ...base, blinds: { sb: 50, bb: 50 } }, 'blinds'); bad({ ...base, blinds: { sb: 1, bb: 1 } }, 'blinds');
  bad({ ...base, blinds: { sb: 0, bb: 2 } }, 'blinds'); bad({ ...base, blinds: { sb: 1.5, bb: 3 } }, 'blinds'); bad({ ...base, blinds: { sb: '25', bb: 50 } }, 'blinds');
});
t('blinds 1/2 with min buy-in 2 is legal', () => ok(validateSettings({ ...base, buyIn: { min: 2, max: 100, default: 20 }, blinds: { sb: 1, bb: 2 } }).ok));
t('buy-in: min above max, default outside, non integer, too big', () => {
  bad({ ...base, buyIn: { min: 5000, max: 1000, default: 2000 } }, 'buyIn.max');
  bad({ ...base, buyIn: { min: 500, max: 1000, default: 2000 } }, 'buyIn.default');
  bad({ ...base, buyIn: { min: 500.5, max: 1000, default: 600 } }, 'buyIn.min');
  bad({ ...base, buyIn: { min: 500, max: 1e9, default: 600 } }, 'buyIn.max');
});
t('buy-in default is derived when missing', () => eq(validateSettings({ ...base, buyIn: { min: 100, max: 1500 } }).value.buyIn, { min: 100, max: 1500, default: 1500 }));
t('name: trimmed, control chars and angle brackets removed, length checked', () => {
  eq(validateSettings({ ...base, name: '  Hi  <b>there ' }).value.name, 'Hi bthere');
  bad({ ...base, name: 'A' }, 'name'); bad({ ...base, name: 'x'.repeat(25) }, 'name'); bad({ ...base, name: 5 }, 'name');
});
t('mode and unit', () => { bad({ ...base, mode: 'gold' }, 'mode'); bad({ ...base, unit: 'cents' }, 'unit'); ok(validateSettings({ ...base, unit: 'chips' }).ok); });
t('timer allowed values only', () => { for (const s of [0, 15, 30, 45, 60]) ok(validateSettings({ ...base, actionTimerSec: s }).ok); bad({ ...base, actionTimerSec: 20 }, 'actionTimerSec'); });
t('rebuyLimit range and boolean options', () => {
  bad({ ...base, rebuyLimit: -1 }, 'rebuyLimit'); bad({ ...base, rebuyLimit: 100 }, 'rebuyLimit'); ok(validateSettings({ ...base, rebuyLimit: 99 }).ok);
  bad({ ...base, rebuys: 'yes' }); bad({ ...base, autoStart: 1 }); bad({ ...base, isPrivate: null });
});
t('blindIncrease validation', () => {
  ok(validateSettings({ ...base, blindIncrease: { enabled: true, everyMin: 10, schedule: 'turbo' } }).ok);
  bad({ ...base, blindIncrease: { enabled: true, everyMin: 7 } }, 'blindIncrease'); bad({ ...base, blindIncrease: { schedule: 'fast' } }, 'blindIncrease'); bad({ ...base, blindIncrease: 3 }, 'blindIncrease');
});
t('non-object input', () => { bad(null); bad('x'); bad([]); bad(undefined); });
t('a patch merged over a stored table revalidates (table_update path)', () => {
  const v = validateSettings(base).value;
  ok(validateSettings({ ...v, ...{ blinds: { sb: 100, bb: 200 } } }).ok);
  bad({ ...v, blinds: { sb: 400, bb: 800 }, buyIn: { min: 500, max: 1000, default: 600 } }, 'buyIn.min');
});
t('genSchedule standard from 25/50', () => {
  const s = genSchedule(25, 50, 'standard');
  eq(s.length, 8); eq(s[0], { sb: 25, bb: 50 }); eq(s[1], { sb: 38, bb: 75 }); eq(s[7].bb, 1000);
  for (let i = 1; i < s.length; i++) ok(s[i].bb > s[i - 1].bb && s[i].sb < s[i].bb, 'level ' + i);
});
t('genSchedule turbo is strictly increasing', () => { const s = genSchedule(10, 20, 'turbo'); for (let i = 1; i < s.length; i++) ok(s[i].bb > s[i - 1].bb); });
t('levelAt: off table stays on level 0', () => eq(levelAt(validateSettings(base).value, 1000, 9e9), { level: 0, maxLevel: 0, sb: 25, bb: 50, enabled: false, nextMs: null }));
t('levelAt: level from blindStartAt', () => {
  const s = validateSettings({ ...base, blindIncrease: { enabled: true, everyMin: 10, schedule: 'standard' } }).value;
  const sched = genSchedule(25, 50, 'standard'), T0 = 1e6, ev = 600000;
  eq(levelAt(s, T0, T0).level, 0); eq(levelAt(s, T0, T0 + ev - 1).level, 0); eq(levelAt(s, T0, T0 + ev).level, 1);
  eq(levelAt(s, T0, T0 + ev - 1).nextMs, 1);
  const l3 = levelAt(s, T0, T0 + 3 * ev + 5);
  eq([l3.level, l3.sb, l3.bb], [3, sched[3].sb, sched[3].bb]); eq(l3.nextMs, ev - 5);
  const top = levelAt(s, T0, T0 + 100 * ev);
  eq(top.level, sched.length - 1); eq(top.nextMs, null);
});
t('levelAt: before the schedule starts (no blindStartAt) is level 0', () => {
  const s = validateSettings({ ...base, blindIncrease: { enabled: true } }).value;
  eq(levelAt(s, null, 5e9).level, 0);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
