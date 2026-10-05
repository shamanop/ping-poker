# Bank dashboard notes
- 20:5x server: ledger.js (separate LEDGER_FILE), hooks in server.js, get_bank_summary socket + GET /api/bank-summary?password=ping&room=ID

- client: public/bank.js + bank.css (slide-over opened by Bank chip in top bar / key B), index.html link+script only; zero game.js edits
- harness: qa/bank/capture.py (HANDS env, default 10), PORT 3921, temp bank/ledger files in qa/bank/
- QA done 10/4 21:3x: 1440x900 + 1920x1080 shots (bank-empty/full/hover) viewed; labels + clientlabels tests pass
- Known: net P&L / at-table are live (blinds in the pot show as small negative mid-hand); bots appear as "House" with no bank
- Not pushed, not merged. ledger.json is gitignored.
