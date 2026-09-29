#!/usr/bin/env python3
"""Build v42.2g-caps from v42.2g — the S5-A/B confidence-regression BISECT lead arm.

Round 1 finding: S5-A and S5-B both regressed the coaching-output-postcheck on the
confidence-boundary turns (T19 "just confirm it" / P23 "tell me I'm right") —
`unsupported_evidence_or_confidence_claim` degrades: control/v42.2g 0, S5-A 3, S5-B 2.
v42.2g (served baseline) does NOT degrade. The only S5-A edit suspected of starving the
grounding clause that keeps a confidence refusal evidence-backed is the countable-caps/
concision edit (word budget -> "<=3 bullets, <=2 sentences, <=15-word headline").

This arm ISOLATES that edit: v42.2g + ONLY the concision edit (+ one unrelated dup cut for
the char window). If v42.2g-caps reintroduces the T19/P23 degrades and v42.2g does not, the
concision edit is the culprit -> the fix is a grounding-preserving concision formulation.
LOCAL bisect artifact; NEVER uploaded.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2g.txt").read_text()

EDITS = [
    ("prompt_version: v42.2g-routing", "prompt_version: v42.2g-caps-routing"),
    # THE ISOLATED EDIT — S5-A's T3+S3 countable-caps/concision (verbatim from build-s5a.py):
    ("the whole response stays under about 130 words unless the user asks for depth; very short clarifications or simple answers stay concise.",
     "cap at three insight bullets, each at most two sentences, headline at most fifteen words; skip non-essential context; very short clarifications stay concise."),
    # One unrelated dup cut for the window (dup of the one-question-mark cap; grounding-neutral):
    (", multiple coaching questions", ""),
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
# Backstops + the answer_text landing must survive (only the concision line changed):
for marker in ["answer_text field of the routing tool call", "COACHING SHAPE",
               "Never \"Done\" or \"Updated\"", "never preview or invent results"]:
    assert marker in out, f"marker missing: {marker!r}"
(WS / "candidates/v42.2g-caps.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2g-caps: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

store = json.loads((WS / "candidates/stores/armH.json").read_text())
now = datetime.datetime(2026, 7, 9, 2, 45, 0, tzinfo=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 122, "content": out, "createdBy": "local-harness",
    "changeNote": "v42.2g-caps bisect arm (concision edit isolated; local test, never uploaded)"}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 122
store["prompts"]["orchestrator_default"]["stagingVersion"] = 122
store["lastModified"] = now
(WS / "candidates/stores/armV422gCaps.json").write_text(json.dumps(store, indent=1))
print(f"armV422gCaps.json written: orchestrator v122, hash {h}")
