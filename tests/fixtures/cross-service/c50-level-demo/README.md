# C50 engine-direct captures: REAL PLoT `/v2/run` response envelopes (not authored)

Captured on 25 Sep 2026, 22:58–23:04Z, from PLoT staging `b09c0f2` with ISL `3c4ab84d` (`/version` pinned before and after). Workflow `wf_d479dc68-b35`; #69 5840961137.
- The REQUESTS were authored: small graphs, one goal constraint each, and no `brief`, so there were 0 LLM calls.
- The RESPONSES are the served engine's bytes. `response_body` is copied verbatim, only re-indented.

| file | limit | what PLoT returned |
|---|---|---|
| `U1` | `≤ 10 "percent per month"` on a root with observed 0.07 | threshold clamped to 1.0. `constraint_probabilities {gc_u1: 1}` for both options; `constraint_results[0].scale_provenance {decision_grade:false, threshold_clamped:'high', source:'inferred_value'}`; per-option `constraints_decision_grade:false`; **no** `CONSTRAINT_TARGET_UNRELIABLE`. **The wrong pass.** |
| `U2` | the same limit as `≤ 10 "%"` | 0.9985, `decision_grade:true` (`unit_percent`). Control. |
| `U3b` | a `£` cap against a `£` factor (explicit cap) | 0.981, `decision_grade:true` (`explicit_cap`). Control. |
| `L1` | a level limit on an unpinned root, default range | 0.842 for both options, `decision_grade:false` (`source:'default'`), not clamped. |
