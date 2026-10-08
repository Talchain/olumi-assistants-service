FIX2c is implemented in `/private/tmp/accel-er-offer-cee` on `dl/event-risk-precondition-offer`. HEAD remains `8223aee150f7db58315cad0ff63ea81f9c954250`. FIX2 and FIX2b's uncommitted changes are retained. No commit, push, deployment, database call or migration was performed.

Every refused precondition option or decline now says exactly, through the existing reply composer:

> Nothing changed: the model changed since these choices were offered. Try again.

It re-shows the current marked hold's choices, or no choices when the current hold is unmarked or absent. It offers no approval card or proposal-fields sidecar on that refused turn. The refusal never writes a graph, creates a stamped replacement, or releases the marker.

The literal DL row exposed an additional defect: an ordinary non-conditional append could preserve the original marked hold and its revision/digest, move the latest row, and then allow the old press. Consent now binds to the durable answer that offered the choices, using its committed row ID. Both option and decline retain that identity through the append floor and existing conditional RPC. Movement before the floor read refuses, as does movement visible at the RPC's comparison. There is no consent retry or unconditional fallback.

A pre-press refusal can record a new answer that carries the authoritative marked hold and current choices. It renews only the offered-answer identity (`offered_turn_id`), preserving the original trigger identity (`turn_id`) for current-revision replay and preserving the hold's operations, revision and digest. The re-shown choices work on retry. A CAS failure still preserves FIX2b's no-inner-consent/no-outer-answer behavior. The floor renews the current same-handle carrier, never a supplied older revision. Refused paths read fresh graph state before rendering; the failure catch also reads fresh state. Recognition of a retired precondition Add's host words selects refusal copy only and confers no authority.

| Validation | Result | Evidence |
| --- | --- | --- |
| Initial ordinary-CAS and changed/retired-hold rows, before any source fix | 8 RED | [Log](/private/tmp/offer-fix2c-evidence/RED-concurrent-and-stale.log) |
| Literal trigger → ordinary non-conditional append preserving the marker → old £59/decline press | 2 RED before fix | [Log](/private/tmp/offer-fix2c-evidence/RED-before-press.log) |
| Concurrent graph-bearing append → current choices on refusal | 2 RED before fresh-read fix | [Log](/private/tmp/offer-fix2c-evidence/RED-current-graph.log) |
| Complete chat seam | 91 passed | [Final log](/private/tmp/offer-fix2c-evidence/GREEN-required-final.log) |
| Complete conditional-answer-store | 25 passed | [Final log](/private/tmp/offer-fix2c-evidence/GREEN-required-final.log) |
| Reply-composer-last-writer and widening seam | 24 passed before the final fresh-read predicate change | [Log](/private/tmp/offer-fix2c-evidence/GREEN-composer-and-widen.log) |
| Extra composer-only recheck after that change | Not run: load gate refused (one-minute load 206.83) | The final change is before the composer; the composer, its call sites, its guard and all code after the composer are unchanged from the passing run |
| Source typecheck and changed-file lint | Passed | [Typecheck](/private/tmp/offer-fix2c-evidence/typecheck-final.log), [lint](/private/tmp/offer-fix2c-evidence/lint-final.log) |
| 12 non-trigger control captures | Byte-identical to FIX2b | [Comparison](/private/tmp/offer-fix2c-evidence/control-comparison.json) |

The 14 new rows cover both option and decline for an ordinary append before the press, between resolution and the floor read, and between the floor read and CAS comparison; both paths for a concurrent graph rename; and both paths for a changed marked hold, unmarked hold or absent hold. They assert exact words, current choices or none, no graph write beyond the concurrent writer's own graph, no risk stamp, no stale approval/card, and no wrong-state consent. The literal pre-press rows also witness original-trigger replay and successful retry through approval. Existing FIX2b missing-capability, missing-RPC and first-CAS-conflict rows remain green. Existing FIX2, six-draw replay and corpus rows are included in the complete chat seam.

The control captures contain exactly 12 projections. Their before/after SHA256 is `e88e2c6e02c27f1aff649b21f6e2e639773fe21dff4ca0903fb0bfc3b2aa5840`.

The incremental source delta is six files:

| File | Change |
| --- | --- |
| `src/routes/agent-v1-turn.ts` (hot) | Offered-answer binding, exact refusal input to the composer, current-only choice presentation, fresh refusal graph read and conditional marked re-offer |
| `src/orchestrator-v5/agent-lane/chat-risk-precondition-choice.ts` | Exact refusal constant, press discriminator, distinct offered-answer identity and current marked re-offer helper |
| `src/orchestrator-v5/persist-graph-write.ts` (hot) | Reject movement from the offered answer before conditional append reconciliation |
| `src/orchestrator-v5/commit.ts` (hot) | Carry option consent's expected row to the existing persistence floor |
| `src/orchestrator-v5/system-events/dispatch.ts` (hot) | Thread the host-owned expected row into held-choice commit metadata |
| `src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts` | RED-first concurrency rows, current graph/replay/retry guards and updated required refusal assertions |

All 3,967 other source files match the initial SHA256 snapshot, including the shared held writer gate, conditional-store implementation/tests, capability/tool adapters, widening producer, reply composer and its last-writer guard. [Manifest](/private/tmp/offer-fix2c-evidence/manifest.json), [incremental patch](/private/tmp/offer-fix2c-evidence/fix2c-source.patch). `git diff --check` passes. Both `git diff --stat b31021623cfb13c43d395e9e0dbf1e6751c4a482 -- supabase/` and `git status --short -- supabase/` are empty.

Before every test invocation, the exact gate `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` passed. Each run used at most two test files, one worker, `--no-file-parallelism`, `--configLoader runner` and `/dev/null` stdin. Attempts rejected by the load gate did not start tests. The initial full rerun exposed seven old-copy assertions; those were updated to the mandated words before the successful complete run. Historical failure logs are retained outside the repository in `/private/tmp/offer-fix2c-evidence/`.

The requested PR-body text is in [RESIDUAL-RACE.md](/private/tmp/accel-er-offer-cee/acceptance-evidence/chat-precondition-offer/FIX2/RESIDUAL-RACE.md). The accepted database residual remains the non-conditional insertion after the SQL comparison and before the conditional delegate's insertion, with transaction-start timestamps and ties. No new migration or stronger transaction guarantee is claimed.

This evidence is local semantic replay through the real HTTP/product seams, with scripted provider responses and mocked storage/RPC execution. It does not witness deployed acceptance or database transaction execution.
