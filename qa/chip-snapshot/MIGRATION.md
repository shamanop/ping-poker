# Chip history carry-over (live bank -> redesign)

Source of truth: `live-bank-summary-20261005-1155.json` (live /api/bank-summary, 2026-10-05 11:55).
Seed files in the repo: `bank.json` (balances) and `legacy-import.json` (net / hands / biggest win).

## Mapping

| Legacy player | Account key | Chip bank | Legacy net | Hands | Biggest win |
|---|---|---|---|---|---|
| dial-up | dial-up | 9,546 | +7,546 | 121 | 2,636 |
| crip doe | crip doe | 6,454 | +2,454 | 119 | 2,206 |
| CHRIS | chris (admin) | 0 | -8,000 | 95 | 1,578 |
| hr | hr | 0 | -3,000 | 15 | 680 |

How it works at boot:
1. Empty data dir (`DATA_DIR || RAILWAY_VOLUME_MOUNT_PATH || repo dir`): repo `bank.json` is copied in. An existing bank.json is never overwritten.
2. `ledger.seedBank` adds a `bank-start` row per bank key.
3. One `legacy-import` ledger row per player (signed net, hands, biggest win; labelled "Carried over from the original chips bank"). Skipped for any key that already has buyin/rebuy/cashout/legacy-import rows, so restarts and real history are never touched. Applies when `LEGACY_IMPORT_FILE` is set or `BANK_FILE` is not overridden (tests that set BANK_FILE never import).
4. `accounts.migrateLegacy` creates one unclaimed account per key (display name from the import row).

The bank panel shows bank / at-table / net exactly as the snapshot (net = cashed out + at table - buy-ins + legacy net).

## Claiming a name

Open the site, pick "claim existing player", enter the old name (case-insensitive), table password `ping`, and choose a 4-6 digit PIN. First claim wins; the account inherits the chip bank and history by lowercase key. Chris's account is admin and uses the admin claim password if one is configured.

## What each player sees on first login

- The Ping table (chips): their old balance as buy-in bankroll (dial-up 9,546, crip doe 6,454, chris 0, hr 0), and the bank panel with the carried-over net and hand count. In the $ view 1 chip = $1.00.
- Play$ wallet (solo games): fresh default 10,000.00. Ledger$ (friends tables IOU) and the cents leaderboard: start at 0. Chip history is deliberately not mixed into the $ IOU leaderboard; it appears as `netChips` in the profile.
- Chris and hr have 0 chips: Chris can top up via bank edit; hr likewise.

## "Total money" for Reset Table / bank edit

It means the chips-bank total only: sum of every bank balance plus chips on The Ping table. Reset Table sets every chips-bank key to the chosen stack (logged as `adjust` rows) and re-seats players at that stack. Play$ and Ledger$ are not affected.
