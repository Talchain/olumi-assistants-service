# Archived replay portability — separate from response-window integrity

The coordinator assigned this tools/checkout correction after the frozen
`d454d98d13197c66ccd8f86043655f60da4d20fd` response-window candidate. It changes
no serving path, prompt, model routing, provider capture or semantic oracle.

## Reproduced first loss

The required CI job supplies `actions/checkout` full history; the full advisory
job did not. A real local-file, depth-one clone of d454 reproduced the original
fixture's `git diff` failure: archival runtime
`3a79b4057b238a5a80d773310f8da076d2922f0a` was unavailable. The source also
assigned the worktree path before successful creation, then unconditionally
attempted to remove it in teardown. This is a candidate portability issue, not
an inherited security failure or deployed product defect.

The runtime lives on another branch, not this feature's ancestry. The archived
recorder must also be present; its head is derived from the immutable capture,
not duplicated as a new fixture constant. Merely deepening the feature branch
does not satisfy the source authority.

## Small correction and controls

- The existing full advisory checkout now supplies all branch history, matching
  the required job. No tests, jobs, gates or time limits are disabled.
- Offline replay checks exact runtime/recorder objects before allocating a
  worktree. Missing history fails explicitly; no fetch, current-source fallback
  or successful skip is allowed. Implicit Git lazy fetching is disabled too.
- Only successfully created worktrees are removed. Cleanup runs after replay
  success or failure, and any original failure is retained.
- A failed setup remains a failed suite; teardown does not replace it with an
  unrelated collection error. Successful setup still asserts all eight named
  archival replay cases were collected.

`replay-worktree.test.ts` exercises actual Git shallow/all-branch history and
owned worktree lifecycle. It also parses the actual CI job: removing full
history is RED; changing only its display name is GREEN. These are environment
controls, not synthetic substitutes for the production parser/consumer.
`local-response-identity.test.ts` retains the original eight real archived
parser/consumer and provider-identity controls plus its exercised network guard.

Replay: `pnpm exec vitest run --config vitest.required.config.ts tools/prompt-consumer/replay-worktree.test.ts tools/prompt-consumer/local-response-identity.test.ts --maxWorkers=1`.
Run from a full-history checkout with the existing pinned dependencies. Consult
the exact-head PR delivery for results: an unavailable source or timed-out
archival replay is not PASS. No new provider draw is needed or authorized.

This axis must be reviewed separately from cross-cutoff request-ID/body
uniqueness. Full deployed response identity remains UNVERIFIED; production
telemetry remains deferred by Primary until post-Monday.
