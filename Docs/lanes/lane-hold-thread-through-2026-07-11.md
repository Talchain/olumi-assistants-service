# Lane: HOLD-WIPE fix — thread holds through edit/draft mutating commits (task_2e1b8c87)

**Date:** 2026-07-11 · **Base:** origin/staging `f00a209a9` · **Branch:** `fix/hold-wipe-thread-through`
**Origin:** consent-first PR #425 (F-HELD, merged `e348eeae`) round-2 FIXUP 5a documented this as a
KNOWN RESIDUAL; chipped as task_2e1b8c87.

## Defect

The F-HELD carry-forward lifecycle (turn-TTL decrement, honest lapse notice, steer-don't-bind chip
suppression — `src/orchestrator-v5/commit.ts`) runs only on commits that thread
`CommitMetadata.priorPendingActions`. Only the TurnExecutor `commitTurn` wrapper did. Edit- and
draft-classified turns commit via `dispatchEditGraph` / `dispatchDraftGraph` with **no priors**, so a
live consent hold — a held proposal awaiting the user's explicit yes — was silently destroyed by any
unrelated edit or draft commit: no TTL decrement, no notice, no telemetry, including on the add-risk
clarify turn itself.

## RED evidence (commit 1 of this branch)

`src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch-hold-thread-through.test.ts` +
`draft-graph-dispatch-hold-thread-through.test.ts` written first and run against the unfixed tree:
**6/6 fail** — commit metadata carries no `priorPendingActions` (the wipe), returned responses carry
no notice, no `v5.pending_action.invalidated` event fires.

## Fix (commit 2)

New pure decision core `src/orchestrator-v5/handlers/hold-thread-through.ts`
(`threadHoldsThroughMutatingCommit`), called by both dispatchers immediately before their
`commitDirectAnswer`:

| Prior pending at a graph-writing commit | Treatment |
|---|---|
| Unpinned, or pin == post-mutation hash | Thread unchanged |
| Already wall/turn-expired | Thread unchanged (carry-forward owns expiry bookkeeping) |
| Non-confirmation-expecting kinds (`run_analysis`, `what_would_flip`, `set_factor_value`, `edit_graph_add_risk`) | Thread unchanged — carry-forward hash rule owns their designed invalidation (TurnExecutor parity) |
| **GM hold with executable batch** (`readGmHeldResume` → ok) | **Validate, don't assume**: re-referee the batch against the new graph via new `assessHeldBatchAgainstGraph` (edit-graph-referee-gate.ts). Pass → thread **re-pinned** to the new hash; fail → **honest lapse** |
| Generic `apply_proposed_change`, payload-less GM hold, pinned `proposed_concept` | **Honest lapse** — their confirm/resume paths are hash-gated on the emit-time base by design, so the mutation genuinely invalidates them |

Non-mutating turns (rejections, no-ops, GM-blocked verdicts, goal-receipt withheld writes) thread
every prior through unchanged and pass no `graph_hash` (an ingress-echo divergence can never falsely
invalidate a carried hold).

**Honest lapse =** deterministic one-sentence notice naming what was held and why
(`The held change '<label>' has lapsed because the model changed, say the word if you still want it.`
— F-HELD 2b register: comma not em dash; swept vs `findSuccessClaimHit` / `findForbiddenPhraseHit`)
**+** redacted telemetry on the **existing frozen** event `v5.pending_action.invalidated`
(reason `graph_hash_changed`, `detail` = `held_batch_invalid_post_mutation` | `proposal_base_moved`,
`site` = `edit_graph_dispatch` | `draft_graph_dispatch`, `governing` when the GM assessment ran).
No new telemetry-registry entries → no enum-snapshot changes needed.

**Why re-pinning a validated GM hold is safe:** the confirm-time resume (`gm-held-execute.ts`)
re-referees the batch against the live graph with the resume turn's REAL freshness before any apply
— a threaded hold can never execute unreviewed. The thread-time assessment mirrors the resume's
acceptance set (`held`/`proceed`) exactly, so a threaded hold is one the resume could accept.

**Assessment neutralises freshness** ('none'): analysis currency is a property of the analysis, not
of the hold's structure; judging staleness at the thread seam would lapse holds the user could still
legitimately confirm after a re-run. The resume re-checks real freshness.

**stored copy == wire copy:**
- edit path: notice appended to the response BEFORE commit; additionally the dispatcher now adopts
  the committed response when the commit seam rewrote it (turn-TTL lapse notice / chip suppression —
  previously the commit result was discarded on this path, so those rewrites were stored-only).
- draft path: notice committed on the provisional response's `assistant_text`; committed text
  re-attached to the real wire response after the post-commit build.

**Draft read invariant:** the draft dispatcher gains `loadMostRecentPendingActions` (single-row
read, [] on first turns, degrades to [] on failure). This is NOT the `readRecent` turn-chain read
the freshness invariant (`route-v2-draft-graph-persistence.test.ts`) forbids; documented at the
call site.

**Single turn-TTL decrement site preserved:** the helper never touches TTLs; each turn commits
exactly once, so the once-per-turn decrement invariant holds with the dispatchers now threading.

## Doctrine forks recorded (defaults chosen, not blocked)

1. **Generic (non-GM) apply proposals + pinned concept offers lapse rather than thread.** Their
   confirm paths are hash-gated on the emit-time base by design (`parsePendingAction` requires the
   pin; `resolveProposalResume` rejects `graph_hash_changed`), so "threading" them would only defer
   an inevitable refusal to confirm-time; re-pinning them would bypass the superseded/divergence
   safety gate — a weakening of the consent doctrine. Default: honest lapse at the mutating commit.
2. **Thread-time GM assessment neutralises freshness.** Alternative (assess with post-edit real
   freshness) lapses nearly every hold whenever any analysis exists (an applied edit makes it
   stale), making doctrine (a) unreachable. Default: structural-only assessment; confirm-time
   re-referee owns freshness.
3. **Hash-rule drops inside commit.ts stay notice-less.** Consent holds can no longer reach rule 4
   with a stale pin from the edit/draft paths (handled upstream); making rule-4 hash drops noisy
   would also change TurnExecutor-path behaviour ruled in F-HELD round 1. Default: leave rule 4
   as-is; documented in the updated comment block.

## Residuals (out of this lane's scope, documented in code)

- **chip-click dispatch** (`handlers/chip-click-dispatch.ts`, 2 commit sites) and **system-event
  dispatch** (`system-events/dispatch.ts`, 1 commit site) still commit with no
  `priorPendingActions` — the same wipe class on those turns.
- TurnExecutor **mutating** commits (proposal apply, gm-held-execute) can still silently
  hash-invalidate a *different* live hold via carry-forward rule 4 (pre-existing F-HELD round-1
  ruling; fork 3 above).
- A hold threading through a **draft** commit does not get steer-don't-bind chip suppression on the
  draft's wire chips (the commit-seam suppression acts on the provisional response). Rare: most
  holds lapse across a redraft.
- If BOTH pending reads fail on an edit turn (buildTurnContext throw + degraded standalone read),
  the carry list degrades to [] — a degraded read cannot preserve what it cannot see; store-layer
  telemetry fires.

## Gates (exact commands, this worktree)

- `pnpm typecheck:src` — clean (0 errors).
- `pnpm test:required` — **1031 files / 19873 passed, 0 failed** (8 files / 99 tests skipped, 13 todo).
- `pnpm exec vitest run src/orchestrator-v5` — **350 files / 7007 passed, 0 failed** (1 skipped).
- `pnpm exec eslint <6 touched src files + 3 test files>` — clean.
- Stale-`.js` shadow check — no hits.
- `git diff --cached --name-only | grep -c node_modules` — **0** on every commit.
