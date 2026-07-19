#!/usr/bin/env python3
"""Build S5-C from s5b.txt — the "B + examples" bundle.
Base input is S5-B (already Sonnet-5-tuned + structural); this layer adds ONLY
technique T4 (demonstrated shape >> described rules; per-shape few-shot):

  T4  Add two worked examples in the SAME <COACHING_WORKED_EXAMPLES> tags/style as
      the existing A/B/C, so the gate's two hardest-to-describe behaviours are
      DEMONSTRATED, not merely described:
        (D) DECLINE-A-NUMBER: a figure the user asks for is not in the current
            view, so the model declines it and describes direction qualitatively
            (honours the NON_NEGOTIABLE "else describe direction in words").
        (E) NEGATIVE science-trigger: a coaching turn where no method trigger is
            present, so the gate stays quiet and the model coaches WITHOUT naming
            a concept. This is the DEFAULT coaching shape, so it is placed LAST
            (recency bias, per the register's T4 line).

Both examples are TERMINOLOGY_MAP compliant: plain language, "influence" /
"vulnerable" / "comes out ahead" phrasing, and NEVER a raw metric token
(sensitivity / robustness / elasticity / EVPI / VOI / fragile-edge) or a raw
decimal score.

s5b.txt has ~0 headroom to the 22,000-char loader window, so the ~1k chars the
two examples cost are paid for by T4-principled compensating cuts: prose that
DESCRIBES a behaviour the new/existing examples now DEMONSTRATE is compressed
(ANALYSIS_STATE thin-view target prose that C+D now show; example A/B wording),
plus a couple of true cross-block duplications. No honesty/rule content is
deleted: never-fabricate, the two-shape rule, SCIENCE_GATING trigger logic incl.
the positive science-duty, the single tool-call constraint, and the
TERMINOLOGY_MAP universal-scope line are all preserved verbatim.

Local test artefact only. NEVER uploaded, NEVER pushed to staging.
"""
import hashlib, pathlib, re, datetime, json
WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
src = (WS / "candidates/s5b.txt").read_text()
assert src.strip(), "s5b.txt missing or empty — cannot build S5-C"

# --- the two new worked examples (lean, same style/tags as A/B/C) -----------
# D matches C's 1-bullet decline shape; E is the default 2-bullet coaching shape.
EX_D = (
"WORKED EXAMPLE D. The exact figure the user asks for is not in this view.\n\n"
"\"I can see the direction, but not the exact figure you want, and I will not invent one. "
"The lower-cost option comes out ahead here; how big that lead is is not shown.\n\n"
"- **Direction is clear, the size is not.** The size of that lead is not in this view. "
"A rerun would surface the exact gap if the size is what decides this for you.\n\n"
"Would the size of the lead change your choice, or is the direction enough?\""
)
EX_E = (
"WORKED EXAMPLE E. A coaching turn with no method triggered: coach well, name no concept (the default).\n\n"
"\"Your model captures the main trade-off; the next gain is a sharper estimate of what each option assumes, not a named technique.\n\n"
"- **The options split on one relationship.** Cost sits at the centre of the comparison, so a firmer estimate there "
"does more than a new factor. Pin that figure to a source you trust.\n"
"- **A downside has no home in the model.** The switching effort the change would cost is not represented; "
"on its own it would make the comparison fairer.\n\n"
"Which of those is easier for you to firm up first?\""
)

EDITS = [
    # --- version tag ---
    ("prompt_version: s5b-routing", "prompt_version: s5c-routing"),

    # --- T4: add example D (decline-a-number) then E (negative trigger = default, LAST) ---
    ("Would knowing the exact target scores change which option you pick?\"\n</COACHING_WORKED_EXAMPLES>",
     "Would knowing the exact target scores change which option you pick?\"\n\n"
     + EX_D + "\n\n" + EX_E + "\n</COACHING_WORKED_EXAMPLES>"),

    # === compensating cuts (T4: trim DESCRIBED prose now DEMONSTRATED; tighten examples) ===

    # C-a: ANALYSIS_STATE thin-view target prose is now demonstrated by examples C + D.
    # Compress the two overlapping win-figure/target sentences and the goal-fit sentence
    # into one pass; every branch is preserved (win figures != target evidence; scored
    # but not in view -> point to goal-fit view; not scored -> say so; never state a
    # target-hit rate unless the exact figure is in view).
    ("Simulation win figures say which option comes out ahead, never whether a target is met, and are never evidence a target is cleared. If goal fit was scored but per-option scores are not in view, say the target was scored from the modelled outcomes and point to the goal-fit view for the scores; if it has not been scored, say so. Never state how often an option meets a target unless that exact figure is in view.",
     "Simulation win figures say which option comes out ahead, never whether a target is met. If goal fit was scored but the per-option scores are not in view, say it was scored from the modelled outcomes and point to the goal-fit view; if it was not scored, say so. Never state how often an option meets a target unless that exact figure is in view."),

    # C-b: Example A bullet 1 — tighten wording (shape and science concept unchanged).
    ("Validate your offshore quality expectations against a reference customer or a paid trial before committing, because if real quality is lower than assumed, the case for offshore weakens sharply.",
     "Validate your quality expectations against a reference customer or paid trial before committing; if real quality is lower than assumed, the case for offshore weakens sharply."),

    # C-c: Example A bullet 2 — tighten.
    ("Check whether your current setup can absorb that overhead, since this is the path most likely to erode the time saving.",
     "Check whether your setup can absorb that overhead, the path most likely to erode the time saving."),

    # C-c2: Example A bullet 3 — tighten (pre-mortem concept unchanged).
    ("imagine offshore has failed in six months, work backwards to the most likely cause, and stress-test that assumption now.",
     "imagine offshore has failed in six months, work back to the likeliest cause, and stress-test it now."),

    # C-g: ANALYSIS_STATE thin-view "top drivers in view" sentence is a special case of the
    # general thin-view rule stated two clauses earlier ("name what this view does not include
    # ... offer the one step that would surface it (rerun, the analysis detail...)") and is now
    # also demonstrated by example D; drop the redundant restatement.
    (" If only the top drivers are in view, say so, cover those, and offer the analysis detail for the rest.",
     ""),

    # C-d: Example B preamble duplicates RUNTIME's "your natural text is the answer and
    # ships verbatim; it follows the COACHING SHAPE and its word budget" — drop the dup.
    ("WORKED EXAMPLE B. Explanation answer (why an option leads). Every answer you write is user-visible and uses this same shape and budget:",
     "WORKED EXAMPLE B. Explanation answer (why an option leads):"),

    # C-e: CONTEXT_PACK "Never mention internal field names or IDs in user-facing text"
    # duplicates RULE 4 (NO INTERNAL LANGUAGE); keep the unique absent-fields duty.
    (" Never mention internal field names or IDs in user-facing text. Never reason over absent fields.",
     " Never reason over absent fields."),

    # C-f: ENTITY_RESOLUTION restates CLARIFY's "2 to 3 choices" (RULE 8 + INTENT +
    # PARAMETERS all carry it); trim the duplicate count here, keep the routing rule.
    ("Multiple plausible: clarify with 2 to 3 choices.", "Multiple plausible: clarify."),

    # C-h: HANDLERS "Preference:" line is a pure summary whose every clause is already
    # a rule elsewhere (lookups->CONVERSE/RULE 6; interpretive->EXPLANATION handlers +
    # the DO NOT ROUTE table; edits->most-specific-handler; state queries->STATE QUERIES
    # para; discussion->INTENT CONVERSE). It adds no unique routing rule, so collapsing
    # it removes duplication (T1) without touching the unique routing few-shots above.
    ("\n\nPreference: lookups answer in text when ContextPack has the value; interpretive questions use explanation handlers; edits use the most specific handler; state queries use recent_changes, no handler; discussion stays converse.\n</HANDLERS>",
     "\n</HANDLERS>"),
]
out = src
for old, new in EDITS:
    assert out.count(old) == 1, f"expected one occurrence: {old[:60]!r} (found {out.count(old)})"
    out = out.replace(old, new)

# --- honesty backstops must survive verbatim ---
for backstop in [
    "never fabricate a number",                     # never-fabricate (top + tail)
    "Choose one shape, SHARP or COACHING",          # two-shape rule
    "If nothing triggers, coach without naming a concept.",  # science gating default
    "withholding a warranted method leaves the coaching weaker",  # positive science duty
    "at most one tool call",                         # single tool-call constraint
    "Apply this map to every sentence of visible text on every turn",  # terminology universal scope
]:
    assert out.count(backstop) >= 1, f"honesty backstop lost: {backstop!r}"
# never-fabricate is restated at top (<NON_NEGOTIABLE>) and tail (<BEFORE_YOU_ANSWER>),
# the two differing only in leading case.
assert out.lower().count("fabricate a number") == 2, "expected never-fabricate at top AND tail"

def norm(t):
    t = re.sub(r"\r\n?", "\n", t)
    return "\n".join(re.sub(r"[ \t]+$", "", l) for l in t.split("\n"))
n = norm(out)
raw, nn = len(out), len(n)
fits = 18500 <= nn <= 22000
assert "—" not in out and "–" not in out and not re.search(r"&(?!amp)", out)
# terminology: no raw metric tokens or 0.xx decimals introduced by the new examples
for tok in ["sensitivity", "robustness", "elasticity", "EVPI", "VOI", "fragile edge"]:
    assert tok not in EX_D and tok not in EX_E, f"metric token leaked into example: {tok}"
assert not re.search(r"\b0\.\d", EX_D + EX_E), "raw decimal leaked into example"

(WS / "candidates/s5c.txt").write_text(out)
h = hashlib.sha256(n.encode()).hexdigest()[:16]
print(f"s5c: raw={raw} normalised={nn} headroom={22000-nn} fits_window={fits} sent_hash={h}")
if not fits:
    print(f"!! OVERFLOW by {nn-22000} chars; EXPECTED_SYSTEM_CHARS_MAX would need >= {nn}")

# --- store: armS5C.json = armH clone with orchestrator row swapped (version 120) ---
store = json.loads((WS / "candidates/stores/armH.json").read_text())
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
store["prompts"]["orchestrator_default"]["versions"] = [{
    "version": 120, "content": out, "createdBy": "local-harness", "createdAt": now,
    "changeNote": "S5-C B+examples candidate (local test, never uploaded)"}]
store["prompts"]["orchestrator_default"]["activeVersion"] = 120
store["prompts"]["orchestrator_default"]["stagingVersion"] = 120
store["lastModified"] = now
(WS / "candidates/stores/armS5C.json").write_text(json.dumps(store, indent=1))
print(f"armS5C.json written: orchestrator v120, hash {h}")
