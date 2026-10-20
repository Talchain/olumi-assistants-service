#!/bin/zsh
# pr-shape.sh <repo> <pr> — the SHAPE of a change, for the reviewer's simplicity check (a signal, never a gate).
# Source vs test vs fixture lines, files touched, and what the change ADDS to the estate's complexity: refusal/reason codes,
# regex literals, exported symbols, and whether any source lines were RETIRED. Why (Paul 17 Oct): "too much slop… the
# implementation needs to be truly streamlined and efficient".
set -u
R=${1:?repo}; N=${2:?pr}
D=$(git diff -- src tests) || { echo "could not read diff"; exit 2; }
echo "$D" | awk -v pr=$N '
/^diff --git/ { f=$4; sub(/^b\//,"",f); kind = (f ~ /__tests__|\.test\.|\.spec\./) ? "test" : (f ~ /fixture|\.json$/ ? "fixture" : "source"); files[kind]++ ; next }
/^\+\+\+|^---/ { next }
/^\+/ { add[kind]++; l=$0
        if (kind=="source") {
          if (l ~ /refusal: *'"'"'[a-z_]+'"'"'|reason: *'"'"'[a-z_]+'"'"'|invalid\('"'"'[a-z_]+'"'"'/) codes++
          if (l ~ /\/[^\/ ]+\/[gimsuy]*[.;),]/ && l ~ /\\[sdwb]|\[\^?|\(\?/) regex++
          if (l ~ /^\+export /) exports++
          if (l ~ /^\+ *(if|else if) *\(/) branches++ } next }
/^-/ { del[kind]++; next }
END {
  printf "PR #%s shape\n", pr
  printf "  source   +%d / -%d (net %+d) in %d files\n", add["source"], del["source"], add["source"]-del["source"], files["source"]
  printf "  tests    +%d / -%d in %d files\n", add["test"], del["test"], files["test"]
  printf "  fixtures +%d / -%d in %d files\n", add["fixture"], del["fixture"], files["fixture"]
  printf "  added to the estate: %d refusal/reason codes, %d regex literals, %d exports, %d new if-branches\n", codes, regex, exports, branches
  if (del["source"]==0 && add["source"]>0) print "  RETIRED: nothing (no source line removed) — reviewer: what does this supersede?"
}'
