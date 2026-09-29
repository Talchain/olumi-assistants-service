#!/usr/bin/env python3
"""Build v42.2g from v42.2f — the answer_text landing (orchestrator priority #1).

Root cause (Sonnet 5): coach/converse turns carry an OPTIONAL top-level
`answer_text` field (added by #380, live on staging) that compose PREFERS and
sanitises through the same guard pipeline; when the model omits it, compose
falls back to the free-form pre-tool orientationText — which Sonnet 5's adaptive
thinking sometimes starves to ZERO length (empty assistant_text, 1/6 coach turns
in the re-flip verify). The served v42.2f RUNTIME explicitly steers coach/converse
to "natural text only, no tool call" and never mentions answer_text.

Fix (prompt-side, this workstream's lane): instruct coach/converse turns to place
the complete user-facing answer in the answer_text field (the robust structured
channel), never relying on pre-tool text. Built on v42.2f (the served, safe
prompt) — NOT on S5-A/S5-B, which round 1 showed regress the confidence-boundary
postcheck. Minimal/surgical: one RUNTIME edit + compensating cuts for the window.
NEVER uploaded; Paul-gated staging_version.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2f.txt").read_text()

EDITS = [
    ("prompt_version: v42.2f-routing", "prompt_version: v42.2g-routing"),
    # THE LANDING — steer coach/converse to the robust answer_text channel.
    ("- converse and coach turns: natural text only, no tool call.",
     "- converse and coach turns: write your complete answer in the answer_text field of the routing tool call, which is what the user reads; never rely on text emitted before the tool call, as it can be dropped."),
    # Compensating cuts (genuine dups, verified in the S5-A build C1-C7):
    (" Do not report element counts unless asked.", ""),          # STYLE — dup of the RULES no-counts
    (" observation without action is incomplete.", ""),           # RESPONSE_DISCIPLINE — restated by "pair every risk"
    (" Values obviously outside the factor's scale: clarify.", ""), # PARAMETERS — dup of clarify-over-guess
]
out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected one occurrence: {old[:60]!r} (found {out.count(old)})"
    out = out.replace(old, new)

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))
n = norm(out)
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window"
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
# Honesty backstops must survive verbatim:
for marker in ["never preview or invent results", "answer_text", "COACHING SHAPE", "SHARP SHAPE",
               "Never \"Done\" or \"Updated\"", "at most one tool call"]:
    assert marker in out, f"backstop/marker missing: {marker!r}"
(WS / "candidates/v42.2g.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2g: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# store: armV422g.json = armH clone (v42.2f base) with orchestrator row swapped (version 121)
store = json.loads((WS / "candidates/stores/armH.json").read_text())
now = datetime.datetime(2026, 7, 8, 23, 30, 0, tzinfo=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 121, "content": out, "createdBy": "local-harness", "createdAt": now,
    "changeNote": "v42.2g answer_text landing (local test, never uploaded)"}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 121
store["prompts"]["orchestrator_default"]["stagingVersion"] = 121
store["lastModified"] = now
(WS / "candidates/stores/armV422g.json").write_text(json.dumps(store, indent=1))
print(f"armV422g.json written: orchestrator v121, hash {h}")
