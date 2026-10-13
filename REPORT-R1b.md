BLOCKED: Typecheck verification only. The single permitted `npx tsc -p tsconfig.json --noEmit --pretty false` run exhausted Node's heap (exit 134) before emitting TypeScript diagnostics. Smallest unblock: DL/CI completes the same check with adequate Node heap. No second compiler run was attempted, per the brief.

# R1b — source repairs and all requested specs pass

Base/unchanged HEAD: `6dc17df133ad8a692e08048b32898c24b87abd3b`. Branch: `codex/r1-run-press-loop`. Workdir: `/private/tmp/cx-R1`. No commit, push, deployment or remote-CI-green claim.

## Per-failure repairs

| Reported failure | Source repair | Verification |
|---|---|---|
| ESLint unused `RUN_RESULT_READY_TEXT` | Removed the unused import from `decision-input-ask.test.ts`. | ESLint on all three changed files: exit 0, no diagnostics. Test file: 67 passed, 0 failed. |
| New type errors in `option-name-truth-route.test.ts` | Gave captured provider requests their actual test-facing shape, `{ input?: unknown; tool_choice?: unknown }[]`, so accessing `tool_choice` is typed instead of accessing an `unknown`. No baseline change. | Runtime suite: 14 passed, 0 failed. Full-project compiler run incomplete due to heap exhaustion; zero scoped diagnostics is NOT a typecheck pass. |
| Typed tool-context census expected 20, got 19 | The Run-press loop now receives the existing `toolCtx` directly; only other turn types add their qualified figure/selection context. No history-derived replacement carrier, dummy reference, new dispatch or guard edit. | `figure-must-be-written-by-user.test.ts`: 20 passed, 0 failed. Original 20-use assertion passes unchanged. |
| Estimate writer guard and replay writer mutant | Moved the skipped-Run receipt before the existing `withEstimateGoalPointsAtEgress` call and composer. Its earlier text selection also rejects fabricated model success. History, durable storage, send and replay retain the qualified carrier. The replay gate itself remains intact. | `estimate-goal-point-writers.guard.test.ts`: 7 passed, 0 failed, including removal-of-replay-gate mutant. |
| Text write after composer | Removed the skipped-Run `assistant_text` overwrite after `composeReplyShape`. The skipped receipt is treated as host-authored through the existing keep-whole composer behavior; its Run offer is attached before qualification. | `reply-composer-last-writer.test.ts`: 20 passed, 0 failed. Exactly the composer's own text write remains after the composer. |

Only three tracked files changed: `src/routes/agent-v1-turn.ts`, `src/orchestrator-v5/agent-lane/__tests__/decision-input-ask.test.ts`, and `src/orchestrator-v5/agent-lane/__tests__/option-name-truth-route.test.ts`. No guard expectations, exact replay/authorship assertions, fixtures, licence rules, prompt text, or `scripts/ci/typecheck-baseline.txt` changed.

## Acceptance and scope

- **253 files; 4,457 passed; 0 failed; 0 pending/skipped.** Every Vitest process exited 0 and every JSON report recorded success.
- All 188 files from the R1 inventory ran, plus the named failures/Run-press suite and remaining requested guard/drift files (deduplicated).
- All 11 `tests/contract/*guard*` files: **78 passed, 0 failed**.
- All 63 matching `*guard*.test.ts` / `*drift*.test.ts` under `src/orchestrator-v5`: **1,147 passed, 0 failed**. These counts overlap the total and R1 inventory.
- Run-press loop: **12/0**; Run-fast-path: **17/0**; result-first replay: **9/0**.
- The existing skipped-Run row still demands the exact receipt, equality with the durable row and replay, a persisted usable Run offer, and successful retry. All those assertions passed unchanged.
- `git diff --check`: passed.
- Source remained unchanged throughout the spec sweep. Typecheck was attempted exactly once; no build-only compiler substitute or baseline suppression was used.

Each spec ran alone using the installed dependencies:

```sh
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=test-anon-key npx vitest run <file> --reporter=json --outputFile=<report>
```

ESLint command:

```sh
npx eslint src/routes/agent-v1-turn.ts src/orchestrator-v5/agent-lane/__tests__/decision-input-ask.test.ts src/orchestrator-v5/agent-lane/__tests__/option-name-truth-route.test.ts
```

Evidence: `recovery-notes/r1b-tests/specs.json`, `results.json`, per-file `.json`/`.log` files, `mutants.json`, `eslint.log`, and `typecheck.log`. The R1 report and its prior evidence remain untouched.

## Mutants

The existing structural tests execute their mutants in memory, leaving source unchanged. All five named mutant assertions passed:

- `passed` — estimate goal points: every discovered assistant writer uses the ONE chokepoint MUTANT: removing the call from the existing replay writer goes RED
- `passed` — the reply composer is the ONE last writer of `assistant_text` on the Agent route 1-MUTANT (in memory): a third composer call is caught
- `passed` — the reply composer is the ONE last writer of `assistant_text` on the Agent route r12-MUTANT (in memory): moving the GP append after the composer breaks the index-order pin
- `passed` — the reply composer is the ONE last writer of `assistant_text` on the Agent route 2-MUTANT (in memory): a text write placed after the composer is caught
- `passed` — PL: a canonical durable reply restores its displayed shape without a provider or cache PL mutant: a shape that moves the full qualification to its face cannot pass the live shape parity assertion

The same writer scanner also passed its new-bypass/qualified-writer control, unknown-spread/raw-fallback controls, persistence/reload discovery, and unrelated-gate/comment controls. The R1 report's separate host-only Run and client-timing source mutants were not rerun; their old counts are not presented as new R1b evidence.

## Assumptions and limits

- R1b changes only the named failure causes; the Run remains agent-owned and existing timing, authority and one-Run constraints remain in force.
- A skipped Run is an execution receipt from the host, not a model conclusion; it must retain the exact retry wording after qualification/composition.
- The existing R1 inventory is the report's route-import coverage list. Every non-contract entry was checked to contain a reference to `agent-v1-turn`.
- Local mocked route and structural tests prove this patch's tested behavior, not live AI quality, a deployed user journey or remote CI status.
- Typecheck is the outstanding verification item. The baseline file is unchanged. The heap failure must not be counted as proof that the scoped file has no errors.

## Per-file counts

| Spec | Pass | Fail | Pending/skipped | Exit |
|---|---:|---:|---:|---:|
| `src/orchestrator-v5/agent-lane/__tests__/figure-must-be-written-by-user.test.ts` | 20 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/estimate-goal-point-writers.guard.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/reply-composer-last-writer.test.ts` | 20 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/option-name-truth-route.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-press-loop.route.test.ts` | 12 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-fast-path.test.ts` | 17 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-replay.route.test.ts` | 9 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/agent-midturn-ownership-wire.test.ts` | 17 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/door-refusal-propagation.test.ts` | 15 | 0 | 0 | 0 |
| `src/orchestrator-v5/admission/__tests__/target-testability.test.ts` | 43 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/a6-guidance-variant-slot.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/a7-said-last-turn.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-add-factor-door-seam.test.ts` | 45 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-add-option-held-seam.test.ts` | 86 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts` | 26 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts` | 22 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-knows-board-edits.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-never-shows-instructions-or-codes.test.ts` | 26 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-option-participation-context.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-proposal-user-in-control-seam.test.ts` | 52 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-remembers-the-conversation.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-revises-a-link.test.ts` | 22 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-run-delta-disclosure.route.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-run-reply-answer-shape.test.ts` | 30 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sees-one-readiness.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-selection-context.test.ts` | 17 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sets-the-goal-target-real-writer.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sets-the-goal-target.test.ts` | 69 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-subturn-not-conversation.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-target-edit-says-target.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-authoritative-state.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-goal-certainty.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-limit-verdicts.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-not-modelled.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-option-participation.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-run-provenance.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-claim-wait.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-is-openai-only.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay-real-store.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay-real-store.v6.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay.claim-release-regression.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay.test.ts` | 9 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-states-its-run-freshness.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-withheld-leader-fail-closed.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-writer-doors-seam.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/approval-chips.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/approval-fast-path.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/b3-scope-one-ask.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/board-edit-first-still-seeds.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/break-even-route.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/brief-read-frame.test.ts` | 23 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/ceiling-stock-chain.test.ts` | 148 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/chat-truth-chip-and-save-line.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/chip-approval-prunes-its-proposal.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/chip-click-withholds-authority.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/claim-permissions-caveat-not-withhold.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/compose-reply-restatement.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/construction-output-cap.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/contextual-next-step-pills.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/converse-reasoning-effort.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-answer.route.test.ts` | 30 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-carry.route.test.ts` | 23 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-typed-turns.route.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/deadline-card-chain.test.ts` | 68 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-input-ask.test.ts` | 67 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-review-press.route.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-sensitivity-screen-gate.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/display-ids.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/drafter-raw-record.route.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/drawn-link-press.route.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/e6-said-once-paul-replay.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/empty-model-state-given.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/event-risk-build-reply.route.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/explain-guards-one-leader-spelling.route.test.ts` | 127 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/explain-low-robustness-caveat.route.test.ts` | 42 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/factor-review-served.test.ts` | 20 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/fallback-held-card.test.ts` | 15 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/fast-approve-carries-follow-up.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-analysis-coaching-card.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-analysis-route.test.ts` | 44 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-graph-read-overlaps-claim.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/forward-direct-manipulation.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/fresh-goal-scope-leader-egress.route.test.ts` | 65 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-driver-egress.pv-route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-driver-egress.route.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-ranking-instruction.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.explain.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.route.test.ts` | 44 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-horizon-verdict.route.test.ts` | 18 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/graph-ready-frame.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/guided-sizing.route.test.ts` | 31 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/held-proposal-user-in-control-seam.test.ts` | 25 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/held-status-quo-gets-no-levels.test.ts` | 48 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/history-sent-text.route.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/hop-limit-route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/hop-limit-text.test.ts` | 9 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/identity-card-reoffer.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/identity-part-figures.route.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/index-goal-weights-note.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/instructions-breakpoint-refusal.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/interpret-deadline.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/interpreter-investigation-priority.route.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/kept-run-stale-after-a-change.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/leader-final-egress-replay.route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/left-out-option-egress-carriers.route.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-effect-card-route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-sentence-first-call.route.test.ts` | 56 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-size-ask.test.ts` | 20 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/living-model-assumption-challenge.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/marketing-l20-derivation.route.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/method-turn-route-seam.test.ts` | 17 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/model-relative-naming-instruction.test.ts` | 12 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/never-reask-closed.route.test.ts` | 34 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/next-step-chips.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/no-direct-link-figure.route.test.ts` | 33 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/no-leader-sentence-reads-limit-rows.route.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/one-reply-build-contract.route.test.ts` | 39 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/premortem-worksheet-route.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/proposal-survives-a-restart.test.ts` | 43 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/provider-ledger-prompt-identity.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/provider-ledger-request-identity.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/provisional-view-route.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/public-research-route.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/r3-give-your-estimate-asks-that-estimate.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/rc3-precondition-incident-edge-seam.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/rebuild-after-too-large.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/receipt-asks-for-a-needed-level.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/reply-length-instruction.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/rerun-carries-run-delta.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/rerun-explanation.route.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/research-control-survives.test.ts` | 47 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-licensed.route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-run.test.ts` | 24 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-answer-completeness.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-keeps-reasoning-item.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-keeps-the-approve-chip.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-offer-after-approval.test.ts` | 28 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-outcome-follow-ups.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-reply-reason-is-the-engine-outcome.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-reply-unvalued-root.route.test.ts` | 31 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/run4-deadline-plain-approval.route.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/s4-horizon-consumers.route.test.ts` | 19 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/s5t-receipt-route.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/same-run-goal-chance-and-sensitivity.test.ts` | 20 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/selected-coach-wiring.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/semantic-spine-real-route.test.ts` | 19 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/starting-point-omission-disclosed.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/steady-horizon-card.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/strengthen-press.test.ts` | 27 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/structural-challenge-route-reachability.test.ts` | 24 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/structural-challenge-route.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/suggest-starting-assumptions.test.ts` | 25 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/t2-guidance-wire.test.ts` | 22 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/target-not-testable-beside-ranges.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/tipping-point-coaching.route.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/typed-approval-offers-the-run.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/unchecked-limit-no-remedy-clause-pinned.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/unfinished-answer-text.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/what-changes-route.test.ts` | 114 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-draft.test.ts` | 82 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-risks-seam.test.ts` | 42 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-turn-seam.test.ts` | 9 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/write-outcome.test.ts` | 45 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/method-turn/__tests__/method-turn.test.ts` | 40 | 0 | 0 | 0 |
| `src/orchestrator-v5/coaching/__tests__/fragile-link-challenge.test.ts` | 31 | 0 | 0 | 0 |
| `src/orchestrator-v5/coaching/__tests__/no-flagged-link-card.test.ts` | 12 | 0 | 0 | 0 |
| `src/orchestrator-v5/goal-target/__tests__/batch-g-hiring-conditional.test.ts` | 24 | 0 | 0 | 0 |
| `src/orchestrator-v5/goal-target/__tests__/ebd-paul-hiring-replay.route.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/system-events/__tests__/canonical-reread-deadline.test.ts` | 72 | 0 | 0 | 0 |
| `src/routes/__tests__/agent-lane-readiness-carries-admission.test.ts` | 4 | 0 | 0 | 0 |
| `src/routes/__tests__/agent-readback-carries-leader-limit-risks.test.ts` | 3 | 0 | 0 | 0 |
| `src/routes/__tests__/agent-v1-turn-canonical-view-wire.test.ts` | 27 | 0 | 0 | 0 |
| `src/routes/__tests__/assist.v1.scenario-graph.held-offers.test.ts` | 57 | 0 | 0 | 0 |
| `src/routes/__tests__/goal-reach-confirm-reading-route.test.ts` | 10 | 0 | 0 | 0 |
| `src/routes/__tests__/s-b-action-bar-route.test.ts` | 31 | 0 | 0 | 0 |
| `src/routes/__tests__/s1-d-live-cold-readiness-parity.test.ts` | 7 | 0 | 0 | 0 |
| `src/routes/__tests__/scenario-analysis-constraint-verdict-state.test.ts` | 9 | 0 | 0 | 0 |
| `src/routes/__tests__/scenario-analysis-one-serialisation.test.ts` | 13 | 0 | 0 | 0 |
| `src/routes/__tests__/stored-goal-chance-horizon-read.test.ts` | 10 | 0 | 0 | 0 |
| `src/routes/__tests__/x4-answer-offers-reload.test.ts` | 16 | 0 | 0 | 0 |
| `tests/contract/coaching-chip-intent-completeness.guard.test.ts` | 11 | 0 | 0 | 0 |
| `tests/contract/context-summary-diagnostic-only.guard.test.ts` | 6 | 0 | 0 | 0 |
| `tests/contract/goal-record-census.guard.test.ts` | 5 | 0 | 0 | 0 |
| `tests/contract/horizon-basis-outbound.guard.test.ts` | 5 | 0 | 0 | 0 |
| `tests/contract/reduced-samples-disclosure-single-site.guard.test.ts` | 3 | 0 | 0 | 0 |
| `tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts` | 5 | 0 | 0 | 0 |
| `tests/contract/run-delta-pack-parity.guard.test.ts` | 5 | 0 | 0 | 0 |
| `tests/contract/run-delta-prior-facts-no-default.guard.test.ts` | 10 | 0 | 0 | 0 |
| `tests/contract/tier3-leak-guard.runtime.test.ts` | 16 | 0 | 0 | 0 |
| `tests/contract/tier3-leak-guard.static.guard.test.ts` | 3 | 0 | 0 | 0 |
| `tests/contract/untestable-goal-disclosure-single-site.guard.test.ts` | 9 | 0 | 0 | 0 |
| `tests/unit/sys1-turn-authority.test.ts` | 79 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/answer-kind-compose-classification.drift.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/blocked-slot-claim-guard-callsite-pin.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/compose-site-verdict-consumption.drift.test.ts` | 31 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/execute-path-answer-kind-classification.drift.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/fact-sink-evaluated-revision.guard.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/graph-writer-flag-off.guard.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/graph-writer-population.guard.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/graph-writer-revision.guard.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/process-narration-guard-callsite-pin.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/prose-grounding-block-wiring.drift.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/route-egress-analysis-state-freshness.drift.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/route-egress-claim-safety-marking.drift.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/route-egress-functional-marking.drift.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/route-exit-path-observability.drift.test.ts` | 15 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/turn-executor-answer-text-compose-guard.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/turn-executor-zero-resolved-selection-guard.cas-on.test.ts` | 1 | 0 | 0 | 0 |
| `src/orchestrator-v5/__tests__/turn-executor-zero-resolved-selection-guard.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/__tests__/turn-read-cache-writer-guard.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/agent-lane/actions/__tests__/goal-reach-class-guard.test.ts` | 37 | 0 | 0 | 0 |
| `src/orchestrator-v5/belief-elicitation/__tests__/parse-fraction-collapse-guard.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/blocked-slot-claim-guard.test.ts` | 27 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/blocked-slot-guard-arming-on-refusal.test.ts` | 4 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/clarify-entity-guard.test.ts` | 10 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/flip-threshold-option-naming-guard.test.ts` | 13 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/goal-target-receipt-guard-persisted-target.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/goal-target-receipt-guard.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/leading-option-egress-guard.test.ts` | 47 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/looping-chip-guard.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/compose/__tests__/withheld-structured-designation.drift.test.ts` | 17 | 0 | 0 | 0 |
| `src/orchestrator-v5/context/__tests__/graph-identity-guards.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/decision-records/__tests__/decision-records-not-ready-migration-static-guards.test.ts` | 34 | 0 | 0 | 0 |
| `src/orchestrator-v5/format/__tests__/p53x-band-word-guard.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/goal-target/__tests__/time-class.guard.test.ts` | 26 | 0 | 0 | 0 |
| `src/orchestrator-v5/graph-management/__tests__/isolation-guards.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/model-management/__tests__/atomic-restore-migration-static-guards.test.ts` | 15 | 0 | 0 | 0 |
| `src/orchestrator-v5/model-management/__tests__/isolation-guards.test.ts` | 12 | 0 | 0 | 0 |
| `src/orchestrator-v5/model-management/__tests__/migration-static-guards.test.ts` | 26 | 0 | 0 | 0 |
| `src/orchestrator-v5/replacement/__tests__/accept-guard-known-dropped.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/configure-option-revision-is-guarded.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/option-intervention-guard-partial-reference.integration.test.ts` | 2 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/option-intervention-guard-partial-reference.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/option-intervention-guard.test.ts` | 11 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/option-intervention-write-guard.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/prompt-size-guard-absolute.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/registry-handler-kind-drift.test.ts` | 7 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/state-query-guard.brief-audit.test.ts` | 68 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/state-query-guard.mutation-confirmation-honesty.test.ts` | 75 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/state-query-guard.structure-origin.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/routing/__tests__/state-query-guard.test.ts` | 135 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/append-turn-atomic-v3-migration-static-guards.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/append-turn-atomic-v4-generation-key-migration-static-guards.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/append-turn-atomic-v4-migration-static-guards.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/append-turn-atomic-v5-replay-precedes-cas-static-guards.test.ts` | 8 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/store-draft-graph-grants-static-guards.test.ts` | 3 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/supabase-store-v5-cas-static-guards.test.ts` | 21 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/turn-fence-first-write-exemption-migration-static-guards.test.ts` | 16 | 0 | 0 | 0 |
| `src/orchestrator-v5/session/__tests__/turn-fence-guards.test.ts` | 14 | 0 | 0 | 0 |
| `src/orchestrator-v5/tools/handlers/__tests__/analysis-ready-guard-no-bypass.test.ts` | 5 | 0 | 0 | 0 |
| `src/orchestrator-v5/tools/handlers/__tests__/analysis-ready-guard.integration.test.ts` | 23 | 0 | 0 | 0 |
| `src/orchestrator-v5/tools/handlers/__tests__/run-analysis-intake-wiring.drift.test.ts` | 6 | 0 | 0 | 0 |
| `src/orchestrator-v5/tools/handlers/__tests__/run-analysis-participation-guard.test.ts` | 10 | 0 | 0 | 0 |
