# Semantic spine — implementation and acceptance

## Scope and source authority

This change joins the existing authorities. It adds an optional **goal-node** `goal_scope`, one typed `reconcile_goal_scope` pending action and withdrawal of the existing product identity. It adds no top-level semantic state, claim ledger, second identity carrier, database migration or numerical engine change.

| Meaning | Existing authority and bounded extension |
| --- | --- |
| Whole goal versus component | Construction `goal.scope` is retained as a question; the approved reading becomes goal-node `goal_scope`. |
| £10,000 current total MRR | Existing goal-current-level approval writes `observed_state`; the pending claim never becomes a second baseline. |
| £49 and 300 | Existing factor value carriers, preserved through the scope approval. |
| Rejected Pro-only product | Existing `nonlinear_identity` is withdrawn by an exact consented operation, with revision checks and readback. Confirmed user identities require the same explicit correction. |
| Unresolved scope and billing question | Existing latest-turn `pending_actions` row stores operands, exact question and conditional derivations. Binding expires independently of issue lifetime. |
| Claim permissions | Existing final Run licence receives the scope restriction. The saved Run and its freshness remain unchanged while the issue is open. |

The independent pre-change staging witnesses are in [PRECONDITIONS.md](PRECONDITIONS.md). They distinguish successful baseline/identity confirmation from failed canonical withdrawal and failed scope durability.

## Local acceptance witnesses

| Requirement | Executable witness |
| --- | --- |
| S1: consistent figures, currency/period controls | Core and real-route tests: a total uses its component share; a component goal uses its own current level. The component level is not relabelled as a derivation. |
| S2–S4: one reconciliation; 300 unchanged; £3k/~61 remain conditional derivations | Core and real-route tests: no graph write before approval; conditional provenance survives JSON serialization. |
| S5: registered accounts versus billable subscriptions | Real canonical read/register and existing approval writer: one commit records total scope, share and count basis, writes £10k and withdraws the product. |
| S6: restart, unrelated turns and registration while open | Actual Agent route restarts with JSONB key reordering; latest answer rows retain the question. The shared persistence floor protects legacy callers that omit it. |
| S7: competing questions, expiry, retries and stale approval | Scoped binding requires one recent referent; expiry re-asks without erasing operands. Graph revision and issue revision are checked separately. Repeated approval does not duplicate the commit. |
| Explicit withdrawal | Existing withdrawal tool requires the user's exact issue-specific words; the persistence floor respects successful withdrawal through restart. |
| Transcript-free success chain | Real-route test clears all retained transcript rows and the brief, creates fresh proposal stores and reloads route modules. Canonical read, readiness, captured Run input, Agent context, explanation and cold reload carry total MRR, 30%, registered-account basis, £10k and unchanged 300. |
| Restore and registration compatibility | Existing version restore retains the approved carriers. UI registration that omits `goal_scope` preserves its canonical copy. Scope absence remains valid. |
| Freshness | Pending-only changes do not touch graph identity. Quote/source-only scope changes alter neither identity hash nor analysis hash. Resolved scope/permission changes enter the existing analysis projection. |

Test files are under `src/orchestrator-v5/agent-lane/__tests__/semantic-spine*.test.ts`, with restore in `src/routes/__tests__/assist.v1.scenario-versions.test.ts` and final-licence projection in `src/routes/__tests__/scenario-analysis-one-serialisation.test.ts`.

The local acceptance uses real CEE routes, approval operations and persistence code with a durable turn-row test double. The Run captures a stubbed PLoT client request; the Agent provider is scripted so its input can be inspected. These prove contract and persistence behavior, not live model quality or a deployed end-to-end pass. A Run may still lack causal coverage.

## Phase 2 controls

After the Phase 1 local chain passed, both free-month and per-seat controls passed using existing factors, option changes and missing-input disclosures. Cold reload retains one free month and unknown exposure, or the per-seat price and unknown billable seats; readiness asks for those missing inputs. No new option primitive is needed for these controls. They do not assert a complete pricing simulator or full numerical coverage of the original draft's mechanisms.

## Verification and served boundary

The implementation was rebased onto staging CEE `aac1b37936cd2bc051ea48e78f10eef0e31578ad` (the newer final-licence join). Read-only health and Render evidence identified that CEE build alongside PLoT `4526e4322764ba9b33690cdcd87320bc9e77261f` and ISL `842254da5aab6ff9aa8caf9c2ace1a59cc42e600`. The historical captured export's UI build is not asserted to be the current UI build.

Focused verification after the rebase passed 96 tests; regression closure passed 124 tests. The final withdrawal/restart check passed 16 tests, the pre-hash turn-writer check passed 51, the regression type repairs passed 68, and the final pricing/unit controls passed 23. These runs overlap and are not an aggregate test denominator.

Whole-repository lint passed with zero errors and two existing unused-disable warnings; final changed files passed lint. Source-only typecheck passed in the isolated snapshot. On draft head `e8ceafa89`, Linux CI's required lint/typecheck/guards and all three test shards passed ([CI run](https://github.com/Talchain/olumi-assistants-service/actions/runs/37042292123)). CI exposed 11 new regression-test type errors; those were corrected without increasing the error allowance.

Head `764388ca18aac6d030b491ec80174e75d5ad6081` then passed all three required shards, lint/typecheck/guards and the unchanged type-drift ratchet ([CI run](https://github.com/Talchain/olumi-assistants-service/actions/runs/37043873441)). Its checkout was synthetic merge `5e933c933f09f9781eeff411f036871a67f68232`, whose parents are that head and newer staging `18cd1c46290595323336553095cb6f62e212f228` (Suggest options). Thus the shared turn writer was exercised alongside the later staging change.

Final scope-alternative review found that a valid component-only reading also needed the component's own current level in the existing comparison. That bounded correction passed 25 pricing/canonical-route tests plus source typecheck and lint. The complete required regression must pass on the final source head before this draft is ready.

The first local full required run was RED. Its change-related failures were repaired and rechecked; a duplicate final local run was stopped after shared-machine timing stalls. Linux CI runs the complete required suite in the repository's existing three shards, with no suite exclusions or loosened CI limits.

Unrelated advisories reproduce on base staging: graph evaluator (4 failures / 217 passes, [base run](https://github.com/Talchain/olumi-assistants-service/actions/runs/37031953191)) and conversation harness (5 failures / 614 passes, [base run](https://github.com/Talchain/olumi-assistants-service/actions/runs/37031953068)). The security audit was also red on the base CI run. This change does not alter dependencies or those advisories.

Source typechecking uses an exact source snapshot with frozen dependencies under `/private/tmp`, avoiding an unrelated cloud-backed ancestor dependency lookup in the local OpenAI SDK. No project configuration or dependency versions were changed for that check.

**Delivery status:** source implementation and local acceptance; no merge, deploy or served semantic-spine journey is claimed. The post-deploy gate remains: remove transcript history and verify canonical read → readiness → captured Run input → Agent context → explanation → cold reload on the exact served tuple.
