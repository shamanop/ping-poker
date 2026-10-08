'use strict';
// A fresh unique op id for one admin money message (Money 1008 K1-2: admin_adjust / admin_set_play are refused without one, code op_required).
// One id per message the harness MEANS to send; the server writes the ledger ref adj:<key>:c.<opId>, so an id used twice is a resend (a dup, nothing written).
// Unique across the whole run, also across server restarts on the same data dir (the ledger keeps old refs).
const RUN = Date.now().toString(36);
let seq = 0;
module.exports = { opId: () => `soak-${RUN}-${++seq}` };
