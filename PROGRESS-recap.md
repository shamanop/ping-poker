# PROGRESS-recap (night recap port, branch port-recap)

## Done
- Server: recap.js (recorder + payload builder), transport/handlers/recap.js, hooks: registry out.event (recorder.onEvent), hand-flow noteEvents (recorder.onEngine), seat.js show_cards (recap.onShown), transport/index.js HANDLERS, transport/boot.js RECAP_FILE, server.js region + shutdown flush.
- tests/recap.js on the v2 harness (ports 4720-4723): 11 checks pass.
- Unit suites: run-tables 180/180, run-engine 96/96, run-money 568/568.

## Open
- Client (public/recap.js, recap.css) port and browser leg (screenshots in qa/port-recap/).
- Full tests/v2/run.js compare against the lead's baseline.

## HUNKS FOR LEAD
(none yet)

## How to resume
`node tests/recap.js` (needs ports 4720-4723). Dev server: `PORT=4720 DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 node server.js`.
