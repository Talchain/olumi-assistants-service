#!/usr/bin/env python3
"""Build v42.2j from v42.2g (the settled served baseline) — explain_* prompt-truth landing.

The active round (concision parked; v42.2g is the served baseline). RUNTIME line 97
tells the model, for the explanation handlers (explain_from_structure/explain_results/
what_would_flip): "your natural text is the answer and ships verbatim". That is FALSE
at runtime: #388 verified turn-executor.ts:5558-5560 forces suppressOrientation=true for
explanation handlers (orientationForCompose=''), so the free-form/natural text is
DISCARDED and only action.explanation.answer_text reaches the user (schema-required, with
a deterministic fallback when the model under-populates it). So a model that follows the
RUNTIME puts its authored answer in the suppressed natural text → the user gets the generic
fallback instead of the model's answer. This landing aligns the prompt-truth to the runtime:
the explanation answer lives in explanation.answer_text. Same shape/discipline as the v42.2g
coach answer_text landing. Single change per round. NEVER uploaded (Paul-gated).
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2g.txt").read_text()

EDITS = [
    ("prompt_version: v42.2g-routing", "prompt_version: v42.2j-routing"),
    ("- explain_from_structure, explain_results, what_would_flip: your natural text is the answer and ships verbatim; it follows the COACHING SHAPE and its word budget. Write a complete grounded answer; the handler may substitute a prerequisite response if a precondition is missing.",
     "- explain_from_structure, explain_results, what_would_flip: put your complete answer in the explanation.answer_text field of the action, what the user reads; text before the tool call is not shown. Follow the COACHING SHAPE. The handler may substitute a prerequisite response if a precondition is missing."),
]
out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected one occurrence: {old[:60]!r} (found {out.count(old)})"
    out = out.replace(old, new)

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))
n = norm(out)
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
for marker in ["answer_text field of the routing tool call", "explanation.answer_text field of the action",
               "COACHING SHAPE", "SHARP SHAPE", 'Never "Done" or "Updated"', "at most one tool call",
               "about 130 words"]:  # 130-word budget = v42.2g concision (NOT the parked countable-caps)
    assert marker in out, f"backstop/marker missing: {marker!r}"
print(f"pre-window: normalised={len(n)} headroom={22000-len(n)}")
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window — need a compensating cut"
(WS / "candidates/v42.2j.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2j: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

base = json.loads((WS / "candidates/stores/armV422g.json").read_text())
now = datetime.datetime(2026,7,9,15,45,0,tzinfo=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
o = base["prompts"]["orchestrator_default"]
gv = dict(o["versions"][0]); gv["version"] = 124; gv["content"] = out
gv["changeNote"] = "v42.2j explain_* answer_text prompt-truth landing (local test, never uploaded)"
if "createdAt" in gv: gv["createdAt"] = now
o["versions"] = [gv]; o["activeVersion"] = 124; o["stagingVersion"] = 124
base["lastModified"] = now
(WS / "candidates/stores/armV422j.json").write_text(json.dumps(base, indent=1))
print(f"armV422j.json written: orchestrator v124, hash {h}")
