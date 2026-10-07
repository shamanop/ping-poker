#!/bin/bash
# P6 w3b: the six legs, one after the other (each leg takes the chrome flock itself). qa/p6-w3b/run_all.sh <export> <tag> [firstPort=4780]
# Leg names carry the tag, e.g. 166beca-540-play. Prints one PASS/FAIL line per leg.
HERE="$(cd "$(dirname "$0")" && pwd)"; EXPORT="$1"; TAG="$2"; P="${3:-4780}"
i=0
for spec in "540x960 play" "540x960 chips" "1440x900 play" "1440x900 chips" "360x740 play docked" "360x740 chips docked"; do
  set -- $spec; vp="$1"; mode="$2"; dock="${3:-}"; name="$TAG-${vp%%x*}${dock:+d}-$mode"
  "$HERE/run_leg.sh" "$EXPORT" $((P + i)) "$name" "$vp" "$mode" $dock | tail -2; i=$((i + 1))
done
echo "all legs done for $TAG"
