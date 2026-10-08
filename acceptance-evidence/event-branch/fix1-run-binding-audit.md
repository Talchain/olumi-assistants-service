# FIX-1: actual Run binding audit

Decision: use Science's expressly permitted fallback. The case (b) construction sentence ships **without** `so the chance doesn't include this risk yet`. No Run writer, node marker, copied exclusion predicate, or offer chip was added.

This is a source inspection of the existing producer and transports, not a live Run witness. References below were checked in the FIX-1 working tree; the Run files were not edited.

| Point | Verified source | What it carries |
| --- | --- | --- |
| Construction receipt | `src/orchestrator-v5/agent-lane/runtime/build-model.ts:2312–2316` | Maps admission's event-risk loss entries to plain `event_risk_disclosures` strings. The matched drafted figure/refusal belongs to this construction receipt. |
| Automatic first Run caller | `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts:7465–7483` | Calls the first Run with the saved revision, then receives blocks and analysis state and performs a post-Run read. It has the construction receipt but no final sent graph. The saved revision is before Run exclusions. |
| First Run transport | `src/orchestrator-v5/agent-lane/first-analysis.ts:106–116`, `:179–183` | Successful outcome carries `runTurnId`, `blocks`, optional `analysisReady` and `analysisState`; no actual sent graph/input is returned. |
| Run input | `src/orchestrator-v5/tools/handlers/run-analysis.ts:334–364` | Scenario snapshot has graph, options, goal, optional raw saved graph and brief. It has no original candidate probability factor or construction loss/refusal receipt. After removal of that factor, ordinary risk plus brief does not prove that a case (b) draft occurred. |
| Existing exclusion: participation | `src/orchestrator-v5/tools/handlers/run-analysis.ts:792–842`; `run-analysis-participation-guard.ts:217–240` | Uses the guard's graph, with exactly excluded nodes and incident edges removed; existing refusal rules apply before proceeding. |
| Existing exclusion: option precondition | `src/orchestrator-v5/tools/handlers/run-analysis.ts:838–842`; `src/graph/inert-risk.ts:34–51`, `:62–86` | Projects stamped precondition risks using the existing saved-identity predicate. Any incident edge makes a risk ineligible for that exemption. |
| Actual final graph | `src/orchestrator-v5/tools/handlers/run-analysis.ts:1147–1163`, `:1314–1332`, `:1408–1412` | `plotPayload.graph` is assembled after the existing exclusions and wire transforms. The snapshot producer reads that same object; `deps.plotClient.run` sends the same payload. This is the authoritative place to read node/edge presence. |
| Existing snapshot is insufficient here | `src/orchestrator-v5/tools/handlers/run-input-snapshot.ts:252–267`; `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts:1049–1050` | Snapshot links omit an edge without usable endpoints or finite `strength.mean`; the UI `analysis_result` does not transport `input_snapshot`. Consequently a missing snapshot link is not by itself proof of missing incidence in the sent graph, and the construction caller does not have the complete snapshot anyway. |

No existing point holds both the exact case (b) construction receipt and the final graph actually sent for that Run. Re-running the exclusions on the construction graph would create the forbidden second authority; using a saved graph/readback would fail the actual-input requirement. Carrying a new receipt marker or final input across the Run lifecycle would require an additional schema/transport workflow. FIX-1 therefore exercises the fallback rather than asserting an unbound exclusion.

An unexcluded risk that retains an Olumi-sized link is still incident in the final wire graph: the precondition exclusion checks incidence regardless of size/authorship (`inert-risk.ts:42–48`), and `withHeldUserLinks` preserves the link and changes only applicable existence treatment (`run-analysis.ts:1142–1155`). This confirms why rejecting a likelihood alone cannot license the optional clause.

| Requested Science row | FIX-1 result / evidence scope |
| --- | --- |
| Risk absent from actual Run input → clause present | Not implemented under the permitted fallback; the construction sentence carries no exclusion clause. No claim of a passing actual-Run row. |
| Risk has no incident link in actual Run input → clause present | Not implemented under the same fallback; no duplicate exclusion logic was introduced. |
| Risk still in actual Run input with an incident Olumi-sized link → clause absent | Clause is absent, but this is fallback behavior, not evidence of a newly bound actual-Run implementation. |
| Mutant: clause always on → RED | Root's construction-output mutation can append the clause unconditionally and must be killed by exact interim-sentence/no-clause assertions. This verifies the fallback guard; it does not substitute for the absent/present actual-Run rows. Record the executed mutant result in `REPORT-FIX1.md`. |

