'use strict';
// Money hardening 1008, K3-C2: the blind-schedule name is looked up on a plain object, so "constructor" / "__proto__" passed validation
// and such a table threw at every deal. Own-key lookup only.
const fs = require('fs');
const path = require('path');
const { world, quiet, suite, eq, ok, code, ROOT } = require('./lib-money-1008-tables');
const { validateSettings } = require(path.join(ROOT, 'tables/settings'));
const { t, done } = suite(__filename);
const base = { name: 'Sched test', mode: 'chips', buyIn: { min: 100, max: 5000, default: 1000 }, blinds: { sb: 25, bb: 50 }, seats: 3, autoStart: false, actionTimerSec: 30 };

t('names that exist on every object are refused', () => {
  for (const schedule of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '', 'Standard', 7, null, {}]) {
    const r = validateSettings({ ...base, blindIncrease: { enabled: true, everyMin: 15, schedule } });
    eq([String(schedule), r.ok, r.field], [String(schedule), false, 'blindIncrease']);
  }
});
t('standard and turbo still pass; the default is standard', () => {
  for (const schedule of ['standard', 'turbo']) ok(validateSettings({ ...base, blindIncrease: { enabled: true, everyMin: 15, schedule } }).ok);
  eq(validateSettings({ ...base, blindIncrease: { enabled: true } }).value.blindIncrease.schedule, 'standard');
});
t('registry.create refuses it, and a table with a valid schedule deals', () => {
  const W = world({ keys: ['a', 'b'], cash: {} });
  W.service.ensureAccount('a'); W.service.ensureAccount('b');
  eq(code(() => W.registry.create('a', { ...base, blindIncrease: { enabled: true, schedule: 'constructor' } })), 'bad_request');
  const T = W.registry.create('a', { ...base, blindIncrease: { enabled: true, everyMin: 10, schedule: 'turbo' } });
  T.sit('a', { amount: 1000, seat: 0 }); T.sit('b', { amount: 1000, seat: 1 });
  quiet(() => T.startHand()); ok(T.handLive());
});
t('a stored table that carries the bad name is dropped at load, it does not throw at the deal', () => {
  const W = world({ keys: ['a'] });
  const T = W.registry.create('a', { ...base, blindIncrease: { enabled: true, schedule: 'turbo' } });
  quiet(() => W.restart(null, f => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const x of j.tables) if (x.id === T.id) x.blindIncrease.schedule = 'constructor';
    fs.writeFileSync(f, JSON.stringify(j));
  }));
  eq(W.registry.get(T.id), null);
});
done();
