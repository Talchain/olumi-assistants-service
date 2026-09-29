#!/usr/bin/env python3
"""Build v42.2d from v42.2c: implement ruling 6 (D3 chip doctrine) in CHIP_GUIDANCE,
pay for it by trimming the alternative win-probability phrasing (secondary framing only;
the primary rule and the never-list are untouched). Exact-match edits, assert-once each.

Also builds stores/armE.json by cloning armD.json (identical staging-mirror rows,
orchestrator row swapped to v42.2d as version 115) — zero REST calls, byte-parity
with the arm the comparison targets.
"""
import json, hashlib, pathlib, re, datetime

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2c.txt").read_text()

EDITS = [
    # META version stamp
    ("prompt_version: v42.2c-routing",
     "prompt_version: v42.2d-routing"),
    # Ruling 6 / D3: max two chip candidates by default, three only on coaching/explanation turns
    ("When the channel is available, recommend up to three candidates.",
     "When the channel is available, recommend at most two candidates, or three only on a coaching or explanation turn."),
    # Compensating trim: drop the secondary win-probability phrasing option (primary framing + bans intact)
    ('- Win probability: "leads in 69% of simulations" or "comes out ahead in about 7 of 10 scenarios". Never "0.69 probability", "wins" or "win rate".',
     '- Win probability: "leads in 69% of simulations". Never "0.69 probability", "wins" or "win rate".'),
]

out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected exactly one occurrence: {old[:60]}…"
    out = out.replace(old, new)

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))

n = norm(out)
assert 18500 <= len(n) <= 22000, f"size {len(n)} outside loader window"
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
(WS / "candidates/v42.2d.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"v42.2d: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# armE store = armD store with the orchestrator row swapped
store = json.loads((WS / "candidates/stores/armD.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 115, "content": out,
    "createdBy": "local-harness", "createdAt": now,
    "changeNote": "A/B arm E under assessment (local file store, never uploaded)",
}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 115
store["prompts"]["orchestrator_default"]["stagingVersion"] = 115
store["lastModified"] = now
(WS / "candidates/stores/armE.json").write_text(json.dumps(store, indent=1))
print(f"armE.json written: orchestrator v115, expected sent prompt_hash {h}")
