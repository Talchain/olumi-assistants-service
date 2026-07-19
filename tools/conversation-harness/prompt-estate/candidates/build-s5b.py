#!/usr/bin/env python3
"""Build S5-B from s5a.txt — the "A + structural" bundle.
Base input is S5-A (already Sonnet-5-tuned); this layer adds ONLY:
  T1  Reduce simultaneously-binding constraints per turn (the priority lever).
      One lead instruction states the chosen SHAPE governs which rule block is
      live, so a SHARP turn is not also bound by the COACHING-bullet shape,
      SCIENCE_GATING and the worked examples. TERMINOLOGY_MAP + honesty stay
      universal (never gated off). Redundant restatements are collapsed so the
      net char change is SMALLER, not larger (see cuts C1..C7).
  T2  Non-negotiable rules at TOP and END. The honesty core (never fabricate a
      number; every number comes from a tool result this turn) and the two-shape
      rule are restated once at the very top (<NON_NEGOTIABLE>) and once at the
      very end (<BEFORE_YOU_ANSWER> checklist). One short restatement each; no
      whole block is duplicated (T2 caveat).
Honesty backstops preserved in meaning: never-fabricate, SHARP/COACHING two-shape
spec, SCIENCE_GATING trigger logic incl. S5-A's positive science-duty, the single
tool-call constraint (RUNTIME), and the TERMINOLOGY_MAP universal-scope line.
Net change is char-negative vs s5a.txt via compensating collapses of duplicated
rules; stays inside the 22,000-char loader window.
Local test artefact only. NEVER uploaded, NEVER pushed to staging.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/s5a.txt").read_text()

EDITS = [
    # --- version tag ---
    ("prompt_version: s5a-routing", "prompt_version: s5b-routing"),

    # --- T2 TOP: honesty core + two-shape rule at the very top (compact restatement) ---
    ("</META>\n\n<ROLE>",
     "</META>\n\n<NON_NEGOTIABLE>\n"
     "Every turn, first and last: never fabricate a number, state only numbers a tool returned this turn, else describe direction in words. "
     "Choose one shape, SHARP or COACHING, and let it govern the whole response.\n"
     "</NON_NEGOTIABLE>\n\n<ROLE>"),

    # --- T1: the chosen shape gates which rule block is live ---
    ("Two shapes; choose by turn type.",
     "Two shapes; choose by turn type, and that shape governs which rules are live. "
     "A SHARP turn obeys the RULES, the TERMINOLOGY_MAP and the SHARP shape only; the coaching bullets, SCIENCE_GATING and the worked examples do not bind it. "
     "A COACHING turn adds all three. "
     "Honesty, grounding and the TERMINOLOGY_MAP bind on every turn whatever the shape."),

    # --- T1 collapse: bullet count is capped once (line 39); drop the conflicting "four only when" ---
    ("TWO TO THREE INSIGHT BULLETS by default, four only when the decision genuinely needs it, each",
     "TWO TO THREE INSIGHT BULLETS, each"),

    # --- C1: routing-syntax ban is fully covered by RULE 4 (NO INTERNAL LANGUAGE) ---
    ("Do not write routing syntax, handler ids, intent_class, coaching_mode, parameter blocks, or anything resembling a tool-call schema in the visible response.\n\n",
     ""),

    # --- C2: STYLE glossary duplicates TERMINOLOGY_MAP + RULES + RUNTIME; keep only the unique preferred phrasing ---
    ('Glossary essentials: "leading option", "performs best", "comes out ahead"; never "recommendation" or "recommended" even if the user uses them (say "the strongest option on your numbers"), and never "the winner" or "winning". Never "Done" or "Updated" before confirmation exists. Never internal terms: handler names, tool call, orchestrator, dispatcher, validator or schema terms, raw JSON, action ids, graph hashes, proposal refs, chip metadata, or the words graph, node, edge (say model, factor, relationship, connection).',
     'Preferred phrasing for a "recommendation": "the strongest option on your numbers". Glossary, internal-language and Done/Updated bans are stated in RULES, RUNTIME and the TERMINOLOGY_MAP.'),

    # --- C3: British English + sentence case already in TERMINOLOGY_MAP; keep only the dash-substitute nuance ---
    ('British English. No em dashes, and no double-hyphen or spaced-hyphen substitutes; use a full stop, comma, or "so"/"because". Sentence case.',
     'No em dashes, and no double-hyphen or spaced-hyphen substitutes; use a full stop, comma, or "so"/"because".'),

    # --- C4: "use values exactly as given" duplicates RULE 10 + ANALYSIS_STATE ---
    ("Lead with substance. Prefer display-ready values when provided; otherwise use values exactly as given. Do not convert formats.",
     "Lead with substance; do not convert value formats."),

    # --- C5: CONTINUITY mutation-evidence bullet duplicates RULE 3 ---
    ("- Never claim a mutation happened without evidence (ContextPack, recent_changes, a receipt or confirmation detail).\n",
     ""),

    # --- C6: CONTINUITY state-query bullet duplicates HANDLERS state-query line ---
    ("- \"What changed?\", \"did that apply?\", \"I'm not seeing it\": answer from recent_changes or receipts, never edit_graph.\n",
     ""),

    # --- C7: COACHING risk line duplicates RESPONSE_DISCIPLINE "Pair every risk with what to do about it" ---
    ("\n\nEvery risk you surface includes why it matters and what to do next.\n</COACHING>",
     "\n</COACHING>"),

    # --- T2 END: closing "before you answer" checklist (one short restatement, not a block copy) ---
    ("</CHIP_GUIDANCE>",
     "</CHIP_GUIDANCE>\n\n<BEFORE_YOU_ANSWER>\n"
     "Last check: which shape did you choose, and does the whole response obey it? "
     "Is a trigger present for any method or concept you named? "
     "Does every number come from a tool result this turn? "
     "Never fabricate a number; never name a method whose trigger is absent.\n"
     "</BEFORE_YOU_ANSWER>"),
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
(WS / "candidates/s5b.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"s5b: raw={len(out)} normalised={len(n)} headroom={22000-len(n)} sent_hash={h}")

# store: armS5B.json = armH clone with orchestrator row swapped (version 119)
store = json.loads((WS / "candidates/stores/armH.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 119, "content": out, "createdBy": "local-harness", "createdAt": now,
    "changeNote": "S5-B A+structural candidate (local test, never uploaded)"}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 119
store["prompts"]["orchestrator_default"]["stagingVersion"] = 119
store["lastModified"] = now
(WS / "candidates/stores/armS5B.json").write_text(json.dumps(store, indent=1))
print(f"armS5B.json written: orchestrator v119, hash {h}")
