Five pass-1 record sets captured 15 Sep 2026 from FRESH single-turn drafts at the
served staging prompt (`draft_graph_default` v201, sha256 `fab9aa27…`) and the
store-resolved model (`claude-sonnet-4-6`), fidelity asserted in-process before
each draw. EVIDENCE, append-only — never edit them to keep them current.

⚠ HELD IN A SUBDIRECTORY DELIBERATELY. The sweeps in `claim-label-is-a-name.test.ts`
and `misfiled-explanation.test.ts` read the fixtures directory NON-RECURSIVELY and
pin its population (`files.length`, label counts, an exact uncaught-prior list).
Adding these five at the top level moves those numbers — 6→11 files, 41→70 labels,
15→22 priors, and 3→9 uncaught prior labels, the six new ones all legitimate noun
phrases the predicate is CORRECT not to flag. Those are that lane's pinned claims
and re-deriving them blind is how a corpus guard gets quietly broken, so they are
left untouched here.

If the owning lane wants these in its corpus, promote them one level and re-derive
those four numbers deliberately. The substantive claims were checked and hold:
these carry ZERO `cause` spans, so `misfiled-explanation` C1's assertion is
unaffected by their content.

## Added 15 Sep — `live-stated-limit-no-value-2026-09-15.json`

Same provenance and the same append-only rule. It carries the defect the
constraint-correction work exists for: a `constraint`
("keeping monthly churn under 4%") with a `direction` and NO numeric `value`,
which is why the limit reached the graph in 0 of 20 pricing drafts.
