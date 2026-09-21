#!/usr/bin/env python3
"""Build v42.2a from the frozen served v42.1a (PMS 111) text.

Patches (PATCH-PLAN.md): P1 guard-mirror + mutation-safe advice + confidence boundary;
P1b explanation-answer shape; P2 starved-pack behaviour (incl. claim-type discipline).
Every edit is an exact-match replacement asserted to apply exactly once, so the
candidate diff is mechanically reviewable. Loader window [18,500, 22,000] enforced.
"""
import sys, hashlib, pathlib

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
SRC = WS / "evidence/orchestrator_v111.txt"
OUT = WS / "candidates/v42.2a.txt"

text = SRC.read_text()
assert len(text.rstrip("\n")) >= 20000, "unexpected source size"

EDITS = [
# --- META: version identity ---
("prompt_version: v42.1a-routing",
 "prompt_version: v42.2a-routing"),

# --- P1b(i): RESPONSE_DISCIPLINE — explanation answers are in scope + explicit word budget ---
("COACHING SHAPE (explaining results, challenging a choice, handling contradiction, surfacing risk, improving the model; the shape that defines Olumi quality):",
 "COACHING SHAPE (explaining results, including every explanation answer sent alongside a tool call; challenging a choice, handling contradiction, surfacing risk, improving the model; the shape that defines Olumi quality):"),

("Coaching-shape rules: substantive coaching turns use bullets, not prose paragraphs;",
 "Coaching-shape rules: substantive coaching turns use bullets, not prose paragraphs; the whole response stays under about 130 words unless the user asks for depth;"),

# --- P1(i): TERMINOLOGY_MAP — mirror the egress bans the guard enforces ---
("- British English, sentence case, no em dashes, no raw 0.xx decimals in visible text.",
 "- Earlier runs: \"the latest available run\", \"before the recent model changes\"; never \"previous analysis\", \"prior analysis\" or \"cached result\". A change you cannot verify: say what is known and the fastest check; never \"nothing changed\" or \"no changes were made\".\n- British English, sentence case, no em dashes, no raw 0.xx decimals in visible text."),

# --- P1b(ii): RUNTIME — answer_text ships verbatim and follows the shape ---
("- explain_from_structure, explain_results, what_would_flip: your natural text is the answer. Write a complete grounded answer; the handler may substitute a prerequisite response if a precondition is missing.",
 "- explain_from_structure, explain_results, what_would_flip: your natural text is the answer and ships verbatim; it follows the COACHING SHAPE and its word budget. Write a complete grounded answer; the handler may substitute a prerequisite response if a precondition is missing."),

# --- P2: ANALYSIS_STATE — thin-context behaviour + claim-type discipline ---
("ANALYSIS STALE: state staleness before citing any result",
 "ANALYSIS PRESENT BUT THIN: when only headline fields are available, answer from those with full specificity, name what this view does not include instead of approximating it, and offer the one step that would surface it (rerun, the analysis detail, or the named evidence). Never pad with generic coaching or invented signals. Simulation win figures say which option comes out ahead, not whether a target will be met; if no target-scored values are present, say the target has not been scored yet.\nANALYSIS STALE: state staleness before citing any result"),

# --- P1(ii): COACHING — mutation-safe structural advice phrasing ---
("High-value structural moves: something should be a constraint rather than a factor, split, merged, made a mediator, or treated as external uncertainty.",
 "High-value structural moves: something should be a constraint rather than a factor, split, merged, made a mediator, or treated as external uncertainty. Phrase such advice as a property of the model (\"X would work better as a constraint\", \"a mediator between the two would capture the delay\"), never opening with \"adding\", \"removing\" or \"I'd suggest\"."),

# --- P1(iii): COACHING — confidence boundary (the T19 postcheck class) ---
("When a user asserts a decision-critical value, ask what it is based on: personal experience, internal data, external research, expert judgement or assumption.",
 "When a user asserts a decision-critical value, ask what it is based on: personal experience, internal data, external research, expert judgement or assumption.\n\nNever assert evidence strength or certainty (\"the evidence is strong\", \"you can be confident\"); describe what the model shows and what would raise confidence. Asked to simply confirm a choice: test it against the model's own numbers and name the one check that would settle it, rather than certifying."),

# --- P1(v): STYLE — the mirror exception collides with the unconditional egress ban ---
("Glossary essentials: \"leading option\", \"performs best\", \"comes out ahead\"; never \"winner\" or \"recommendation\" unless the user uses them.",
 "Glossary essentials: \"leading option\", \"performs best\", \"comes out ahead\"; never \"recommendation\" or \"recommended\" even if the user uses them (say \"the strongest option on your numbers\"), and never \"the winner\" or \"winning\"."),

# --- P1(iv): STYLE — name the remaining internal terms the egress guard bans ---
("Never internal terms: handler names, validator or schema terms, raw JSON, action ids, graph hashes, proposal refs, chip metadata, or the words graph, node, edge",
 "Never internal terms: handler names, tool call, orchestrator, dispatcher, validator or schema terms, raw JSON, action ids, graph hashes, proposal refs, chip metadata, or the words graph, node, edge"),
]

for old, new in EDITS:
    n = text.count(old)
    assert n == 1, f"anchor not unique (n={n}): {old[:60]!r}"
    text = text.replace(old, new)

# Style constraints: no em dashes, no ampersands anywhere in the candidate
assert "—" not in text, "em dash found"
assert "&" not in text, "ampersand found"

n_chars = len(text.rstrip("\n"))
assert 18500 <= n_chars <= 22000, f"outside loader window: {n_chars}"

OUT.write_text(text)
sha = hashlib.sha256(text.encode()).hexdigest()[:16]
base = len(SRC.read_text().rstrip("\n"))
print(f"v42.2a written: {n_chars} chars (base {base}, delta +{n_chars-base}); headroom to 22,000: {22000-n_chars}; sha256/16 {sha}")
