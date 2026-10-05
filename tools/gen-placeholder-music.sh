#!/bin/sh
# Tiny clearly-named placeholder tracks for the synced-radio machinery. Real station audio replaces these.
# Usage: tools/gen-placeholder-music.sh [outdir]  (default public/audio/music)
set -e
OUT="${1:-$(dirname "$0")/../public/audio/music}"
mk() { # station idx slug title durSec f1 f2 trem
  d="$OUT/$1"; mkdir -p "$d"
  ffmpeg -y -v error -f lavfi -i "sine=f=$6:d=$5" -f lavfi -i "sine=f=$7:d=$5" \
    -filter_complex "[0][1]amix=inputs=2,tremolo=f=$8:d=0.6,afade=t=in:d=0.05,afade=t=out:st=$(awk "BEGIN{print $5-0.1}"):d=0.1,volume=0.5" \
    -ac 1 -ar 22050 -b:a 32k "$d/$2-$3.mp3"
}
mk placeholder-a 01 placeholder-tone-a1 Placeholder-A1 20 220 277 2
mk placeholder-a 02 placeholder-tone-a2 Placeholder-A2 17.3 247 311 3
mk placeholder-a 03 placeholder-tone-a3 Placeholder-A3 23 196 247 1.5
mk placeholder-b 01 placeholder-tone-b1 Placeholder-B1 19 330 392 4
mk placeholder-b 02 placeholder-tone-b2 Placeholder-B2 21.5 349 415 5
mk placeholder-b 03 placeholder-tone-b3 Placeholder-B3 16 294 370 2.5
mk placeholder-c 01 placeholder-tone-c1 Placeholder-C1 22 440 523 6
mk placeholder-c 02 placeholder-tone-c2 Placeholder-C2 18 466 554 7
mk placeholder-c 03 placeholder-tone-c3 Placeholder-C3 20.7 392 494 3.5
