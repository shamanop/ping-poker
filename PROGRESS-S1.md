step1: accounts.js + auth events + migration + tests/accounts.js done; bankedit.js updated (was stale at HEAD: total semantics).
step2: ledger.js meta/nightSummary/settlePayments/nightsFor/accountNet written (tested via tests/tables.js).
step3 (in progress): tables.js + server.js refactor (payIn/payOut/dropSeat, room fields), tests/tables.js next.
- step3/4 done: tables.js (+tests/tables.js), server.js money abstraction, bust_out/rebuy, modes; full npm test green (labels.test needs temp BANK/LEDGER env or it crawls on a 27MB ledger.json).
