# Golden-Journey Harness v1 — concrete-mutation rerun + interpretation correction

Companion to `golden-journey-v1-staging-baseline.md`. Disambiguates the A3
(durable-state-changed) failure that the first live baseline reported.

## Interpretation — corrected

- **The deterministic replay (`golden-journey-v1-report.md`) is NOT product evidence.**
  It runs the classifier over a synthetic reference transcript. Its A3 PASS and
  "next: Context management" result prove the **classifier / reporting path** works —
  they say nothing about whether live product mutation works.
- **The first live baseline's A3 FAIL was ambiguous, not a confirmed defect.** The
  mutate step used a deliberately vague instruction ("Edit the model: make _<factor>_
  more important"). The system answered **clarify-first** ("The model is unchanged
  so far. Tell me the specific factor, edge, option, or value to change…") and did not
  mutate — so the analysis-affecting graph hash was unchanged and the back half of the
  journey (rerun → what-changed) was not strongly tested. A no-op on a vague edit may be
  **correct behaviour**, not a bug.

## Concrete-mutation rerun (live, cee-staging build `7479cda`, throwaway scenario, deleted)

Same factor the vague run targeted (budget-match fallback) but a **concrete, resolvable**
instruction — isolating only the vagueness variable.

| step | result |
|------|--------|
| baseline run_analysis | `freshness=fresh`, `current_graph_hash=ed3900a76e5a2bc4`, leader "Hire Two Senior Engineers Locally" +58pp |
| **concrete mutate** — `Set Local Senior Hire Programme to 0.5` | **"Updated Local Senior Hire Programme from 0 to 0.5. This makes the last analysis stale. Re-run analysis…"** → `freshness=stale`, `current_graph_hash=8f7a9c7bc0a60a4b` (**changed**), rerun chip offered |
| rerun run_analysis | `freshness=fresh`, hash `8f7a9c7bc0a60a4b`, leader margin shifted to +60pp |
| what changed | "still leads… lead has widened by about 2 percentage points… now moderately stable" (honest, meaningful) |

Verdict signals: `hash_changed=true`, `mutation_ack=true`, `clarify/no-op=false`,
`freshness baseline=fresh → after-mutate=stale → after-rerun=fresh`.

## Conclusion

**Vague "make X more important" → correct clarify-first no-op; concrete "Set X to 0.5" →
real durable mutation.** The mutation path is functional end-to-end for a concrete
instruction: mutate → stale → rerun → fresh → win-probability shift → honest
"what changed". The concrete run also exercised the A1/A4/A7 hard cases legitimately:

- **A1** — freshness transitioned `fresh → stale → fresh` coherently; staleness was
  acknowledged in prose + a rerun chip (no stale-as-fresh).
- **A4** — the mutate's success claim ("Updated … from 0 to 0.5") was **true** (hash
  changed) — a legitimate success, not a false one.
- **A7** — the mutate set `freshness=stale` and offered "Run analysis again" — recovery
  affordance visible.

**Component 4 (Typed action/mutation) is NOT a confirmed defect.** No fix lane is opened.

## Lane discipline

If future work re-confirms a mutation defect on a concrete, resolvable instruction,
record it as the lead item for the **typed mutation / proposal-spine** workstream,
sequenced **behind** the canonical-state / context lanes under the two-lane rule. The
harness's vague mutate step remains a V4-style-path probe (not typed-path coverage).

## Cleanup

Both throwaway staging scenarios created during these runs were deleted child-first
(facts → turns → scenario), verified 0 rows remaining, no orphans:
`1b5f8d0f-d777-4d4a-90c9-2558933cc995` (5 facts / 7 turns / 1 scenario) and the
concrete-rerun scenario `9763e4ad-1da2-4202-9877-0c44a5b98865` (3 / 5 / 1).
