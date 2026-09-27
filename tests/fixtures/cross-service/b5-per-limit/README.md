# B5 per-limit verdict: Paul's three graphs (served bytes, not authored)

These fixtures back `constraint-verdict-per-limit.test.ts` and `run-analysis-per-limit-verdict.test.ts` (build train B5; AI Quality acceptance rows B5-1…B5-6, `aiq-p2-20260927/ACCEPTANCE-ROWS-R2R3-B5-20260927.md`).

| file | graph | what it is | rung |
|---|---|---|---|
| `17d1cd3a.graph.json` | `ff862af73b3546e3` | Paul's export 17d1cd3a, `payloads.cee_response.draft_graph` (nodes, edges, goal_constraints) and the brief text. Churn's level is `observed_state.source: "cee_inference"` (Olumi's 3 %). | export |
| `17d1cd3a.plot-response.json` | same | The PLoT `/v2/run` response from MG's replay (#70 5856264807): CEE's real egress body sent to PLoT `1f6ad52` → ISL `3717e36`. It matches the export on 281/281 values: churn P = 1 for every option, `scale_provenance {unit_percent, decision_grade: true}`. | EXEC |
| `a6ed1bff.graph.json` | `a6ed1bff40367766` | Paul's scenario a295e4a1 as reloaded (export 90b8f080). Churn is `cee_inference` here too. | export |
| `a6ed1bff.plot-response.json` | same | Staging PLoT `1f6ad52` answering CEE's rebuilt body (MG P2 PROOF). It matches the export on 551/551 leaves. This is BEFORE A3: `constraints_status: "unavailable"` and `CONSTRAINT_TARGET_UNRELIABLE`. | WIRE |
| `0e19bb82.served-turn.json` | `0e19bb826dd6fde4` | Paul's export 08bf9a1f: the draft graph (spend on a derived outcome; churn `user_assumption`), plus the `analysis_result` enrichment AS THE UI RECEIVED IT. That is CEE's egress projection, not the raw PLoT body, so it has no `constraints_status`. ISL's `CONSTRAINT_NOT_CONVERTIBLE` names `nodes[six_month_decision_spend]`. | export |
| `0e19bb82.fixed-pair.V0-served.plot-response.json` | `0e19bb826dd6fde4` | The raw PLoT `/v2/run` body from MG's fixed pair (PLoT #378 B5 engine + ISL B5, run locally) answering CEE's served 0e19bb82 request, copied byte for byte (sha256 `96ccbc9539e5d9733520b108b97c8af56eca789dc64701466973866e1fcb185d`) from `output/olumi-handover-2026-09-25/model-generation/successor-71229dfd/b5-engine-210929/evidence/fixed.V0-served.plot.response.json`. Churn is scored per option under a certified row; spend is withheld and named by the `CONSTRAINT_TARGET_UNRELIABLE` warning ONLY through its `constraint_ids`, and by `joint_withheld {limit_unscored, [spend]}`. | EXEC |

The tests derive every variant (a6ed1bff after A3, 0e19bb82 with a per-limit wire, a user-baselined control, and the fixed pair with one signal removed, flipped or added) with `structuredClone` plus the one change the row names. Each derivation is labelled where it is made. No derived body was captured from an engine.
