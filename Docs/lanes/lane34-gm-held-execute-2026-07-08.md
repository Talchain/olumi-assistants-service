# Lane 34 — GM held-execute wiring (propose → hold → confirm → apply)

Date: 2026-07-08 · Branch: `claude-lane34/gm-held-execute` · Base: `origin/staging` @ `d63a0219c` (includes #372 intra-batch sequencing)

The last named code residual before Paul's GM live-mode decision (lane8 residual 1;
lane15 follow-up 2; lane32 follow-up 2; Brief H `05-gm-live-flip-pack.md` precondition
row "Held-execute wiring — NOT MET"). Today a "yes" on a held pending resolves through
`decideProposedChangeSynthesis → 'invalid' → commitProposedChangeRecovery` — a
deterministic decline-with-clarify that lane8 sanctioned as a stop-gap and named the
reviewed-apply path as the follow-up. This lane wires that path.

## Design (authority survey first)

**No implementation-grade held-execute design doc exists.** Searched:
`Docs/lanes/lane15-*` (live-mode verdict table — names the gap: *"real pending confirm
chip; 'yes' resumes into decline-with-clarify (held-execute unwired)"*),
`Docs/lanes/lane32-*` (§Follow-ups: *"Held-execute wiring … Now the sole named blocker
class before the live-mode flip"*), `acceptance-evidence/gm-mm/` (Brief H pack, D5a
precondition scoreboard), `Docs/lanes/lane8-gm-mm-live-integration-evidence.md`
(residual 1: *"a GM resume executor that routes the held envelope through the existing
apply path on confirm"*). The strongest existing design is lane8's one-line follow-up +
the existing machinery it names; the design below is therefore written here BEFORE
coding and kept minimal.

### The seam today (traced at base)

1. **Hold** (live mode only): `evaluateEditGraphMutations`
   (`handlers/edit-graph-referee-gate.ts`) blocks the apply and emits a REAL
   `apply_proposed_change` pending whose `inline_patch.handler_id =
   'graph_management_held_v1'` is deliberately OUTSIDE the synthesis allowlist. The
   pending carries only redacted verdict metadata — **no executable payload** — so no
   resume path could apply it even if it wanted to.
2. **Confirm**: route-v2's proposal-confirm suppressor sends the confirmation-shaped
   turn to `TurnExecutor`; `tryShortConfirmResume` matches the pending;
   `decideProposedChangeSynthesis` checks `preconditions.graph_hash` FIRST, then
   rejects the unknown handler id → `'invalid'` → decline-with-clarify.

### The wiring (this lane)

**Hold side** (`edit-graph-referee-gate.ts`, `buildHeldPending`): embed the executable
payload — the canonical validated `PatchOperation[]` from `handleEditGraph` (the exact
batch the edit pipeline validated and would have applied; the STRUCTURAL_APPLY_HELD /
TUNABLE_APPLY_HELD / REMOVE_UNCONFIRMED envelopes from #372 are the refereed projection
of these ops) — as `inline_patch.operations`, and stamp
`apply_wiring: 'held_execute_v1'` (was `'decline_with_clarify_v0'`). A defensive size
cap (16k JSON chars) omits the payload rather than risking the commit write; an
oversized hold degrades to today's decline posture. Shadow mode returns before any
pending is built — **byte-identical shadow behaviour is untouched** (pinned at base by
`edit-graph-dispatch-graph-management-modes.test.ts`).

**Confirm side** (new `handlers/gm-held-execute.ts` + one branch in
`turn-executor.ts`): in the existing `apply_proposed_change` short-confirm branch,
BEFORE the generic synthesis, detect the GM held handler id. Then:

- **Flag gate**: only when `CEE_GRAPH_MANAGEMENT_MODE === 'live'` at RESUME time. In
  `off`/`shadow` the branch falls through to the generic synthesis path — the
  decline-with-clarify posture at base, byte-identical (pinned). A GM pending can only
  be CREATED in live mode, so this covers the flag-flipped-back-mid-flight case.
- **Hash precondition** (like-for-like): recompute
  `computeAnalysisAffectingGraphHash(context.persistedGraph ?? graphStateForTurn)` —
  the SAME function over the SAME authority class the gate hashed at hold — and require
  equality with `preconditions.graph_hash`. Divergence → the existing `superseded`
  recovery. (The generic synthesis path uses `freshness.current_graph_hash`, which
  under `analysisReadyGuardEnabled` hashes a CANONICALISED graph; the hold-side pin was
  raw, so the raw recompute avoids false declines while staying fail-closed.)
- **Payload validation**: `inline_patch.operations` must parse against the edit
  pipeline's own `PatchOperationsArraySchema`. Missing (legacy `decline_with_clarify_v0`
  pendings) or malformed → the existing `invalid` recovery.
- **Re-referee (defence-in-depth)**: run the SAME gate (`evaluateEditGraphMutations`,
  mode `'live'`, `dispatch_path: 'gm_held_resume'`) over the stored ops against the
  CURRENT graph. The confirm lifts ONLY the hold: governing `held`/`proceed` →
  execute; `rejected`/`stale`/`clarify_required` → decline (`invalid` recovery). A
  user's "yes" can never override an integrity rejection, and the resume re-emits the
  redacted `v5.candidate_mutation.*` events (registered enum members only — no new
  telemetry names).
- **Execute through the existing apply path**: `applyPatchOperations` (the edit
  pipeline's applier) inside `applyAndValidateMutation` (the D1 seam: GraphV3-validated
  clone, post-mutation `GraphV3.safeParse`, structural fields merged back onto the full
  persisted shape — no rich-field loss). Apply errors (`PatchApplyError`,
  `GRAPH_INVARIANT_VIOLATED`) → decline, nothing persisted.
- **Receipt fact**: rich `buildEditGraphHandlerFact` (via `buildAppliedChanges` over
  the applied ops) with the generic fallback; if BOTH fail, refuse to commit the graph
  (DL-7 invariant: never a receipt-less mutation) → decline.
- **Commit**: single durable writer unchanged — `commitTurn` → `commitDirectAnswer`
  with `graph` (mutated, persisted-shape), `handler_facts: [fact]`,
  `consumedPendingRefs: [chip_id]`, `llm_calls_used: 0`, `turn_class 'direct_answer'`,
  `handler_id: null` (same rationale as edit dispatch). The commitTurn wrapper supplies
  the A3 CAS observe hashes from the server-side persisted read automatically.
- **Honesty plumbing**: `handlerEmittedMutatedGraph = true` (so
  `classifyStructuralClaim` does not swap the honest applied receipt and
  `turn_outcome.graph_mutated` is true), `effectiveTurnGraph` = the applied GraphV3
  (durable-text scrub + egress label resolution against the POST-edit graph),
  `analysisReadyForTurn` recomputed from the applied graph, wire `freshness` re-derived
  against the post-apply hash (an applied substantive edit honestly reads stale).
  Applied receipt copy is fixed (provisional_doctrine_v0), swept against
  `findForbiddenPhraseHit`; it ships ONLY after `commitTurn` returns (commit throw →
  `STATE_COMMIT_FAILED`, no claim). A "Re-run analysis" chip is offered when the
  post-apply graph is structurally ready.

### Deliberate scope boundaries

- **Ordinal/label selection of a GM held pending** ("the first one" with multiple live
  proposals) still resolves through the generic synthesis → decline-with-clarify. The
  designed confirm surface (typed "yes" and the confirm chip, whose message is "Yes")
  routes through the direct short-confirm branch, which is wired. Never mis-applies;
  named residual.
- **HOOK-5 (proposal cards, ISSUE-9027) untriggered**: this wiring reuses the existing
  confirm chip + pending machinery; no `proposal_card` surface is added to
  `src/schemas` / `src/orchestrator-v5/compose`, so the tripwire stays armed by
  design.
- **No new telemetry event names** (frozen registry): resume re-uses the registered
  `v5.candidate_mutation.*` members (with `dispatch_path: 'gm_held_resume'`) and the
  existing `pending_action.*` lifecycle events.
- Reserved scenarios (1909b083*/def3cb31*/8e0bf73d*/90385279*/104d65bd*) untouched.

## Verification (in worktree `.worktrees/cee-lane34-held-execute`, base `d63a0219c`, `pnpm install` restored deps first)

| Gate | Result |
|---|---|
| RED-first | `gm-held-execute-route-level.test.ts` committed at `9776a78dc`, run against the PRISTINE base: the live-apply case FAILED (decline path, nothing persisted); the four base-posture pins (superseded / legacy no-payload / shadow / off) passed. GREEN at `57a0dd5eb`. |
| `pnpm typecheck:src` (tsc -p tsconfig.build.json) | clean |
| `scripts/ci/typecheck-ratchet.sh` | within baseline — 136 files / 462 errors vs baseline 137/462 (the shrink is the pre-existing lane-32 state, not this lane) |
| `scripts/check-forbidden-boundary-patterns.sh` | at baseline (as-unknown-as 95 / science-fallback 17; an initial +1 double-cast in the new module was reworked to a plain widening copy) |
| `npx eslint` on all 6 touched files | clean (exit 0) |
| Focused suites: gate + dispatch-modes + allowlist + all `graph-management/__tests__` + proposed-change route/synthesis/short-confirm + the two new files | 18 files / 350 tests green |
| New: `gm-held-execute.test.ts` (18) + `gm-held-execute-route-level.test.ts` (5) | green |
| Frozen telemetry registry (`tests/utils/telemetry-events.test.ts`) | green — no new event names; resume re-uses registered `v5.candidate_mutation.*` members with `dispatch_path: 'gm_held_resume'` + existing `pending_action.*` lifecycle events |
| `pnpm test:required` | see PR body (run in this worktree at the branch tip) |
| HOOK-5 (proposal cards) | untriggered — no `proposal_card` token added to `src/schemas` / `src/orchestrator-v5/compose`; tripwire stays armed |

## Follow-ups (not in this lane)

1. **Ordinal/label selection of a GM held pending** ("the first one" when a GM
   held pending coexists with another live proposal) still resolves through the
   generic synthesis → decline-with-clarify. The designed confirm surface (typed
   "yes" / the confirm chip, message "Yes") is wired. Never mis-applies.
2. **Held UX copy** on the hold turn still invites "yes" generically; a
   per-verdict richer confirm surface (proposal cards, ISSUE-9027) remains
   Track 4's, gated by HOOK-5.
3. **Live-mode flip decision (Paul)** — with #372 + this lane, the two named
   code blockers from the Brief H scoreboard are addressed; F3
   (proposal-language misfire on applied edits) remains open on that scoreboard
   and is not this lane's surface.
4. **Staging smoke after deploy** — drive a live-mode hold + "yes" end-to-end:
   expect held turn (pending + chip), then applied turn (graph persisted,
   edit_graph fact, `v5.candidate_mutation.*` with `dispatch_path:
   gm_held_resume`, `pending_action.consumed`), rerun clears staleness.
