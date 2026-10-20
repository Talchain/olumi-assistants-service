BLOCKED

- Progress: S4/S10 producer contract and local cold-reload rung GREEN; Olumi attribution stops at the DGAI reader.
- Next two, highest-value Y: DGAI target-source hook; DL review/CI and integrated served replay.
- Mistake: the first new factor assertion treated a normalised intervention cell as a raw value.
- Correction APPLIED: assert the unchanged raw_value (or unnormalised value) exactly equals 1; all original expectations remain.

BLOCKED-LEASE: `/private/tmp/cx-l25/src/canvas/domain/goalTarget.ts:196` returns `unrecorded` for the preserved `threshold_source: cee_inference`; `/private/tmp/cx-l25/src/canvas/nodes/shared/valueSourceMark.tsx:287` still uses NODE provenance for Olumi attribution. The actual projection preserves the target stamp, but a target Olumi proposes on a user-introduced goal displays unknown. Smallest unblock: the DGAI owner recognises the existing target-specific Olumi stamp in its one target-source reader and consumes that result in the mark. Do not change the goal item's author to manufacture this display. No DGAI files were edited.

Files changed:
- `src/orchestrator-v5/path-b/tools/candidate-to-graph.ts`: host writes threshold_source=user only from the existing whoOf verdict, with success_threshold bound to A's admitted RAW target (the existing UI reader requires this pair); Olumi gets cee_inference; unknown/third-party remain absent. AI-declared two-state units use the existing isTwoStateSource predicate with EMPTY nodes to write the existing factor_type=boolean; no endpoint/label inference and no invented observed_state.
- `src/orchestrator-v5/path-b/tools/__tests__/draft-empty-scenario.route.test.ts`: converter tests through the real POST /agent/v1/turn; preserve existing assertions/negatives and strengthen the exact recorded capacity row with reload assertions. This is a test of the leased converter.
- `recovery-notes/L27-*`: authorised approach, report, local logs/results and reproducible mutation/reader-probe scripts. Reason for these other files: required evidence; the isolated UI probe reads external trees without editing them. Its .probe.ts filename is intentionally outside default test discovery; run it with L27-ui.config.ts to reproduce the BLOCKED reader row.

Read first: OVERNIGHT-PLAN root causes/lanes/merge rules, PLAN-TODAY §4 and STREAMLINED-DELIVERY-RULES. recovery/CLAUDE.md is absent; read §4 from the available CLAUDE.md.pre-streamline-20261012T2239Z, plus repository Docs/CLAUDE.md. This lane's explicit command/lease overrides older gate instructions. Base verified: c8674988c2ce7a072242b0730d0d11e5f7bde653; branch dl/l27-producer-target-source. No commit, push, network/provider call or deployment.

Rows and results (base → final):

| Row | Result |
| --- | --- |
| (a) exact recorded capacity, user target 100 tickets/week | RED → GREEN; user stamp and raw success_threshold=100 survive cold reload; actual DGAI projection/resolver reads user |
| (b) unknown origin | GREEN → GREEN; stamp ABSENT, even with an untrusted raw stamp supplied in the draft |
| (c) Olumi origin | RED → GREEN in CEE/readback with cee_inference, never user; DGAI source reader remains RED/BLOCKED |
| (d) user origin with nonliteral figure | GREEN → GREEN (negative); stamp absent |
| (e) existing A byte-equality row | GREEN; draft-tool.test.ts 26/26, plus core-one-voice route 17/17 |
| (f) declared yes/no, boolean and binary | RED → GREEN; node factor_type=boolean survives cold reload, no observed_state; actual UI reader says In use / Not in use |
| (g) yes/no-sounding label without declared type | GREEN → GREEN; no factor_type, even with a 0/1 option endpoint |
| Extra wrong-unit / neighbouring-subject / unknown-speaker / count negatives | GREEN → GREEN on both target briefs or both factor briefs |

The negative (d), like (b) and (g), was already GREEN on the base; no false RED is claimed. Targets span the recorded capacity and synthetic bookings briefs; factors span bookings and workshop output. The final whole route spec was run against the ORIGINAL source base: 11 failed / 58 passed, then restored source: 69 passed / 0 failed. Detailed log: L27-base-red.log / L27-route-green.log.

Boundary proof and authority:
- This is HOST CONSTRUCTION, not update_node_field/update_edge_field: draft-tool.ts:141 calls candidateToGraph, then :146 registers converted.graph. AI raw threshold_source is ignored; only whoOf's declared-origin/literal/unit/subject verdict mints the stamp. field-safety.ts:87 and :258 retain J2 unchanged; threshold-source-j2.test.ts passes all 12 refusal/negative rows.
- Existing schemas declare threshold_source and success_threshold (cee-v3.ts:327-328), and factor_type (:566); no safety/schema widening.
- Local route rows pass registered bytes through the real GraphStateIngressSchema, projectGraphForPersistence, JSON serialisation, strict GraphV3.parse, a fresh graph-route request and toOutboundGraph. They then read the CEE goal record. Storage/graph transport are route doubles, not a live database or served browser journey; this proves production transformation survival plus local reload.
- Isolated probe uses the ACTUAL DGAI mapDraftNodeToCanvas, resolveGoalTarget, goalTargetSourceMark and L25B servedSwitchReading. User target and boolean display pass. The Olumi target stamp reaches canvas.data unchanged, but the resolver returns unrecorded and mark unknown. L27-ui-probe.log records 2 passed / 1 failed. Nothing strips these fields; the first remaining loss is DGAI target-source interpretation.

Final spec results, sequential, one file per process:

| Spec | Pass / fail / skip |
| --- | --- |
| path-b/tools/__tests__/draft-empty-scenario.route.test.ts | 69 / 0 / 0 |
| path-b/tools/__tests__/candidate-to-graph.test.ts | 81 / 0 / 1 (existing opt-in stored-draft differential) |
| path-b/tools/__tests__/draft-tool.test.ts | 26 / 0 / 0 |
| path-b/tools/__tests__/core-one-voice.route.test.ts | 17 / 0 / 0 |
| tests/contract/context-summary-diagnostic-only.guard.test.ts | 6 / 0 / 0 |
| tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts | 5 / 0 / 0 |
| tests/contract/run-delta-pack-parity.guard.test.ts | 5 / 0 / 0 |
| tests/contract/run-delta-prior-facts-no-default.guard.test.ts | 10 / 0 / 0 |
| tests/contract/tier3-leak-guard.runtime.test.ts | 16 / 0 / 0 |
| tests/contract/tier3-leak-guard.static.guard.test.ts | 3 / 0 / 0 |
| graph-management/__tests__/threshold-source-j2.test.ts | 12 / 0 / 0 |
| recovery-notes/L27-ui.probe.ts (isolated external-reader witness) | 2 / 1 / 0 (BLOCKER above) |

HIGH mutant pairs, all 6 KILLED; source restored and full route rerun GREEN:
- Target stamp: remove both known-source stamps → 4 failed; credit every admitted target to user → 14 failed.
- User target binding: remove success_threshold → 2 failed; bind the normalised value instead of raw → 2 failed.
- Declared factor type: remove factor_type → 6 failed; mark all factors boolean (including untyped/count) → 4 failed.
- Logs and L27-mutants.py / L27-mutants.json reproduce the changes. First four were run with 26 L27-selected rows; last two additionally included the strengthened exact recorded row (27 selected). No protected expectation was weakened.

Checks:
- ESLint on both changed source/test files: exit 0; git diff --check: exit 0.
- Required exact command: NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit -p tsconfig.json. Exit 2, 208 diagnostics across 89 OTHER files. ZERO errors in candidate-to-graph.ts; ZERO errors in draft-empty-scenario.route.test.ts. These other diagnostics are not reclassified as passing or as inherited by this lane. Full log and per-file counts: L27-typecheck.log / L27-typecheck-results.json. CI Typecheck Drift remains required and must be verified by the DL; no CI run was attempted here.
- new-cycles.py /private/tmp/cx-l27 c8674988: head 9 cycles / base 9; NEW/GROWN 0. No new dependency edge (same existing say-figure module).
- tools-dl/pr-shape.sh, unchanged parser on actual local diff via a disposable local gh adapter (no network): source +6/-1 = NET +5 in 1 file; tests +86/-2 in 1 file; fixtures +0/-0; 0 new refusal/reason codes, regex literals, exports or if-lines. The new conditional projections are in existing node writers. Growth reason: carry the existing declared metadata at the missing source projection. The replaced import is the only retired line; there is no competing authority to remove.
- 0 live provider calls; route drafter/agent responses and persistence transport are scripted. No store, writer, parser, prompt/schema field or provider path added. Only the converter's existing host writer is extended.
- Disk: no source/cache/evidence cleanup. Only the disposable shape adapter was automatically removed; no measured space-freed claim (0 bytes claimed).

HIGH trace:
- Source/speaker: recorded user sentence “Goal: weekly support capacity of at least 100 tickets per week.”; AI target_origin=user, statement speaker=user, literal 100 and matching unit. Olumi target row changes only declared target_origin, never the goal item's author.
- User approval: initial model request is replayed through existing build_model_from_brief/create-only registration; no new approval route or approval inference is introduced.
- Persisted readback: threshold_source=user and success_threshold=100, or cee_inference on the Olumi row; factor_type=boolean with no current observed_state for conditional factors.
- This Run used: no analysis Run in these rows; A's existing admitted target/raw/unit and conversion are reused unchanged.
- User saw: local actual UI resolver credits the user and state reader words endpoints; Olumi display remains unknown (BLOCKED), never falsely user. First changed loss = converter metadata omission; first remaining loss = target source reader at goalTarget.ts:196.
- Product test: people can distinguish their target from Olumi's proposal and read declared states without inventing today's facts; end-to-end Olumi attribution is explicitly incomplete.

Buddy (3 lines):
Correct producer/local reload contract; external-reader row honestly BLOCKED. Assumption: declared factor.unit is the AI's state declaration; no unit is recovered from statement wording.
Simpler: existing stamps, user raw binding, factor_type and existing typed-unit predicate only; no new parser, writer/store or OpenAI SDK replacement. SIMPLER-ALTERNATIVE: none within the lease.
Efficient: zero provider calls or extra inference latency; existing AI declarations are carried, not host-parsed for meaning/authorship; SDK runner/Conversation/tracing are unchanged.

Exact commit message: fix(path-b): preserve target source and declared factor type

Plan: L27 · Simplest approach? Y — reuse existing host writer, source stamps and typed-unit predicate; DGAI source hook remains blocked · Net src lines: +5
