# T4.0 — Graph-management branch/worktree map

**Date:** 2026-07-02 · **Baseline:** `origin/staging` @ `2376914c8d` · **Status:** audit complete (read-only)

Purpose: one authoritative map of every graph-management / typed-mutation surface — what is
live, what lives on branches, and what each is worth when T4 opens. Companion doc:
[dual-model-typed-mutation-handoff-contract.md](./dual-model-typed-mutation-handoff-contract.md).

## Verdict table

| Surface | Where | State vs staging `2376914c8d` | Verdict |
|---|---|---|---|
| Live edit_graph typed-mutation path | `src/orchestrator/tools/edit-graph.ts` → `src/orchestrator-v5/tools/handlers/d1-shared/apply-graph-mutation.ts` → `src/orchestrator-v5/handlers/edit-graph-dispatch.ts` | LIVE | **Authoritative apply seam.** All future candidate mutations must terminate in `applyAndValidateMutation()` (clone → mutate → GraphV3 re-parse → `GRAPH_INVARIANT_VIOLATED` on failure). |
| Graph proposal spine (PR #300) | branch `claude/v6-graph-mgmt-spine` @ `2827a05b7` (worktree `v6-graph-mgmt-spine`) | 17 commits behind; off-path — no-live-import claim: `git grep -n "orchestrator-v5/graph-management" origin/staging -- src/` returned 0 hits, 2026-07-02 (the module exists only on the #300 branch) | **Design source, superseded as a PR.** Reuse the *contract*: `ProposalKind`, verdicts (`would_apply`/`held`/`clarify_required`/`stale`), `base_graph_hash` stale gate, EP2 readiness parity, blocker codes. Do NOT merge/rebase #300 itself — re-cut the module fresh inside a T4 slice. |
| Structured-outputs spike | branch `claude/v6-structured-outputs-spike` @ `e22760f37` (worktree `olumi-assistants-v6-structured-outputs-spike`) | evaluator tooling only; deliberately defines NO mutation schema | **Doctrine source.** Fail-closed parsing rules (stable discriminator, `.strict()` per-kind payloads, redacted `{path, code}` diagnostics, identity + provenance fields) are adopted by the hand-off contract. Branch itself needs no action. |
| Context-frame authority map | branch `claude/v6-context-frame-state-map` @ `106d2164a` (worktree `vibrant-tharp-978201`), doc `Docs/v6/context-management-authoritative-state-map.md` | doc-only, unpushed | **Valid, load-bearing.** Supplies the binding rule the contract depends on: frame = pure composition over already-resolved authorities (freshness / canonical-analysis-state / recent-changes / graph-hash); no re-derivation. Should land with the T4 canonical-state slice. |
| Frame builder Increment 2a (PR #315) | branch `claude/v6-frame-builder-increment-2` @ `ee5bc38c85` (draft PR) | 3 behind; inert by design | **Valid; T4 entry slice.** See the T4 decision packet for byte-identity verification and next action. |
| EP2 edit-safety worktree | worktree `ep2-edit-safety` (detached @ `7479cda49`) | detached, historical | **Superseded.** EP2 readiness-parity logic survived into #300's `readiness-parity.ts`; the worktree is an audit artefact. Retire. |
| Dual-draft merge/guards (T3 — hands-off) | worktree `epic-benz-7fd0a9`, uncommitted `src/cee/dual-draft/*` | uncommitted, separate live workstream | **Producer-contract source (read-only).** Frozen `EnrichmentInput/Outcome`; `ProposalEnvelope` (7 kinds, cap 8); guards G5/G10/G11/G12/G14. The hand-off contract is written to receive THIS shape without T3 changing. No file in it may be touched by T4.0 work. |
| Proposal/pending machinery (live) | `StoredProposal` two-turn confirm, `PendingAction` (`src/orchestrator-v5/session/pending-action.ts`), flip-proposal builder (`src/orchestrator-v5/compose/flip-proposal.ts`) | LIVE | **Authoritative consumer surface** for `held` / deferred candidate mutations. |
| Signature-loop lane | branch `claude/elegant-sinoussi-17963d` (unpushed) | duplicate of staging merge `c24d38cac` (byte-identical report + tests) | **Dead duplicate — abandon** (see T4 decision packet). Listed here only because its carry-forward/expiry semantics are relevant prior art for proposal-consumption rules. |

## Conflict notes

- The only *code* overlap risk among the above is `src/orchestrator-v5/graph-management/`
  (exists solely on #300's branch). Re-cutting the module fresh avoids inheriting its
  17-commit-stale base and its PR history.
- Nothing in this map collides with T1 (`tools/golden-journey-harness/*`), T2
  (`tests/contract/*`, workflow file), or T3 (`src/cee/dual-draft/*` — untouched).
- Forbidden-until-T4 surfaces confirmed untouched by T4.0 deliverables: `turn-executor.ts`,
  `src/orchestrator-v5/context/*` (freshness, canonical-analysis-state, graph-hash,
  recent-changes), `src/orchestrator-v5/session/supabase-store.ts` (persistence), routing.
