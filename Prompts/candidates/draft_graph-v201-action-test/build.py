#!/usr/bin/env python3
"""
Build draft_graph_default v201 (ACTION TEST) from the committed canonical v195 bytes.

WHY A BUILD SCRIPT AND NOT A HAND-COPIED FILE
---------------------------------------------
The estate's chronic defect is the hand-maintained mirror: a second copy of a
59 KB prompt drifts from its base and nobody notices, because drift reads as
green. So the candidate is DERIVED — three anchored edits applied to the exact
bytes staging serves — and every anchor must match EXACTLY ONCE or the build is
a hard error. A silently no-opped replace (trap 15) cannot pass.

BASE: Prompts/canonical/draft_graph.txt
      sha256 152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f
      = draft_graph_default v195, the version cee-staging served at build time
        (verified against GET /admin/prompts/status content_hash 152998b447819c2e
         and against cee_prompt_versions.content_hash in Supabase).

Usage: python3 Prompts/candidates/draft_graph-v201-action-test/build.py
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
BASE = ROOT / "Prompts" / "canonical" / "draft_graph.txt"
OUT = pathlib.Path(__file__).resolve().parent / "draft_graph_v201.txt"

BASE_SHA256 = "152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f"

# ---------------------------------------------------------------------------
# THE DELTA — three anchored edits, and nothing else.
#
# The defect: a diagnostic brief ("some think the product has fallen behind,
# others think onboarding is the problem, others think we're selling to the
# wrong customers") yields OPTION nodes carrying those labels, each
# provenance=from_brief with the attribution phrase as source_quote. The
# analysis then reports "The Product Has Fallen Behind: 0.12" as though a
# competing explanation were a choice.
#
# The rule is keyed on the SEMANTIC TYPE of the candidate (is it a move you
# could make, or a claim that is true or false), NEVER on the attribution
# phrasing. Keying on attribution would destroy the class of brief where people
# disagree about WHAT TO DO — "some want to relocate engineers, others want to
# hire locally" — which are genuine options. That case is the acceptance pair's
# second arm and is written into the rule as an explicit carve-out.
# ---------------------------------------------------------------------------

DELTA = json.loads((pathlib.Path(__file__).resolve().parent / "delta.json").read_text(encoding="utf-8"))
EDITS = [(e["find"], e["replace"]) for e in DELTA["edits"]]
assert DELTA["base_sha256"] == BASE_SHA256, "delta.json disagrees with build.py on the base hash"


def build() -> str:
    base = BASE.read_text(encoding="utf-8")
    actual = hashlib.sha256(base.encode("utf-8")).hexdigest()
    if actual != BASE_SHA256:
        raise SystemExit(
            f"BASE DRIFTED: {BASE} is {actual}, expected {BASE_SHA256}.\n"
            "The canonical bytes moved. Re-derive the served version from "
            "GET /admin/prompts/status before rebuilding this candidate."
        )
    out = base
    for i, (needle, replacement) in enumerate(EDITS, start=1):
        n = out.count(needle)
        if n != 1:
            raise SystemExit(f"ANCHOR {i} matched {n} times, expected exactly 1: {needle[:60]!r}")
        out = out.replace(needle, replacement)
    if out == base:
        raise SystemExit("BUILD NO-OPPED: output is identical to base")
    return out


if __name__ == "__main__":
    text = build()
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"chars  {len(text)}")
    print(f"sha256 {hashlib.sha256(text.encode('utf-8')).hexdigest()}")
    sys.exit(0)
