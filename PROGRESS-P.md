P1 copied bender client (3.7M assets) to public/games/bender
P2 bender game.js bridge (init/wallet/spin/result/practice fallback 2s), modebar CSS done
P3 shell.js + shell.css written (registry, windows dock/float/min/max, splitter, wallet bar, bender bridge)
P5 tests/e2e/casino.py written (not run: needs S/L/M). Bridge contract: iframe->shell {hello,spin{reqId,bet,mode,buy},mode,round,esc}; shell->iframe {init,wallet,result{payload.res|round|base,totalWin,balances},error}. Server g:bender:state must reply (balances,bets); g:bender:spin payload {bet,mode,buyBonus:'buy-election'|'buy-landslide'}
