#!/usr/bin/env python3
"""Build v42.2e from v42.2d — the Regime-W fixes found by arm E (first widened-context run):

1. P4 goal-fit provenance vocabulary: the widened pack now carries goal_fit PROVENANCE
   (scored from the modelled outcome distribution) but never values; arm E's T09 converted
   that + win-share into "clears the 15% target ... leading in 97% of simulations".
   Extend the claim-typing rule to the scored-but-values-withheld state.
2. Noun-form rule for the user's own edits: arm E's T13 explanation was invalidated
   (mutation_language_detected) — gerund references to the user's edit ("changing X")
   pattern-match the guard. Teach noun forms.
Paid for by cutting the final routing example (content duplicated in ENTITY_RESOLUTION,
RULES 8 and INTENT_CLASSIFICATION; clarify behaviour live-verified in every arm).
"""
import json, hashlib, pathlib, re, datetime

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2d.txt").read_text()

EDITS = [
    ("prompt_version: v42.2d-routing",
     "prompt_version: v42.2e-routing"),
    # P4: scored-but-values-withheld goal-fit state (Regime W)
    ("Simulation win figures say which option comes out ahead, not whether a target will be met; if no target-scored values are present, say the target has not been scored yet.",
     "Simulation win figures say which option comes out ahead, never whether a target is met, and are never evidence a target is cleared. If goal fit was scored but per-option scores are not in view, say the target was scored from the modelled outcomes and point to the goal-fit view for the scores; if it has not been scored, say so."),
    # Noun forms for the user's own edits
    ('Say "if X were lower" rather than "adjusting X".',
     'Say "if X were lower" rather than "adjusting X", and refer to the user\'s own edits in noun form ("your update to X", "the recent change"), never with -ing verbs.'),
]

out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected exactly one occurrence: {old[:70]}…"
    out = out.replace(old, new)

# Cut the EXAMPLES block (duplicated teaching; keeps the worked examples section intact)
m = re.search(r"\n<EXAMPLES>\n.*?</EXAMPLES>\n?$", out, re.S)
assert m, "EXAMPLES block not found"
out = out[: m.start()] + "\n"

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))

n = norm(out)
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window"
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
assert "<EXAMPLES>" not in out and "COACHING_WORKED_EXAMPLES" in out
(WS / "candidates/v42.2e.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2e: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# armG store = armE store with the orchestrator row swapped to v42.2e as version 116
store = json.loads((WS / "candidates/stores/armE.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 116, "content": out,
    "createdBy": "local-harness", "createdAt": now,
    "changeNote": "A/B arm G under assessment (local file store, never uploaded)",
}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 116
store["prompts"]["orchestrator_default"]["stagingVersion"] = 116
store["lastModified"] = now
(WS / "candidates/stores/armG.json").write_text(json.dumps(store, indent=1))
print(f"armG.json written: orchestrator v116, expected sent prompt_hash {h}")
