# Bank dashboard notes
- 20:5x server: ledger.js (separate LEDGER_FILE), hooks in server.js, get_bank_summary socket + GET /api/bank-summary?password=ping&room=ID

- client: public/bank.js + bank.css (slide-over opened by Bank chip in top bar / key B), index.html link+script only; zero game.js edits
- harness: qa/bank/capture.py (HANDS env, default 10), PORT 3921, temp bank/ledger files in qa/bank/
