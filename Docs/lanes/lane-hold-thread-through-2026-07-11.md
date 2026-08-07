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

## Round-3 fixup (adversarial review, commits 4–5 of this branch)

**Concern 1 (blocking) — false lapse notice on fulfilled proposals.** The thread-through had no
fulfilment awareness: when THIS turn's mutation itself delivered the held change (the user's edit
adds the very concept a `proposed_concept` offer proposed; the user applies a GM held batch by
hand), the hold failed the re-referee (already applied) and emitted the honest-lapse notice — a
FALSE "your held proposal lapsed" sentence on the fulfilling turn. RED reproduced verbatim at the
edit dispatcher: `I have added Customer churn as a risk.` + `The suggestion to add 'customer churn'
has lapsed because the model changed, say the word if you still want it.` (9/9 new fixtures fail on
the unfixed tree). Fix (`hold-thread-through.ts` module doc (c)): dispatchers thread this turn's
APPLIED operations (edit; draft passes null — the whole new graph IS the mutation); a lapse is
reclassified `fulfilled_by_this_mutation` (notice suppressed, same frozen telemetry event) ONLY
when the hold's target entities + operation kinds are satisfied by the applied mutation — concept:
an applied `add_node` carrying the concept (edit) / concept present in the new draft (draft); GM
batch: EVERY held op matched by an applied op (kind + target; add_node also by label) or satisfied
by the post-mutation end state (add present / remove absent — the already-applied/no-op re-referee
failure class checked directly on the graph, not via blocker codes). Generic apply proposals and
payload-less GM holds keep their notice — no comparable op record; a redundant notice beats a
wrongly-suppressed one. The notice is built from the first NON-fulfilled lapse (F-HELD 2b
one-sentence precedent preserved).

**Concern 3 — consent holds silently evicted by the per-turn cap.** The fresh-first
`PENDING_ACTIONS_PER_TURN_CAP` slice (`commit.ts`) silently dropped a validly-threaded live consent
hold when this turn's own pendings filled the cap. Fix: consent-priority cap fill — live
CONFIRMATION_EXPECTING pendings win over non-consent pendings within the cap, original relative
order preserved (a fresh consent hold still beats a carried one; an evicted non-consent pending
loses only its short-confirm resumability, its chip still renders); a consent hold that STILL
cannot fit (all-consent overflow) lapses with the existing honest F-HELD 2b notice, never silently.
Track 2 `survivedCount` is now counted by identity against the survivor list (the old head/tail
arithmetic assumed this turn's pendings always all persist).

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
- Round-3 additions:
  - **Fulfilment via a generic apply proposal cannot be detected** — its `inline_patch` speaks the
    handler vocabulary (`handler_id`/`params`), not patch ops, so a user manually performing the
    proposed change still gets the (now redundant but not false-in-kind) lapse notice.
  - **`dispatchEditGraph` still passes no `consumedPendingRefs`** — fulfilment is detected at the
    thread-through, not recorded as consumption; the lifecycle tally attributes these retirements
    to the lapse path (`v5.pending_action.invalidated`, detail `fulfilled_by_this_mutation`), not
    `consumedCount`.
  - A GM hold whose batch still referees cleanly against the fulfilled graph (e.g. a duplicate-add
    under a fresh node id that the referee tolerates) THREADS rather than retires — it may re-offer
    an already-delivered change; the confirm-time re-referee still gates any apply.

## Gates (exact commands, this worktree; re-run at round-3 head)

- `pnpm typecheck:src` — clean (0 errors).
- `pnpm test:required` — **1031 files / 19883 passed, 0 failed** (8 files / 99 tests skipped, 13 todo).
- `pnpm exec vitest run src/orchestrator-v5` — **350 files / 7017 passed, 0 failed** (1 skipped).
- `pnpm exec eslint <touched src + test files>` — clean.
- Stale-`.js` shadow check — no hits.
- `git diff --cached --name-only | grep -c node_modules` — **0** on every commit.
