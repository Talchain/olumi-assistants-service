#!/usr/bin/env python3
"""Build v42.2h from v42.2g-caps — grounding-preserving concision.

The bisect convicted the concision edit: v42.2g-caps (v42.2g + countable-caps
only) reintroduced 1 confidence-boundary postcheck degrade (T19 stub,
unsupported_evidence_or_confidence_claim) where served v42.2g had 0. Mechanism:
"skip non-essential context" starves the specific modelled figure the model must
cite when declining/challenging, so the decline reads as unsupported → suppressed.

v42.2h = v42.2g-caps (keeps the tighter countable caps) + the confidence-boundary
rule strengthened so the grounding FIGURE is mandatory even under the cap. Single
conceptual change per round (grounding-preserving concision). NEVER uploaded.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2g-caps.txt").read_text()

EDITS = [
    ("prompt_version: v42.2g-caps-routing", "prompt_version: v42.2h-routing"),
    # Strengthen the confidence-boundary rule: cite the grounding figure, required
    # under the cap. Drop the two inline examples to make room (rule is clear without them).
    ('Never assert evidence strength or certainty ("the evidence is strong", "you can be confident"); describe what the model shows and what would raise confidence. Asked to simply confirm a choice: test it against the model\'s own numbers and name the one check that would settle it, rather than certifying.',
     'Never assert evidence strength or certainty; describe what the model shows and what would raise confidence. Asked to confirm a choice or agree the user is right: cite the specific modelled figure that grounds your answer (win share, target-fit or margin), required even under the cap, then name the one check that would settle it.'),
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
for marker in ["cap at three insight bullets", "answer_text field of the routing tool call",
               "COACHING SHAPE", "SHARP SHAPE", 'Never "Done" or "Updated"', "at most one tool call"]:
    assert marker in out, f"backstop/marker missing: {marker!r}"
print(f"pre-window: normalised={len(n)} headroom={22000-len(n)}")
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window — need a compensating cut"
(WS / "candidates/v42.2h.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2h: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# store: clone the known-good armV422g.json structure (avoids the earlier malformed-store bug)
base = json.loads((WS / "candidates/stores/armV422g.json").read_text())
now = datetime.datetime(2026,7,9,14,0,0,tzinfo=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
o = base["prompts"]["orchestrator_default"]
gv = dict(o["versions"][0]); gv["version"] = 123; gv["content"] = out
gv["changeNote"] = "v42.2h grounding-preserving concision (local test, never uploaded)"
if "createdAt" in gv: gv["createdAt"] = now
o["versions"] = [gv]; o["activeVersion"] = 123; o["stagingVersion"] = 123
base["lastModified"] = now
(WS / "candidates/stores/armV422h.json").write_text(json.dumps(base, indent=1))
print(f"armV422h.json written: orchestrator v123, hash {h}")
