# before shots

Re-shoot every state: `flock _scratch/locks/chrome.lock node qa/coldcall-fb1/shots.js <baseUrl> <outDir>` (server needs COLDCALL_TEST=1; add a regex as 4th argument to shoot a subset). Sizes 540x960, 360x740, 1440x900. File: `<state>_<w>x<h>[_chips].jpg`. All URLs below are relative to `<baseUrl>/games/coldcall/index.html`.

Seeds: the driver pins `crypto.getRandomValues(Uint32Array(1))` (init script) so practice rounds are the same on every build with the same engine. Chips mode exists only on `?mock=pull` pages (practice has no wallet): for shots that are not mock pages, the Chips variant opens `mock=pull&state=idle&mode=chips` and presses the real button (#buy, #buy_bonus1, #info). Buy prices in those Chips pages are stubbed (`CC.core.st.server.buyCostX = {call:25, bonus1:100, bonus2:250, hunt:40}`) because a mock page has no server state.

| state | Play $ URL (after `?`) | seed | Chips variant | extra driver step | what it shows |
|---|---|---|---|---|---|
| idle | `?shot=idle` | - | no | +900 ms | Practice, Play $, nothing pressed: the empty board, no leads strip (practice has no pull state) |
| dead | `?shot=spin` | 1 | no | wait CC.dbg.rounds.length>=1 && !st.busy, +900 ms | Practice spin, seed 1: dead spin, settled, 0.9 s after busy clears |
| small_win | `?shot=spin` | 31 | no | same as dead | Practice spin, seed 31: 2x in two cascade steps, settled |
| big_win | `?shot=bigwin` | - | no | +1800 ms | Big-win card (x412, MEGA) held by qa.js, 1.8 s in |
| big_win_spin | `?shot=spin` | 547 | no | wait #tier/.scn/.bigwin, +3500 ms | Practice spin, seed 547: 13.3x big win in two steps, 3.5 s after the card element shows (count-up finished) |
| keypad | `?shot=spin&force=bonus1` | 1 | no | wait .dial, +1200 ms | Practice force=bonus1 seed 1: the bonus intro dial (the slot the keypad replaces), 1.2 s after .dial exists |
| pick | `?mock=pull&nosplash&state=pick&mode=play` | - | `?mock=pull&nosplash&state=pick&mode=chips` | +1500 ms (countdown running) | PICK YOUR LEAD with the countdown running (bonus HUD up) |
| more | `?mock=pull&nosplash&state=more&mode=play` | - | `?mock=pull&nosplash&state=more&mode=chips` | +1500 ms | ONE MORE CALL prompt |
| buy_menu | `?shot=buy` | - | `?mock=pull&nosplash&state=idle&mode=chips` | practice: shot=buy opens it. chips: stub prices, in-page click #buy. +1500 ms | Buy-bonus menu, 1.5 s after open (fade finished) |
| buy_confirm | `?shot=buy&step=confirm` | - | `?mock=pull&nosplash&state=idle&mode=chips` | chips: stub prices, click #buy, +500 ms, click #buy_bonus1, +1500 ms | Buy confirm step (DIALING FOR DOLLARS), 1.5 s after open |
| info | `?shot=info` | - | `?mock=pull&nosplash&state=idle&mode=chips` | chips: in-page click #info, +1200 ms | Info modal (top of the scroll) |
| bonus_mid | `?shot=spin&force=bonus1` | 1 | no | wait .dial, +800 ms, dial._finish(), wait #bhLeft in 1..4, +250 ms | Practice force=bonus1 seed 1: free spins running, first frame with 4 or fewer spins left |
| hot_leads | `?mock=pull&nosplash&state=idle&mode=play` | - | `?mock=pull&nosplash&state=idle&mode=chips` | +1200 ms | Leads strip with a count (312 / 450, 8 leads + 4 warm go cold in 3 h 12 m), 4 warm leads lit, ribbon feed line |
| callback | `?mock=pull&nosplash&state=callback&mode=play` | - | `?mock=pull&nosplash&state=callback&mode=chips` | +1200 ms | Leads strip FULL (Callback armed) |
| gain | `?mock=pull&nosplash&state=gain&mode=play` | - | `?mock=pull&nosplash&state=gain&mode=chips` | +1200 ms | +N LEADS banner (3120 -> 3245, 12 filled): mock idle, then leadGain called with CC.core.wait parked so it stays up |
| ghost | `?mock=pull&nosplash&state=ghost&mode=play` | - | `?mock=pull&nosplash&state=ghost&mode=chips` | +1200 ms | Dead spin that lit three leads (script reveals) |
| pot | `?mock=pull&nosplash&state=pot&mode=play` | - | `?mock=pull&nosplash&state=pot&mode=chips` | +1200 ms | Pot win card |

Mock pages equal driver call `CC.pull.demo(state, mode)` (bet 100 unless `&bet=`). `hot_leads` = `demo('idle')`. Mock pages show Play $ amounts as dollars and Chips as whole chips; the wallet is 100000 either way.

## Files

- big_win_1440x900.jpg
- big_win_360x740.jpg
- big_win_540x960.jpg
- big_win_spin_1440x900.jpg
- big_win_spin_360x740.jpg
- big_win_spin_540x960.jpg
- bonus_mid_1440x900.jpg
- bonus_mid_360x740.jpg
- bonus_mid_540x960.jpg
- buy_confirm_1440x900.jpg
- buy_confirm_1440x900_chips.jpg
- buy_confirm_360x740.jpg
- buy_confirm_360x740_chips.jpg
- buy_confirm_540x960.jpg
- buy_confirm_540x960_chips.jpg
- buy_menu_1440x900.jpg
- buy_menu_1440x900_chips.jpg
- buy_menu_360x740.jpg
- buy_menu_360x740_chips.jpg
- buy_menu_540x960.jpg
- buy_menu_540x960_chips.jpg
- callback_1440x900.jpg
- callback_1440x900_chips.jpg
- callback_360x740.jpg
- callback_360x740_chips.jpg
- callback_540x960.jpg
- callback_540x960_chips.jpg
- dead_1440x900.jpg
- dead_360x740.jpg
- dead_540x960.jpg
- gain_1440x900.jpg
- gain_1440x900_chips.jpg
- gain_360x740.jpg
- gain_360x740_chips.jpg
- gain_540x960.jpg
- gain_540x960_chips.jpg
- ghost_1440x900.jpg
- ghost_1440x900_chips.jpg
- ghost_360x740.jpg
- ghost_360x740_chips.jpg
- ghost_540x960.jpg
- ghost_540x960_chips.jpg
- hot_leads_1440x900.jpg
- hot_leads_1440x900_chips.jpg
- hot_leads_360x740.jpg
- hot_leads_360x740_chips.jpg
- hot_leads_540x960.jpg
- hot_leads_540x960_chips.jpg
- idle_1440x900.jpg
- idle_360x740.jpg
- idle_540x960.jpg
- info_1440x900.jpg
- info_1440x900_chips.jpg
- info_360x740.jpg
- info_360x740_chips.jpg
- info_540x960.jpg
- info_540x960_chips.jpg
- keypad_1440x900.jpg
- keypad_360x740.jpg
- keypad_540x960.jpg
- more_1440x900.jpg
- more_1440x900_chips.jpg
- more_360x740.jpg
- more_360x740_chips.jpg
- more_540x960.jpg
- more_540x960_chips.jpg
- pick_1440x900.jpg
- pick_1440x900_chips.jpg
- pick_360x740.jpg
- pick_360x740_chips.jpg
- pick_540x960.jpg
- pick_540x960_chips.jpg
- pot_1440x900.jpg
- pot_1440x900_chips.jpg
- pot_360x740.jpg
- pot_360x740_chips.jpg
- pot_540x960.jpg
- pot_540x960_chips.jpg
- small_win_1440x900.jpg
- small_win_360x740.jpg
- small_win_540x960.jpg
