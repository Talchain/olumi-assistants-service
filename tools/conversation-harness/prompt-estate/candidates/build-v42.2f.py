#!/usr/bin/env python3
"""Build v42.2f from v42.2e — fix the staging-smoke fabrication finding (T09: model stated
per-option target-meeting frequencies that exist nowhere; the pack carries goal-fit
provenance, never values). Mechanism lesson: this model follows DEMONSTRATED shape, not
described rules — so the goal-fit discipline moves to a worked example, plus an absolute
number ban. Paid for by three prose trims (edge-case teaching, ROLE fat, THIN-block tighten).
"""
import json, hashlib, pathlib, re, datetime

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2e.txt").read_text()

EDITS = [
    ("prompt_version: v42.2e-routing",
     "prompt_version: v42.2f-routing"),
    # Absolute ban appended to the P4 rule (ANALYSIS_STATE THIN block)
    ("If goal fit was scored but per-option scores are not in view, say the target was scored from the modelled outcomes and point to the goal-fit view for the scores; if it has not been scored, say so.",
     "If goal fit was scored but per-option scores are not in view, say the target was scored from the modelled outcomes and point to the goal-fit view for the scores; if it has not been scored, say so. Never state how often an option meets a target unless that exact figure is in view."),
    # Cut 1: sensitivity-named-factor edge case (rare; grounding rules already cover it)
    (' If a factor is literally named with the word sensitivity (such as "Price sensitivity"), rephrase plainly ("how price-responsive your customers are").',
     ""),
    # Cut 2: ROLE trim
    ("You do not replace the user's judgement; you improve how they think, compare options, test assumptions and decide what to do next. ",
     "You do not replace the user's judgement. "),
    # Cut 3: THIN-block P21 sentence tighten
    ("Asked about every factor's influence when only the top drivers are present: say the view covers the strongest drivers, cover those, and offer the analysis detail for the rest.",
     "If only the top drivers are in view, say so, cover those, and offer the analysis detail for the rest."),
    # Cut 4: redundant sentence in STYLE (the NEVER list already covers it; also names an internal term)
    (" Routing is expressed solely through the actual tool call.", ""),
    # Cut 5: mild phrasing preference, not guard-enforced
    ('- A result changing: "a different option comes out ahead". Avoid "flip" as primary phrasing.\n', ""),
    # Worked example C: demonstrate the values-not-in-view target answer
    ('Would a modest quality drop change your decision, or is cost the only bar that matters?"\n</COACHING_WORKED_EXAMPLES>',
     '''Would a modest quality drop change your decision, or is cost the only bar that matters?"

WORKED EXAMPLE C. Target question when per-option target scores are not in view.

"Your target was scored from the modelled outcomes, but the per-option scores are not in this view, so I will not guess them.

- **On win share alone, Offshore leads in 72% of simulations.** That says which option comes out ahead, not whether it clears your 20% saving target. The goal-fit view carries the scored comparison.

Would knowing the exact target scores change which option you pick?"
</COACHING_WORKED_EXAMPLES>'''),
]

out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected exactly one occurrence: {old[:70]}…"
    out = out.replace(old, new)

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))

n = norm(out)
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window"
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
(WS / "candidates/v42.2f.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2f: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# armH store = armG store with the orchestrator row swapped to v42.2f as version 117
store = json.loads((WS / "candidates/stores/armG.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 117, "content": out,
    "createdBy": "local-harness", "createdAt": now,
    "changeNote": "A/B arm H under assessment (local file store, never uploaded)",
}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 117
store["prompts"]["orchestrator_default"]["stagingVersion"] = 117
store["lastModified"] = now
(WS / "candidates/stores/armH.json").write_text(json.dumps(store, indent=1))
print(f"armH.json written: orchestrator v117, expected sent prompt_hash {h}")
