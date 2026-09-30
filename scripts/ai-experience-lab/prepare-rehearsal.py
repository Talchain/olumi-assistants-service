"""Import the owner's pinned adapter output; no science calculation is reimplemented.

Usage: python3 prepare-rehearsal.py /path/to/ef10836/research/sci-evidence-v1
The resulting JSON is a recorded walkthrough, never a live analysis service.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(sys.argv[1]).resolve()
PIN = "ef108360f1c50f1e4af1add589bfb318b1e2928b"
HASHES = {
    "lab/w1_card.py": "23256eac30fdd65ac0b20a4adaaf7c8425f4cbdabdb50bf9c8354e9030549093",
    "src/sci_evidence/card.py": "b829b4c983261c8f62eb8a9ab451632a78650157a95b2fda67bb28250342a388",
    "lab/fixtures/openai-route-coaching-journey.e39f6e0.json": "c5f37961108c272a67db30bbb61fa49e5749a03b9a9d77ee5c266a403a8ef256",
}
for file, expected in HASHES.items():
    if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Pinned Science input changed: {file}")
sys.path.insert(0, str(ROOT))
import lab  # noqa: E402,F401; owner's package adds its src path
from lab.w1_card import card_from_served, still_current  # noqa: E402

capture = json.loads((ROOT / "lab/fixtures/openai-route-coaching-journey.e39f6e0.json").read_text())
turns = [t["json"] for t in capture["turns"]]
cards = {name: card_from_served(turns[i]) for name, i in [("before", 0), ("stale", 4), ("after", 5)]}
currency = {old: {shown: list(still_current(card, current["run_binding"]))
                  for shown, current in cards.items()} for old, card in cards.items()}
assert currency["before"]["before"][0] and currency["after"]["after"][0]
assert not currency["before"]["stale"][0] and not currency["before"]["after"][0]

challenge = next(b for b in turns[0]["blocks"] if b["type"] == "coaching")
patch = next(b for b in turns[4]["blocks"] if b["type"] == "graph_patch")
assert patch["target_id"] == "pro_plan_price"

def state(i, name):
    b = turns[i]
    analysis = next((block for block in b.get("blocks", []) if block["type"] == "analysis_result"), {})
    enrichment = analysis.get("enrichment", {})
    return {
        "graph": b["draft_graph"], "graph_hash": b["graph_hash"],
        "analysis_state": b["analysis_state"], "card": cards[name],
        # Keep the legacy raw rows for provenance, but no threshold claim is licensed without status.
        "threshold_status": enrichment.get("flip_thresholds_status"),
        "threshold_rows": enrichment.get("flip_thresholds", []),
        "recorded_explanation": b["assistant_text"],
    }

output = {
    "mode": "recorded_rehearsal", "adapter_head": PIN, "source_hashes": HASHES,
    "capture": capture["__provenance"],
    "limits": [
        "Recorded scenario from 25 September; buttons replay saved states. No new model calculation or production write.",
        "Evidence wording uses Science's prototype adapter. Scientific doctrine ratification is pending.",
        "For this recorded example the analysis assumes maximising MRR; this is not a user-confirmed preference.",
        "The recorded threshold rows have no governed status. No numerical flip point or no-effect claim is shown.",
    ],
    "challenge": {"title": challenge["title"], "text": challenge["body"],
                  "question": challenge["action_prompt"], "target_refs": challenge["target_refs"],
                  "exploration": turns[3]["assistant_text"], "source": "recorded_coaching_and_C4_reply"},
    "change": {"patch": patch, "receipt": turns[4]["model_version_receipt"],
               "label": "Replay the recorded Pro price update: £49 → £50"},
    "states": {"before": state(0, "before"), "stale": state(4, "stale"), "after": state(5, "after")},
    "card_currentness": currency,
}
destination = Path(__file__).with_name("rehearsal.json")
destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {destination.name}: exact Science adapter, three recorded states; no provider calls")
