#!/usr/bin/env python3
"""Build v42.2b from v42.2a. Targets the three arm-B residuals:
(1) P1b miss: explanation answers stayed prose -> add a worked example of a
    SHAPED explanation answer (paid for by cutting routing examples 1+3, whose
    routing content is duplicated verbatim in HANDLERS' do-not-route list);
(2) mid-sentence mutation gerunds ("adjusting that is...") -> gerunds banned
    anywhere in advice, not just at openings;
(3) question discipline on challenge turns (2-3 '?') -> hard one-question-mark cap.
Plus: widen thin-view scoping for all-factor influence asks (P21 class).
"""
import hashlib, pathlib

WS = pathlib.Path("/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream")
SRC = WS / "candidates/v42.2a.txt"
OUT = WS / "candidates/v42.2b.txt"
text = SRC.read_text()

EDITS = [
("prompt_version: v42.2a-routing",
 "prompt_version: v42.2b-routing"),

# (3) hard question cap
("3. ONE VERIFY QUESTION, only if the answer would change the next step. Compound is fine. Some turns need none.",
 "3. ONE VERIFY QUESTION, only if the answer would change the next step. Compound is fine, but at most one question mark in the whole response, including bullets. Some turns need none."),

# (2) gerunds anywhere in advice
("Phrase such advice as a property of the model (\"X would work better as a constraint\", \"a mediator between the two would capture the delay\"), never opening with \"adding\", \"removing\" or \"I'd suggest\".",
 "Phrase such advice as a property of the model (\"X would work better as a constraint\", \"a mediator between the two would capture the delay\"), never as your own act: no \"adding\", \"removing\", \"adjusting\" or \"changing\" phrasings anywhere in advice, and never \"I'd suggest\". Say \"if X were lower\" rather than \"adjusting X\"."),

# (P21 class) widen thin-view scoping
("Never pad with generic coaching or invented signals. Simulation win figures",
 "Never pad with generic coaching or invented signals. Asked about every factor's influence when only the top drivers are present: say the view covers the strongest drivers, cover those, and offer the analysis detail for the rest. Simulation win figures"),

# (1) worked example of a SHAPED explanation answer
("""</COACHING_WORKED_EXAMPLES>""",
 """WORKED EXAMPLE B. Explanation answer inside a tool call (why an option leads). Same shape and budget as every user-visible answer:

"Offshore leads because your cost assumptions outweigh the quality risk, and the result is stable under most plausible variations.

- **The cost difference is doing the work.** It has the biggest influence on the outcome. Check the vendor quote against a second source, because the lead narrows sharply if real costs run higher.
- **Quality risk is priced low in your model.** If defect costs were to double, the gap halves. A one-week reference check on the vendor's recent delivery would test this cheaply.

Would a modest quality drop change your decision, or is cost the only bar that matters?"
</COACHING_WORKED_EXAMPLES>"""),

# pay for it: cut routing examples 1 and 3 (content duplicated in HANDLERS)
("""EXAMPLE 1: Factor question is explanation, not editing.
User: "What factor most influences my decision?" Context: graph exists, no analysis run.
Text: "Before analysis, I can only speak from the model structure. Design capability has the strongest visible path to your goal, followed by engineering capacity. Running the analysis would show whether those structural links actually drive the result across your options."
[Routing decision, not shown to the user: execute -> explain_from_structure on the goal. A reference to an existing factor without mutation intent is never edit_graph.]

EXAMPLE 2: Ambiguous entity clarifies.""",
 """EXAMPLE: Ambiguous entity clarifies."""),

("""[Routing decision, not shown to the user: clarify with those three options. No action emitted.]

EXAMPLE 3: State query answers from evidence, no handler.
User: "I'm not seeing that update on the factor." Context: recent_changes records Total cost updated from £60,000 to £50,000.
Text: "The update was applied to Total cost: it changed from £60,000 to £50,000. If the analysis still looks unchanged, rerunning it would bring the results in line with the updated model."
[Routing decision, not shown to the user: no tool call. State queries resolve from recent_changes, never edit_graph.]""",
 """[Routing decision, not shown to the user: clarify with those three options. No action emitted.]"""),
]

for old, new in EDITS:
    n = text.count(old)
    assert n == 1, f"anchor not unique (n={n}): {old[:70]!r}"
    text = text.replace(old, new)

assert "—" not in text and "&" not in text
norm = "\n".join(l.rstrip() for l in text.replace("\r\n", "\n").split("\n")).strip()
assert 18500 <= len(norm) <= 22000, f"outside window: {len(norm)}"
OUT.write_text(text)
print(f"v42.2b written: {len(norm)} normalised chars; headroom {22000-len(norm)}; sent_hash {hashlib.sha256(norm.encode()).hexdigest()[:16]}")
