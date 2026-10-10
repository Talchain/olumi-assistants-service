# Fixture provenance
run1.json and run2.json are verbatim copies of the supplied run{1,2}/seed-manifest.json.
Their known execution Run IDs, computed_at and graph hashes are retained exactly.
expectations.json copies run2's provider-visible licensed chance and driver sentence.
The selected goal id is mrr (both captured graphs; run2 licence goal_node_id).
Numeric DB revision was not captured: 4402 is a SYNTHETIC contract revision, supplied
at the read port with the known selected Run id and goal. Revision probes now use
canonical_analysis_view.v1.staleness (revision, run_revision, run_revision_source).
They prove transport of the canonical read metadata, not that the captured runs
were calculated at DB revision 4402. R1 numeric revision rows are now positive
contract rows: state.scenario_revision is current; analysis.selected_run_revision
and selected_run_revision_source describe the selected occurrence. Selected Run
metadata appears once in the shared analysis carrier, including Explain.
R1 it.fails rows must be migrated to authoritative identity carriers when a product
fix establishes them. The remaining unsupported selected execution-id probe is not product evidence.
withheld: keep run2's raw option chance and driver, add an option-scoped placeholder
withhold for raise_price_to_59 (licence percentages remain as adversarial input). The other option is a control.
unlicensed-driver: keep run2's resolved raw drivers; remove its licence driver map.
raw-probe/current: inject conspicuous raw maps/warning sentinel and one native-scale
flip row (Monthly Pro churn, 3% -> 4.2%). Chance and driver still use captured run2.
stale: the same fixture as current, with one actual edge mean changed by 0.137,
recomputed analysis-affecting hash and complete_stale read verdict. Run hash/time
remain run2's, numeric current revision advances to 4403. Snapshot-port scope:
these tests exercise provider assembly and trusted read verdict consumption, not
real DB latest-Run selection or deriveAnalysisFreshness. Empty storage carriers
reflect prior capture substitutions. No selected persisted fact is fabricated.

## Round 2 additions
P44 verified `withheld` is an adversarial state the current producer cannot create:
`src/orchestrator-v5/tools/handlers/run-analysis.ts:2115` strips the figure before
licensing at `:2855`. Retained as defence-in-depth, not as a staging-producible Run.
`flip-unavailable` preserves the real synthetic 3% -> 4.2% pair but marks its
`flip_thresholds_status` unavailable. `flip-no-pair` removes that pair instead.
`horizon-absent` removes the horizon verdict warning; `leader-withheld` negates the
snapshot leader verdict. Each is contrasted with the unchanged captured run2.
`meaning` seeds one REAL parsed held action (gmh_abcdefabcdef), whose exact label is
“May we retain the assumption that monthly churn stays at 3%?”, and the pro_price
node description “Paul assumes renewal churn stays at 3%; Maya disagrees because
price resistance has not been tested.” The action offers to add a Renewal assumption
factor; the route retains it through the storage pending-action port. Run2's goal
(MRR >= 20000 £/month), all three option ids/labels, Run hash/time and complete_current
verdict remain unchanged. These two qualitative additions are synthetic, not captures.
Monolithic review uses a REAL schema-validated current HandlerFact with captured
Run id/enrichment/graph. The schema has no numeric revision field; its R1 revision
row is a required future carrier, not an invented native field. Its brief plants
S8_REVIEW_POSITIVE, the £20,000 / 12-month goal, captured £49/£59 option labels,
Paul/Maya disagreement and the same open question. Native run1 has no winner and
is skipped by the REAL handler; no provider identity assertion is claimed for it.
Review's seeded question is in the brief, not a held-action carrier: held offers are
NOT COVERED there because the handler input has no pending-action port.
First-construct plants S8_FIRST_CONSTRUCT and the exact brief in
build-first-construct.test.ts. The real route sees an empty new graph; no Run,
option ids, held offers or goal graph exist yet. Its offline tool-call response
requests the real build capability; an empty construction response stops the
pipeline after the captured first construction request. No successful build is claimed.
Server-composed coaching blocks are out of scope: they are not in the provider body.

Round 3: C1 `flip-unavailable` is labelled defence-in-depth, adversarial state:
the CEE ingress accepts
unknown response fields (`src/orchestrator/plot-client.ts:80–103,:891–960`)
and persists them via `run-analysis.ts:3067`; its shadow validation at :1944
does not reject them. This proves admission if PLoT supplies that pair/status,
not that a served PLoT run was observed producing it. Captured run2 has []
with unavailable. The current PLoT emitter is not in this tree; admission does not prove emission.
Unavailable + a nonempty pair is not shown producible by the current producer.
The minimal source-inventory digest is refreshed for the rebased source;
getCanonicalState's opt-in section remains A1 and its fact projection is A3.
Full callable delta/classification is in out/round3-inventory-delta.json and
out/ROUND3-EVIDENCE.md; no new provider transports or assembler owners were added.
Expected-failure witnesses and positive controls run in ordinary beforeAll setup:
a route/transport error fails setup and cannot satisfy an it.fails assertion.
The default ordinary run2 exact-key negative has #2900's checked-in provider
parity SHA fixture and its opt-in one-assembly test as positive controls.
