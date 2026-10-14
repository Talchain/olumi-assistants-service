# #2879 test rebind onto #2878

8 October 2026. Working tree: `/private/tmp/accel-er-b2scope-cee`.
Branch: `dl/b2-zero-spread-when-none-licensed`.
HEAD asserted before and after work:
`335528888d77f00a4d4f279f094e09f6897b2bfa`.
Independent staging control:
`69ff73cf180efb4099c10446197661a33f9777da`.

**Rebinding and staging regeneration are complete; the B2 suite remains RED in
three rows because staging's canonical projector leaks Raise's option-scoped
identity warning into Keep's `why`.** The requested expectation remains intact.
No production correction, commit or push was made; `supabase/` is untouched.

## Rebound contract

`b2-zero-spread.test.ts` selects Keep by `option_id` and requires the exact cell:

```json
{
  "kind": "withheld",
  "reasons": [{"code": "zero_spread", "message": "Not shown yet: needs month-by-month changes"}],
  "face": "Chance not shown yet",
  "why": "Not shown yet: needs month-by-month changes"
}
```

The three named zero-spread rows assert this complete object and exact `why`
bytes. The selector row changes the recorded reason message and `why`, keeping
the short face. Every generated canonical view checks every cell's `face` and
`why` for the prohibited substring `not shown yet in this model`.
The negative controls still require `reason_not_recorded` with a licensed point
and `{ kind: 'none' }` with no spread and no licensed point.

The all-withheld non-Keep comparison now uses the independently regenerated
staging control rather than the old wire's pre-#2878 canonical copy. Starter's
existing range dominates its control point. The Starter-point control verifies
byte equality of the licence, enrichment, transport, Agent facts, screen lines
and all non-Keep canonical content before asserting Keep's required cell.

## Independent staging provenance

The fixture was generated from staging's own producer, transport, canonical
projector and Agent readers in a detached worktree at the full pinned SHA.
[Generator](../../src/routes/__tests__/fixtures/b2-zero-spread/generate-staging-control.ts)
and exact reproduction commands/SHA are recorded in the
[fixture README](../../src/routes/__tests__/fixtures/b2-zero-spread/README.md).
All original witness warnings and both witness files remain unchanged.

The initial `git worktree add --detach` was rejected by the filesystem sandbox
because the shared Git metadata is outside writable roots. A temporary shared
bare repository under `/private/tmp` supplied writable metadata for the
detached worktree at `/private/tmp/b2zs-staging-69ff`. Its `node_modules` was
symlinked from `/private/tmp/accel-er-event-cee/node_modules` as requested.
The generator asserts detached HEAD, clean tracked source and committed hashes;
all executable source imports point into that staging worktree, never this
branch. [Generator evidence](rebind-generator.json) records gate exit 0,
generator exit 0, source hashes and actual output cells.

Fixture SHA-256:
`3dbbdc4b02038cac8e965cf7c202c93c00a0e131397a9af4a7dee59b1f8a499d`.
The detached worktree and its temporary bare metadata were removed after
verification. [Cleanup evidence](rebind-worktree-cleanup.json).

## Remaining production defect

The stored `GOAL_FIGURES_TARGET_NOT_TESTABLE` warning has
`option_ids: ['raise_prices_10']`. In the unchanged staging
`canonical-analysis-view.ts`, `goalIdentityWithheldMessage` reads the full Run's
warnings without applying their option scope; its run-wide `identityMessage`
then precedes Keep's own `withheld_reason_by_option[KEEP].line`.

The all-withheld and Starter-point rows receive the correct kind, short face
and zero-spread reason, but their `why` is Raise's long sentence beginning
`Not shown. Olumi can compare your options`. The selector changes Keep's stored
reason but that same unrelated sentence continues to override its `why`.
The reviewer row clears warnings and passes the full requested Keep contract.
The regenerated staging fixture records the actual scope leak rather than
rewriting its output to the expected line.

This remains a tests-only rebind. A production scope correction requires a
separate change: apply the existing per-option warning scope before selecting
identity copy, while retaining identity → certainty → carried line → label
licence line → fallback precedence. The required Keep assertion was not
weakened and witness warnings were not removed to make it pass.

## Validation

Every generator/check process ran sequentially after a fresh Node load gate:
`Number.isFinite(os.loadavg()[0]) && os.loadavg()[0] < 25`.
The launcher checks the gate's **exit code** and skips launch on refusal.
All processes receive closed stdin through `/dev/null`. Test runs name at most
two files and use one worker, no file parallelism and `--configLoader=runner`.
Exact commands, load values and gate/process exits are retained in
[rebind-checks.jsonl](rebind-checks.jsonl) and the
[runner](run-rebind-checks.py).

| Check | Result | Evidence |
| --- | --- | --- |
| B2 + zero-spread certainty, final tree | Exit 1; B2 14/17 passed, certainty 6/6 passed; three B2 `why` failures described above | [Final log](rebind-b2-certainty-final.log) |
| Canonical analysis view + face suites | Exit 0; 29/29 passed | [Canonical log](rebind-canonical.log) |
| ESLint, both changed TypeScript files | Exit 0 | [ESLint log](rebind-eslint-changed.log) |
| Full `NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit` | Exit 2; 290 diagnostics; **0 in either changed TypeScript file**. No global pass claimed | [Full diagnostics](rebind-tsc-full.log) |
| Early-return mutant | Green → red (exit 1) → green; restored exact source bytes | [Mutant log](rebind-mutant-old-return.log) |
| No-point-gate mutant | Green → red (exit 1) → green; restored exact source bytes | [Mutant log](rebind-mutant-no-point-gate.log) |

The early-return mutant reinstates
`if (option_ids.length < 2 || licensed.length === 0) return null;`.
It is isolated using the existing `no licensed point means no scoring-threshold`
row, whose baseline passes independently of the canonical defect. The mutant
returns null and fails `not.toBeNull()`. This makes the kill meaningful even
though the full B2 suite already contains the three independent `why` REDs.

The no-point-gate mutant removes only `hasLicensedPoint &&` from the existing
withhold-reader fallback. Its baseline reviewer row passes; the mutant makes
Starter receive `reason_not_recorded` instead of `[]`; restoration passes again.
Both mutations are restored in `finally`, with current before/after SHA-256
equality recorded in [restoration evidence](rebind-mutant-restoration.json).

Final source/head/fixture checks are in
[rebind-final-state.json](rebind-final-state.json). Canonical production source
is still byte-identical to staging; both mutant source files match HEAD.
The remaining changes are test rebinding, fixture/provenance and local evidence.
