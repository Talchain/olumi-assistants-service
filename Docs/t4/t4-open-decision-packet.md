# T4 Core Spine — opening decision packet

**Date:** 2026-07-02 · **Baseline:** `origin/staging` @ `2376914c8d` · **Status:** decision
inputs verified live; no T4 implementation performed.

## 1. Signature-loop lane — ABANDON (duplicate proof verified live)

Branch `claude/elegant-sinoussi-17963d` (unpushed, worktree
`.claude/worktrees/elegant-sinoussi-17963d`, HEAD `ecbab45de`, clean, 7 commits atop
`f76872c83`, base 50 commits behind staging).

**Duplicate proof (re-verified 2026-07-02 against live refs):**
- Merge `c24d38cac` — "feat(v5): Signature Loop Reliability" — is present in
  `f76872c83..origin/staging` and its message enumerates exactly this lane's content
  (confirmation/question routing guards, pending-proposal carry-forward,
  refresh-continuation guard, boundary tests, 9-journey acceptance doc).
- `git diff ecbab45de origin/staging` over the branch's signature deliverables shows the
  engineering report (`Docs/v5/v5-signature-loop-reliability.md`) and the integration suite
  (`tests/integration/orchestrator/route-v2-signature-loop.test.ts`) **byte-identical** on
  staging (zero diff).
- All 16 branch-touched files are also touched by the 50 staging commits since the base —
  rebase would be 100% conflict surface for content that already landed.

**Recommendation: ABANDON.** Do not rebase, do not salvage. The branch is unpushed, so
retirement is purely local. Deletion is currently blocked only because the worktree is this
session's active checkout; the exact cleanup (run after the session closes):

```bash
cd /Users/paulslee/Documents/GitHub/olumi-assistants-service
git worktree remove .claude/worktrees/elegant-sinoussi-17963d
git branch -D claude/elegant-sinoussi-17963d
```

**Surviving follow-up (not a reason to keep the branch):** the report's §5 staging
acceptance suite — 9 live journeys — has never been run against deployed staging. Track it
as a T1/assurance follow-up (candidate: fold into the golden-journey capture flow).

This clears the signature-loop T4 blocker.

## 2. PR #315 frame-builder (Increment 2a) — HOLD AS DRAFT; rebase when T4 opens

Verified live:
- Local worktree (`.claude/worktrees/v6-frame-builder-inc2`), commit `ee5bc38c85`, and
  `origin/claude/v6-frame-builder-increment-2` all agree; working tree clean.
- **`build-frame.ts` byte-identity:** blob `b5ec798a62de4b9559bb35a8f5e75137a8ba5488` in
  all three places (worktree file, PR-head tree, remote ref) — the reviewed head is exactly
  what is on disk and on GitHub.
- Changed files: 5 (2 new: builder + test; edits to frame `index.ts`/`types.ts`; 1 doc).
- **Inertness proven:** zero callers/importers of `buildFrame` outside the module + its
  test, on both staging and the branch — claim type: no-live-import; scope:
  `git grep -l "build-frame\|buildCanonicalContextFrame\|CanonicalContextFrame" <ref> -- src/`
  on `origin/staging` and `ee5bc38c85`, 2026-07-02; all hits are the frame module files
  (`index.ts`, `types.ts`, `build-frame.ts`) and its `__tests__/` file. Claim permissions default HELD; graph-hash
  single-sourced from `freshness.current_graph_hash`; source-scan guard test enforces the
  no-re-derivation allowlist. 16/16 tests pass per PR evidence.
- Rebase risk: the 3 staging commits ahead (`3e4b86115`, `475922b30`, `2376914c8`) touch
  zero overlapping files → clean rebase guaranteed.

**Exact recommendation:** keep #315 as the T4 entry slice; when Paul opens T4, rebase onto
the then-current staging tip (mechanical), confirm inertness grep again, land it as
"canonical state" step 1, then wire the first consumer (Increment 2b) as the first live T4
change. No action needed before then — the draft is not rotting (clean rebase, verified).

## 3. Remaining T4-open blockers

| Blocker | State | Needed before |
|---|---|---|
| #305 R2 claim-safety taxonomy (doc PR, OPEN) | not merged | Gate Zero / claim-permission enforcement slices |
| Gate Zero doctrine (Neil/Jinghui) | outstanding | Gate Zero implementation (not slices 1–2) |
| Collision re-check vs #240/#247/#271 lanes | to run at T4 open | typed-mutation + freshness slices |
| T4.0 hand-off contract | delivered by this mission (see contract doc) | typed-mutation slice |
| Signature-loop lane | **cleared (abandon)** | — |

## 4. T4 opening sequence

**Authoritative definition:**
[dual-model-typed-mutation-handoff-contract.md §7](./dual-model-typed-mutation-handoff-contract.md)
— maintained there only, to avoid two drifting copies. In one line each: 1 canonical state
(#315) · 2 context continuity (frame threading) · 3 freshness fail-closed · 4 typed
mutation (this contract) · 5 orchestration proof (golden-journey). Steps 1–2 are unblocked
by this packet; steps 3–5 gate on the §3 blocker register.
