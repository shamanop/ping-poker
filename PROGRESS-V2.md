# The Ping v2 core: progress

Branch `v2-core` off origin/master 9440541 (live). Owner: Frank. Contracts: `V2-DESIGN.md`. Bugs from playtests: `QA-FRANK.md`.
Never push or merge `master`.

## HAND-OFF TO ISABELLE, 2026-10-06 19:50 (Chris, topic 10, 19:32: "send to isabelle to push ui")

**Merge `v2-core` into `master` and deploy.** This head = the v2 core rewrite (2d7feab, milestone 5) + `ui-basement` 47e890c (UI wave 1: one button system, panels, text floors, phone and landscape) + `table-looks` 1488813 (seven host-picked table looks). The UI is built on v2 and cannot ship without it; there is no master-based UI branch. Frank does not push master.

- **Before the push (yours).** Dry-run the migration on a copy of the prod volume: `node tools/migrate-v2.js --bank b.json --wallet w.json --stacks s.json --accounts a.json --out money.jsonl --dry-run`, read the report. Frank never had prod data, so this has not been done on real balances.
- **What the deploy does on first boot.** Copies `bank.json`, `wallet.json`, `stacks.json`, `accounts.json` to `<name>.pre-v2`, migrates them into `money.jsonl`, writes `stacks.json` as `{}`. Idempotent by `mig:` ref. No manual step on Railway. Boot recovery closes open tables and returns seats to the bank: push when nobody is mid-hand.
- **Rollback.** v2 mirrors balances back into `bank.json` and `wallet.json` after each write burst, so a redeploy of 9440541 reads current balances.
- **Frank's run on this head (2026-10-06 19:40, scratch checkout).** v2 harness 160 of 160 (`node tests/v2/run.js`, 183 s). Unit: money 90, engine 96, tables 128, migrate 27, amountfield 66, money.test 6538, bender 19, bender-livecfg 5, labels and clientlabels pass. e2e on the same merge at 17:25: blinds_typing chips 9/9, play 11/11, chips phone 9/9; looks_drawer 4/4; host_drawer 11/11.
- **One fix in this hand-off commit.** `tests/v2-unit/tables-settings.js` expected the default settings without `look`; table-looks added `look: 'basement'`, so tables ran 127 of 128. Test updated, no code change.
- **NOT in this branch.** Cold Call (stays on its own branches, not ready; it is not on v2 money yet). Your combo-1006 work (radio, login, recap): not merged or tested here. This branch rewrites `server.js` and most of the lobby client, so that merge needs care; Frank has not seen combo-1006 and has not tried it. Painted button art (UI wave 2, waits on Chris's kit pick).
- **Not checked.** Real iOS or Android devices. Prod data. `npm test` as one chain on this box (suites run one by one).
- **Preview.** This build has been on Chris's tailnet preview (port 4800 on Frank's box) since 17:25; he asked for the push after looking at it.
- **Reply path.** Frank cannot reach you (your box refuses his key). Answer through Chris, or call into `agent:main:isabelle`.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Acceptance harness `tests/v2/` (repros 01-23, new N1/N3/Play $ ledger/hand-log tests, fuzz invariant, payload-shape contract), baseline run on 9440541 | done: 150 checks, 150 pass on v2-core 95ad5e7 |
| 1 | `money/` ledger + `tools/migrate-v2.js` | merged, 90/90 |
| 2 | `engine/` pure poker + unit tests | merged, 96/96 |
| 3 | `tables/` + `transport/`, legacy path deleted | merged 2026-10-06 07:07 (30adcba) |
| 4 | Client: AmountInput, legalActions controls, UI fixes | merged 2026-10-06 05:50 (edc52cd) |
| 5 | Playtest sweep, fix loop | done 2026-10-06 09:56: 8 defects (Q01-Q08, none S1), all fixed; see `QA-FRANK.md` |

## Log

- 2026-10-06 02:40 Branch cut, contracts written. `socket.io-client` added as a devDependency for the socket tests. The audit's rigged server copy (`src/` with `__rig`/`__audit`) was not shipped with the briefs, so the harness rebuilds it as a patch on a 9440541 worktree.
- 2026-10-06 02:55 Phases 1 and 2 merged into v2-core. `money/` ledger + service + migration: 71/71 unit checks. `engine/`: 92/92 (63 rule cases, evaluator differential, 20k-hand property test, old-showdown differential). Not yet wired into the server; that is phase 3.
- 2026-10-06 05:50 Phase 4 merged. Client: AmountInput rewrite, legalActions controls, admin console, bust panel, showdown UI. Unit 90/90 money, 96/96 engine. Client e2e proofs (A-I) done on legacy server; raise box (F) re-run against a v2-tables export.
- 2026-10-06 07:07 Phase 3 merged. `tables/` + `transport/` wired to v2 money + engine, legacy `tables.js` deleted. Unit suites: tables 127/127. SIGTERM/SIGKILL/reconnect/cashout/short-all-in. E1 engine fix (kicked top-bettor alloc) verified seeds 1/7/11. Harness bot fix (check 21 illegal raises) committed f347b20. Full 147-check harness pending (in-flight at this log entry).
- 2026-10-06 09:56 Phase 5 done on 95ad5e7. Sweep found Q01-Q08 (6 S2, 2 S3, no money or stuck-table defect); Q01, Q03-Q08 fixed in wave 1, Q02 (phone layout at 390x844) in wave 2. Full harness 150/150 in 495 s run alone (`tests/v2/results/fixc.json`, not committed); unit: money 90, engine 96, tables 128, amountfield 66, money.test 6538, 0 fails. Not checked: real iOS/Android, landscape phones, 3+ players on a phone, the s10_misc browser half (script stalls), radio/recap/Cold Call (not on this branch). Open for Chris: `/api/bank-summary?password=` is an open read behind the room password; a disconnected seat is cashed out after 2 minutes, between hands only. master untouched at 9440541.

## UI wave 1

Branch `ui-basement`, merged with origin/v2-core 2d7feab. Client only: no art, no server change, every element id kept.

- **What it is.** One component layer, `public/theme.css`, loaded first; every screen sheet (`style.css`, `lobby.css`, `shell.css`, `bank.css`, `admin.css`, `amount.css`, `phone.css`, new `landscape.css`) only lays out. All frames are CSS in wave 1; wave 2 drops painted art in by setting `--frame-*` / `--bw-*` / `--bg-*` variables (slot list and art sizes in `UI-KIT.md`). The old `btn-blue/brass/green/panel.png` are deleted.
- **Merge note.** `lobby.js drawDrawer` keeps the stable-node structure from 2d7feab (the blinds editor and a persistent `.host-body` stay in the document; title, rows around the editor and `.host-foot` are redrawn). Do not go back to `replaceChildren` over the whole drawer.
- **Proof on the merged head.** Unit: money 90/90, engine 96/96, tables 128/128, amountfield 66/66, money.test 6538/0. `tests/v2/30_shapes.js` 42/42. Full v2 harness 150 of 150 (249 s, `--jobs 2`; `tests/v2/results/ui-full.json`, not committed). `blinds_typing.py` chips 9/9, play 11/11, chips phone 9/9 (re-run after the last CSS change).
- **Before/after sheets** in `qa/ui-basement/sheet_<WxH>_p<N>.jpg` (before on top, after below, same states): 1440x900 (2 players), 1280x720, phone 390x844 with 2, 3, 6 and 8 players, landscape 844x390 with 2 and 6. Raw shots (`before/`, `after/`, `ref/`, 33 MB) stay untracked. Re-run: `qa/ui-basement/runset.sh after` (`AUDIT=1 GEOM=1` for the text-size/contrast and geometry audits), then `sheets.py`.
- **Audit result, last run.** Text under 12 px: none at 1440, 1280 and 390x844. Contrast under 4.5:1: none, except `.seat-bubble.k-call.above` on 6 and 8 players at 390 (1 to 2 samples, taken mid fade-in of the 2.6 s bubble animation, so likely a measurement artefact; not verified by eye). Landscape 844x390 6 players: clean after the final fix.
- **What was not checked.** Real iOS or Android devices. Landscape with 3, 8 players. The geom audit still lists below-the-fold controls in scrolling screens (create, profile, seat, settle) as "offscreen"; they scroll into view, that is expected. Seat plates overlap the board cards on 6 and 8 player phone layouts in the geom audit (same as before the wave). The table felt art, cards and chip piles are unchanged.
- **Open for Chris.** Pick which skin slots get painted art first (primary, secondary, danger buttons and the panel give the most).
