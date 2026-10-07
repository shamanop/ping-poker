# FB1 child rules (every builder reads this and cold-call/FB1-BRIEF.md in full)

Worktree: /home/frank/.openclaw/workspace/projects/ping-coldcall-fb1, branch coldcall-fb1. Work only there. Never push, never touch other branches/worktrees, nothing deploys.
- Your files: public/games/coldcall/{game.js,bonus.js,board.js,pull.js,pull.css,style.css,index.html,hero.js,fx.js,captions.js,assets.js,boot.js,phone.js} (+ new files you add beside them), public/games/coldcall/assets/**, cold-call/art/**, qa/coldcall-fb1/**. NEVER: games/**, public/games/coldcall/engine.js, server.js, tests/**, pay knobs. Keep edits to game.js small and local (no reformatting, no moving code): two sibling branches edit it too.
- Stamp `(chris 10-06 FBn)` next to each constant/rule/CSS block you change for a note.
- Git: never `git add -A`, `commit -a`, `stash`. Stage named paths, `git show --stat` after. Commit with `git -c user.name=Frank -c user.email=frank@localhost commit ...`; end the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Other children commit in this same worktree at the same time: stage and commit ONLY your own paths, retry on index.lock.
- Ports 4650-4654 only. 4650 = BASELINE server (export of f20c3ff, do not stop it, do not edit its files). Start your own on 4651-4654 from the live worktree (`PORT=4652 BANK_FILE=_scratch/<you>/bank.json LEDGER_FILE=_scratch/<you>/ledger.json COLDCALL_TEST=1 node server.js`), kill it when done.
- Disk is at 98% (13 GB free): scratch only under _scratch/ (ignored), never /tmp for anything big, delete what you do not need. No new worktrees.
- Chromium: ONE local headless Chromium at a time across all children. Wrap every local capture run: `flock _scratch/locks/chrome.lock node ...`. Software GL: good for clicks/screenshots, useless for frame timing (that runs on shaman). Timing clicks go in-page: `document.getElementById('spin').click()` (Playwright page.click adds ~7 s). Prompts ignore taps for 600 ms (wait for `CC.pull.armed()` or 700 ms), do not remove that.
- Drivers live in qa/coldcall-v2/capture/ (qalib.js launch(w,h), flow.js with CCPORT, f1_*.js, real.js hard-wired to 4640: copy and re-point, never run the original). New drivers go in qa/coldcall-fb1/.
- Never animate a number the server did not send. No engine/rule/pay changes.
- Free premade first for anything that is not GPT art.
- No emojis. Report in plain words with numbers. Final message: what you did, commit hashes, file paths of evidence, what you did not check.
- Do not use Claude Code's built-in Agent tool. You may not spawn children.
