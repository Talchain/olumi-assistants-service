# Current2677 Drift failure and bounded correction

Actual CI run37159855500/job111310863844 fails only the new-file test-type set: src/orchestrator/tools/__tests__/encode-option-interventions.test.ts; current101files/291errors versus baseline103files/291errors. Required source lint/typecheck/guards is SUCCESS. Raw job log retained DRIFT-JOB.log. Ratchet emits file names/counts but discards individual compiler diagnostics; the full diagnostic is not claimed observed.

Source trace: the newly added inherited-unit case accesses `before.nodes.find(...).observed_state`. `withReplacement` inferred a union of goal/factor/option objects, and goal has no observed_state. The source-visible cause is this property access on the inferred union. Proposed one-line return annotation `{ nodes: Dict[]; edges: Dict[] }` uses the existing dynamic-record test contract. Assertions, fixture values and production source stay byte-identical.

Local annotation47/47 encoder controls PASS (DRIFT-TEST-FIX.json/log); no local full-tree typecheck/ratchet, baseline expansion or gate waiver. Patch DRIFT-ONE-TEST-FILE.patch SHA25611b39ce85d7e325e8970f63bc6b6ecfd6774177ed70a0335e9c8eff5c4be0b6c. HEAD/remote remain2677b3d9496d9d0c6bd7744f0c8131d37b3f1ac6, patch is uncommitted/unpushed.

Timing/hold: annotation was made before Root's new source-freeze delegation arrived, and no subsequent source edit/commit/push occurs. DL must sequence the one-test-file correction under existing C lease. This is a concrete reviewable fix awaiting that serial decision. Final fresh remote Drift must establish correction; local47 PASS is functional evidence only.

Recovery: inspect CURRENT-STATE.json and actual worktree/head; preserve the one test annotation. Do not reapply pre-refresh stash. Consume DL's explicit sequencing before committing/pushing; no new writer/reviewer or broad gate.
