#!/usr/bin/env python3
"""Build S5-A from v42.2f — the low-risk Sonnet-5-tuned bundle.
Techniques (see sonnet5-research/TECHNIQUE-REGISTER.md):
  T3 countable caps replace the word budget (LIFEBench)
  S3 re-assert concision positively (Sonnet 5 dropped the fixed-verbosity default)
  S4 positive science-duty to counter Sonnet-5 gate over-suppression (biggest risk to our science value)
  S1 explicit universal scope on the terminology map (Sonnet-5 literalism → jargon-leakage de-risk)
  S5 soften the one all-caps behavioural imperative
Net-neutral on the 22,000-char loader window via compensating cuts.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/v42.2f.txt").read_text()

EDITS = [
    ("prompt_version: v42.2f-routing", "prompt_version: s5a-routing"),
    # T3 + S3: countable caps + concision (replaces the unreliable ~130-word budget)
    ("the whole response stays under about 130 words unless the user asks for depth; very short clarifications or simple answers stay concise.",
     "cap at three insight bullets, each at most two sentences, headline at most fifteen words; skip non-essential context; very short clarifications stay concise."),
    # S1: explicit universal scope (Sonnet-5 literalism)
    ("Visible responses use plain language; precise terminology and raw values belong only in expandable or methodology content rendered deterministically.",
     "Visible responses use plain language; precise terminology and raw values belong only in expandable or methodology content rendered deterministically. Apply this map to every sentence of visible text on every turn, not only the first mention."),
    # S4: positive duty to surface a warranted method (counters Sonnet-5 gate over-suppression)
    ("If nothing triggers, coach without naming a concept.",
     "If a listed trigger is present, name its matching move plainly; withholding a warranted method leaves the coaching weaker than the moment deserves. If nothing triggers, coach without naming a concept."),
    # S5: soften the one all-caps behavioural imperative (Sonnet-5 is more literal/agentic)
    ("NEVER write routing syntax, handler ids, intent_class, coaching_mode, parameter blocks,",
     "Do not write routing syntax, handler ids, intent_class, coaching_mode, parameter blocks,"),
    # Compensating cuts (redundant with rules stated elsewhere):
    (" Values obviously outside the factor's scale: clarify.", ""),  # PARAMETERS — dup of clarify-over-guess
    (" observation without action is incomplete.", ""),  # RESPONSE_DISCIPLINE — restated by "pair every risk"
    (' Compound is fine, but at most one question mark in the whole response, including bullets.',
     ' At most one question mark in the whole response.'),  # tighten
    (" Do not report element counts unless asked.", ""),  # STYLE — dup of the RULES no-counts
    (", multiple coaching questions", ""),  # Avoid list — dup of the one-question-mark cap
    (" Some turns need none.", ""),  # ONE VERIFY QUESTION — dup of "only if the answer would change the next step"
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
(WS / "candidates/s5a.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"s5a: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# store: armS5A.json = armH clone with orchestrator row swapped (version 118)
store = json.loads((WS / "candidates/stores/armH.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 118, "content": out, "createdBy": "local-harness", "createdAt": now,
    "changeNote": "S5-A Sonnet-5-tuned candidate (local test, never uploaded)"}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 118
store["prompts"]["orchestrator_default"]["stagingVersion"] = 118
store["lastModified"] = now
(WS / "candidates/stores/armS5A.json").write_text(json.dumps(store, indent=1))
print(f"armS5A.json written: orchestrator v118, hash {h}")
