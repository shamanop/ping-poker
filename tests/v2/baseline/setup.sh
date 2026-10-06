#!/usr/bin/env bash
# Builds the baseline server: a worktree of 9440541 (the live code) next to the repo, with rig.patch applied.
# rig.patch adds ONLY the RIG=1 test hooks (__rig, __audit). With RIG unset the server is identical to 9440541.
# Idempotent: safe to run again, it resets the worktree to the clean commit and re-applies the patch.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DEST="${BASELINE_DIR:-$REPO/../baseline-9440541}"
SHA=9440541
cd "$REPO"
if [ ! -d "$DEST" ]; then
  git worktree add --detach "$DEST" "$SHA" >/dev/null 2>&1
fi
cd "$DEST"
git checkout -q -f --detach "$SHA"
git clean -fdq -e node_modules
[ -e node_modules ] || ln -s "$REPO/node_modules" node_modules
git apply "$HERE/rig.patch"
echo "baseline ready: $(cd "$DEST" && pwd) ($(git rev-parse --short HEAD) + rig.patch)"
