# PJ-A2 RED strategic reasoning/work-frame acceptance — 27 September 2026

**Branch:** `codex/pj-a2-reasoning-frame-red` in `Talchain/olumi-assistants-service`; base staging `52a9adf2a70c0cb29bad74b5ad74cb309fe7024b`. Commit SHA is the branch HEAD. Tests and fixtures are reconstructed from the cited briefs and served graph; they are not captured model output. The mid-market brief remains redacted.

**Evidence rung:** TEST. A stubbed model supplies reconstructed candidates; the product executes `buildModelFromBrief` admission, `GraphV3` validation, canonical persistence projection, `/graph/register` dispatch, JSON serialization, and a fresh `getCanonicalState` reader. The dispatch is an in-process register stub, not the database API. Browser cold reload remains pending and must be witnessed on a served owner build. The 12-subscriber control is a deliberately bad model candidate. “Over the next year” is a normalised stub candidate, so this test proves downstream retention, not live language extraction. Q3 tests unresolved wording retention, not a live extractor. Row 22 seeds a known old brief stamp to test the real writer independently of the missing initial stamp. Row 30 is blocked at the missing typed frame; scenario-aware API read/write proof remains pending. No keyword parser was added.

**First wrong boundaries:** the strict producer schema requires a Goal object for goal-free sensemaking (`buildCandidateSchema`); decision framing has no shared typed frame; `admit-model`/`GraphV3` projection drops goal direction and horizon and does not stamp target source; constraint admission relaxes `<` to `<=`; `getCanonicalState` passes an atemporal `0.71` probability through without `horizon_not_modelled`. A horizon-only edit has the same numerical analysis hash but lacks a retained frame revision. An existing `graph_identity_hash` can satisfy the separate currentness contract once the frame is canonical; the RED test demands that observed behaviour and does not change the numerical hash.

**Run command from each checkout:**

```sh
./node_modules/.bin/vitest run src/orchestrator-v5/agent-lane/__tests__/pj-a2-work-frame.red.test.ts --reporter=json --outputFile=/private/tmp/pj-a2-<candidate>-results.json --maxWorkers=2
```

The three isolated Canonical/A7 candidate runs used `--maxWorkers=1`; test and fixture bytes were identical (SHA256 test `438e5ae9c1c11745ac89be80217258ee7b1be51e9cd6b048702add061edcc933`, fixture `4c4bf38d89e33e172aca53d9afef7700fe3cc78f23f0c18ec280e4b0c95ae829`). Expected process exit is 1 while RED.

| Snapshot | Exact source | Pass / total | JSON report |
|---|---|---:|---|
| staging | `52a9adf2a70c0cb29bad74b5ad74cb309fe7024b` | 4 / 30 | `/private/tmp/pj-a2-staging-52a9-results.json` |
| MG question-title | `bank/mg-20260927-question-title-095648` `3d95c7acdd3817d6673cf4360c13693902d7e5c4`; bank `/private/tmp/mg-qtitle-095648`; tested `/private/tmp/pj-a2-qtitle-candidate` | 6 / 30 | `/private/tmp/pj-a2-qtitle-locked-results.json` |
| Canonical #2084 | `fix/value-batch-merge-and-starter-stamps` `42073df8c67ca3c795cbac6055a6bdff784c890e`; tested `/private/tmp/pj-a2-2084.D7TQ8q/repo` | 4 / 30 | `/private/tmp/pj-a2-2084-locked-results.json` |
| Canonical merge-in | local bank `/private/tmp/cs-writer-audit-081518` `c0a012409b2823c14c95128eab3d1a14283594aa`; tested `/private/tmp/pj-a2-mergein.XqVVMI/repo` | 4 / 30 | `/private/tmp/pj-a2-mergein-locked-results.json` |
| A7 | local bank `/private/tmp/cs-a7-not-modelled` `d99616c17c146fa7866bb375f5bd6626c20fc988`; tested `/private/tmp/pj-a2-a7.2Oa45r/repo` | 4 / 30 | `/private/tmp/pj-a2-a7-locked-results.json` |

`G` means the exact row passed; `R` means it failed. The final column is the exact first assertion or error line from staging. The only candidate that newly closes PJ-A2 rows is MG question-title, rows 4–5. Rows 10–11, 22 and 25 were already green on staging. All other candidate snapshots remain red on the same rows; a downstream RED at a failed prerequisite does not independently indict that downstream owner.

| # | Exact assertion row | Staging | MG title | #2084 | merge-in | A7 | First staging failure | Next owner |
|---:|---|:---:|:---:|:---:|:---:|:---:|---|---|
| 1 | the production candidate contract can express a goal-free reasoning task | R | R | R | R | R | AssertionError: strict model schema requires a goal object for a goal-free work task: expected false to be true // Object.is equality | Canonical + MG |
| 2 | pricing-a: original framing is attested in the shared canonical work frame | R | R | R | R | R | AssertionError: pricing-a: no shared typed work frame after canonical reread: expected undefined to be defined | Canonical + MG |
| 3 | midmarket: original framing is attested in the shared canonical work frame | R | R | R | R | R | AssertionError: midmarket: no shared typed work frame after canonical reread: expected undefined to be defined | Canonical + MG |
| 4 | pricing-a: a decision-specific question survives as an attested Decision entity | R | G | R | R | R | AssertionError: pricing-a: strict model schema cannot emit a decision question: expected undefined to be defined | MG |
| 5 | midmarket: a decision-specific question survives as an attested Decision entity | R | G | R | R | R | AssertionError: midmarket: strict model schema cannot emit a decision question: expected undefined to be defined | MG |
| 6 | pricing-a: goal direction remains typed after a fresh read | R | R | R | R | R | AssertionError: pricing-a: no typed direction on the stored goal: expected undefined to be &#x27;&gt;=&#x27; // Object.is equality | MG |
| 7 | midmarket: goal direction remains typed after a fresh read | R | R | R | R | R | AssertionError: midmarket: no typed direction on the stored goal: expected undefined to be &#x27;&gt;=&#x27; // Object.is equality | MG |
| 8 | pricing-a: stated horizon remains typed after a fresh read | R | R | R | R | R | AssertionError: pricing-a: no typed horizon on the stored goal: expected undefined to be 12 // Object.is equality | Canonical + MG |
| 9 | midmarket: stated horizon remains typed after a fresh read | R | R | R | R | R | AssertionError: midmarket: no typed horizon on the stored goal: expected undefined to be 12 // Object.is equality | Canonical + MG |
| 10 | pricing-a: target and baseline remain distinct after reread | G | G | G | G | G | — | already green |
| 11 | midmarket: target and baseline remain distinct after reread | G | G | G | G | G | — | already green |
| 12 | pricing-a: target provenance is bound to the target after reread | R | R | R | R | R | AssertionError: pricing-a: target source lost in canonical projection: expected undefined to be &#x27;brief_extraction&#x27; // Object.is equality | MG + Canonical |
| 13 | midmarket: target provenance is bound to the target after reread | R | R | R | R | R | AssertionError: midmarket: target source lost in canonical projection: expected undefined to be &#x27;brief_extraction&#x27; // Object.is equality | MG + Canonical |
| 14 | Pricing A: under 4% remains a strict bound at the canonical boundary | R | R | R | R | R | AssertionError: exactly 4% must not satisfy “under 4%”: expected &#x27;&lt;=&#x27; to be &#x27;&lt;&#x27; // Object.is equality | Canonical + MG |
| 15 | sensemaking: does not synthesize a Decision node | R | R | R | R | R | Error: activation-sensemaking: real candidate admission rejected the goal-free work fixture: TypeError: Cannot read properties of null (reading &#x27;scope&#x27;) | Canonical + MG |
| 16 | sensemaking: retains the original framing as typed canonical truth | R | R | R | R | R | Error: activation-sensemaking: real candidate admission rejected the goal-free work fixture: TypeError: Cannot read properties of null (reading &#x27;scope&#x27;) | Canonical + MG |
| 17 | sensemaking: does not invent a target or deadline | R | R | R | R | R | Error: activation-sensemaking: real candidate admission rejected the goal-free work fixture: TypeError: Cannot read properties of null (reading &#x27;scope&#x27;) | Canonical + MG |
| 18 | a horizon-only change moves canonical frame currentness while the numerical analysis hash stays fixed | R | R | R | R | R | AssertionError: the canonical write must retain the changed frame: expected undefined to be 6 // Object.is equality | Canonical |
| 19 | a typed retained horizon with atemporal analysis withholds the goal probability | R | R | R | R | R | AssertionError: no atemporal chance may answer a time-bound goal: expected 0.71 to be null | AIQ / Runtime |
| 20 | a frame-only edit refreshes Agent context and recomputes claim permission on the new revision | R | R | R | R | R | AssertionError: new frame must survive serialized canonical write: expected undefined to be 6 // Object.is equality | Canonical → AIQ / Runtime |
| 21 | an unrelated edit cannot erase framing, horizon, direction or provenance | R | R | R | R | R | AssertionError: expected undefined to be 12 // Object.is equality | Canonical |
| 22 | a target edit through the real writer replaces the old brief provenance | G | G | G | G | G | — | already green |
| 23 | a fresh canonical read gives the Agent the current typed frame, not just the original brief | R | R | R | R | R | AssertionError: Agent context has no typed horizon: expected &#x27;{&quot;ok&quot;:true,&quot;scenario_id&quot;:&quot;72727272-72…&#x27; to contain &#x27;goal_horizon_months&#x27; | AIQ / Runtime |
| 24 | serialized cold reload reproduces the same typed work frame and horizon | R | R | R | R | R | AssertionError: an absent frame cannot satisfy cold-reload parity: expected undefined to be defined | Canonical; browser pending |
| 25 | a “12 subscribers” brief does not attest twelve months | G | G | G | G | G | — | already green |
| 26 | a candidate normalised from “over the next year” retains twelve months without a literal 12 | R | R | R | R | R | AssertionError: expected undefined to be 12 // Object.is equality | MG + Canonical |
| 27 | “by Q3” without a year remains unresolved, with its wording retained | R | R | R | R | R | AssertionError: unresolved Q3 must remain in typed canonical context: expected undefined to be defined | MG + Canonical |
| 28 | a construction loss ledger cannot stand in for a stored horizon | R | R | R | R | R | AssertionError: a construction loss ledger is not canonical truth: expected undefined to be 12 // Object.is equality | Canonical |
| 29 | a goal label cannot stand in for a typed direction | R | R | R | R | R | AssertionError: a label is not a typed goal operator: expected undefined to be &#x27;&gt;=&#x27; // Object.is equality | Canonical + MG |
| 30 | a frame from another scenario cannot be smuggled into the saved graph | R | R | R | R | R | AssertionError: precondition: typed work frame must exist: expected undefined to be defined | Canonical |

**Handoff gates (one writer per shared seam):**

1. **Canonical first:** bring #2084 `42073df8c67ca3c795cbac6055a6bdff784c890e` and local merge-in `c0a012409b2823c14c95128eab3d1a14283594aa` through preservation, tolerant legacy-read and writer-guard GREEN. Neither candidate independently closes a PJ-A2 row. Keep the amended tolerant-read ruling; discard the older strict-read horizon mutant.
2. **MG next:** rebase the question-title bank `3d95c7acdd3817d6673cf4360c13693902d7e5c4` after Canonical's preservation gate. Make decision framing, direction, horizon, target source, exact `<` bound, and baseline/target rows GREEN through serialized reread. A2a and A2b are workflow instructions at `output/olumi-handover-2026-09-25/model-generation/successor-71229dfd/handover-20260927-1345/workflow-scripts/mg-a2a-stated-held-wf_79e66a8d-9a9.js` and `output/olumi-handover-2026-09-25/model-generation/successor-71229dfd/handover-20260927-1345/workflow-scripts/mg-goal-horizon-wf_fe149468-b91.js`, not verified complete code. The latter's strict-read expectation conflicts with Canonical's tolerant-read ruling.
3. **Canonical + MG contract resolution:** make the goal-free activation task cross the producer/schema, canonical write and fresh read without fake Decision/Goal or deadline; establish a separate frame currentness signal. Rows 1–3, 15–18, 20–21, 24 and 27–30 must turn GREEN before claiming general work-frame support.
4. **AIQ / Runtime:** after typed horizon/currentness arrives in Agent context, row 19 must return `probability_of_goal:null` and `goal_chance_withheld:'horizon_not_modelled'` for an atemporal result; rows 20 and 23 must show refreshed context and permissions. A7 `d99616c17c146fa7866bb375f5bd6626c20fc988` is not complete permission support.
5. **Canvas / Panel:** only after the previous gates, witness the same frame and permission state in a served signed-in browser reload. The JSON cold-read row is not browser proof.

**Validation:** focused test exits 1 by design; targeted ESLint passes; `tsc --noEmit` reports no PJ-A2 test-file error after the fixture type adjustment, while the repository-wide check still has pre-existing generated OpenAPI and other errors. No product carrier, merge, deployment or C-stack change was made.
