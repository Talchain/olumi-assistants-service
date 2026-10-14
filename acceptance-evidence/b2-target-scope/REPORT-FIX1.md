# #2860 FIX-1 — evidence-led CI repair

## Scope and identity

- Worktree: `/private/tmp/accel-er-b2scope-cee`; branch: `dl/b2-per-option-target-withhold`.
- Before any edit, HEAD was asserted equal to `a4981a7afc5511fff9bf042573a6c1f158a43af8`; the working tree was clean. HEAD remains that SHA.
- Science §(aa) governs: only options with their own scoped failures lose target claims; goal-level a/b/d remain global; typed class 1 and self-attested class 2 dependencies remain active.
- No commit, push, allow-list change, or `supabase/` edit. The served M1 fixture remains byte-identical to HEAD.
- Evidence rung: local source/probe and real-handler in-process tests. No deployment or live-user acceptance claim.

## CI census

Decoded logs from CI run [37805655370](https://github.com/Talchain/olumi-assistants-service/actions/runs/37805655370), jobs `113409111545` (4/5) and `113409111351` (5/5), identify **three failing files and five failing rows**, rather than four failing files. Both jobs tested merge `d55877c72be620f2c8905eb2921b9dfc6855eef3`, combining the requested head with base `2cf61b60bb8eec079cb3e5a6f6843ecaf69eb588`. Exact failure excerpts: [FIX1-CI-failures.log](FIX1-CI-failures.log).

All three failing files were rerun. The changed `run-analysis-target-not-testable.test.ts` contract was also checked, alongside the full prior B2 core population and the one new staging test.

## Row decisions and reasons

### 1. Tier-3 static guard — production fix

The exact new reference introduced by this PR was `run-analysis.ts:3882` at the asserted head:

```ts
const warnings = (response as Record<string, unknown>).inference_warnings;
```

It passed the warning array as the fifth argument of `optionPathsOf`. That array reached `goalBaselineFromIdentityInputs`, whose fallback accepted `GOAL_LEVEL_FROM_IDENTITY_INPUTS` by `node_id`, exact structural `field`, or sole-goal identity. This was a new warning-channel read in a user-facing producer.

Removed that read and the warning parameter/fallback throughout the dependency helper and range scoping seam. Class 2 now uses only an evaluation with `level_source: 'identity_inputs'`, the selected goal ID, and that same evaluation's own validated `evaluated: true` attestation and declared operation/operand set. No claim-safety exception was needed and the static allow-list is unchanged.

The core positive class-2 evaluation remains. Three negative controls prove warning-only markers cannot create the dependency, covering node ID, exact field, and sole-goal fallback. Existing false/mismatched evaluation controls remain. The other-goal and non-input side-branch controls now use valid typed evaluations, preserving those claims after removing warning-based attestation.

### 2. Three guided r9 rows — expected opening only

Every row uses D1, whose held baseline is `0.24`, threshold `0.252`, comparator `>=`, and units match `£/month`. There is no a/b/d failure and no `nonlinear_identity` carrier. Raise's intervention path is its price/churn branch; Keep has no intervention seed; only Starter reaches these failing links.

| Row | Own P5/c failure | Decision |
| --- | --- | --- |
| Inspector user band | `starter_tier_mrr → monthly_recurring_revenue` | Scoped opening is intended. |
| Refused conversion, `user_specified` | Above link plus `starter_tier_support_cost → mrr_lost_to_starter_support_strain` | Both links belong only to Starter; scoped opening is intended. |
| Refused conversion, `user_stated` | Same two links | Same scope and decision. |

Changed only the expected opening, using the existing complete warning text with:

```ts
.replace("I can't yet say how likely any option is", "I can't yet say how likely ‘Launch starter tier’ is")
```

Every other expected word remains identical. This retains `You set this link as moderate.` in the inspector row's complete expected sentence, every no-Olumi-band assertion, and the existing recovery/action/progress assertions. No guided production code changed.

### 3. Horizon beside TARGET on served M1 — code regression, original fixture retained

The probe loaded exact source snapshots from current staging `53a68cd6e50eee2a30110cd68e859f8edda3c8be` and the requested head `a4981a7afc5511fff9bf042573a6c1f158a43af8`. Their target-verdict source is byte-identical. The original CI base `2cf61b60b` produced the same result; current staging's single additional commit changes only two route-test files.

**Probe output at both snapshots:**

```json
{
  "kind": "not_testable",
  "goal_id": "mrr",
  "failures": [{
    "case": "c",
    "precondition": "P5",
    "code": "goal_path_placeholder",
    "links": [{"from": "monthly_churn_rate", "to": "paying_subscribers_at_12_months"}]
  }]
}
```

| Option | Staging scoped failures | Head scoped failures |
| --- | --- | --- |
| `59_price` | P5/c, `monthly_churn_rate → paying_subscribers_at_12_months` | Identical |
| `current_price` | `[]` | `[]` |
| `54_price` | P5/c, same link | Identical |

No goal-level failure exists. Both price-change options have their own failure. The served body scores `59_price` and `current_price`; `54_price` is in the graph but is not a scored result. The head's typed class-1 walk adds upstream dependency links for the price-change options without changing this failure scope.

Pure earlier-gate probe output:

```json
{
  "productGate": null,
  "placeholderPaths": [{
    "option_id": "59_price",
    "links": [{"from": "monthly_churn_rate", "to": "paying_subscribers_at_12_months"}]
  }],
  "shownBeforeEarlierGates": ["59_price", "current_price"],
  "shownAtTargetGate": ["current_price"]
}
```

The earlier placeholder gate removed £59's figure. The PR then scoped only the remaining shown option, the clean baseline, and silently lost £59's TARGET fact. Under the requested rule, M1's original premise is valid: this was a production regression, so its fixture was not switched.

The producer now scopes all scored options while any goal chance remains shown, retaining earlier-withheld options' own target reasons. Every candidate still passes the one `scopedFailuresFor` implementation. An earlier withhold that emptied all figures still keeps the existing no-second-warning control. TARGET now names only `59_price`; the baseline retains its zero. The original horizon coexistence row remains and additionally pins TARGET's exact option ID.

Full probe and replay script: [FIX1-M1-probe.log](FIX1-M1-probe.log), [FIX1-M1-probe-summary.json](FIX1-M1-probe-summary.json), [FIX1-M1-probe.mts](FIX1-M1-probe.mts). The pure-gate probe is qualified separately from the real-handler test.

### Additional B2/S6 expectations exposed by that code correction

- B2's intermediate earlier-withhold seam now records Starter's own TARGET reason. Raise/Keep still retain their point chances. Once Starter's licensed range is present, the existing range seam removes its TARGET warning. The terminal B2 contract remains clean points beside Starter's 40–51% range.
- S6 R4's captured unseen-1 graph has exactly `fourth_shop_fit_out_spend → monthly_profit` failing P5/c, on `fourth_shop_in_clifton` alone. Its old same-object/no-TARGET expectation failed after the correction. The row now pins that exact failure, fourth-shop-only `option_ids` and `per_option`, and its own link label. It still asserts both clean options retain `0.5`, have no per-option reason, and receive no invented range. This is the same evidenced earlier-withhold correction, not a global re-pin.

## RED → GREEN

| Evidence | RED | GREEN |
| --- | --- | --- |
| Original static + guided files | 4 failed / 26 passed, unchanged production | Final batch: 30 passed. |
| Warning-only dependency controls | 3 failed / 14 passed before removing the reader | B2 core: all 17 passed; static guard also passed. |
| Original served M1 horizon file | 1 failed / 8 passed before candidate correction | All 9 passed, original fixture retained. |
| B2 + target-handler own reasons after earlier withholding | 2 failed / 32 passed before candidate correction | Final core and handler batches passed. |
| S6 R4 old no-TARGET expectation | 1 failed / 26 passed | Final B2/S6 batch: 27 passed with exact own-failure pins. |

Logs: `FIX1-RED-*.log`, `FIX1-GREEN-*.log`, and `FIX1-final-*.log`.

## Staging integration and sandbox boundary

Live staging was verified at `53a68cd6e50eee2a30110cd68e859f8edda3c8be`, one commit ahead of `2cf61b60b`. Its changes add only `src/routes/__tests__/convention-frame-source-wire.test.ts` and `src/routes/__tests__/fixtures/convention-rescue-b1-d2.json`; neither overlaps FIX1.

The normal `git fetch origin staging` failed because the linked Git metadata is `/Users/paulslee/olumi-work/d2-cee/.git/worktrees/accel-er-b2scope-cee`, outside this session's writable sandbox. Shell GitHub access was also unavailable. Used the read-only GitHub connector to import the **exact existing signed staging commit, five changed tree objects and two blobs**, verifying each Git object SHA before importing it into `/private/tmp/b2-fix1-merge.git`. No new commit was created.

Ran a real merge in writable isolated metadata, using the requested working tree and branch:

```sh
git --git-dir=/private/tmp/b2-fix1-merge.git \
  --work-tree=/private/tmp/accel-er-b2scope-cee \
  merge --no-commit --no-ff origin/staging
```

Exit **0**: `Automatic merge went well; stopped before committing as requested`. No conflicts. `MERGE_HEAD` is the exact staging SHA, HEAD stays the requested SHA, and the isolated index contains only the two staging additions. All final tests ran on this merged working tree.

**Boundary:** the original linked worktree's Git metadata and `origin/staging` ref remain unchanged. Its normal `git status` therefore shows the two imported staging files as untracked; the real pending merge/index lives in `/private/tmp/b2-fix1-merge.git`. This is a merged working tree with an isolated pending merge, not an update to the unwritable original metadata. Inspect it using the command prefix above. Import replay, hashes and merge output are in `FIX1-staging-*.json`, `FIX1-staging-import.py`, and [FIX1-staging-merge.log](FIX1-staging-merge.log).

## Final validation

**317 tests / 20 files passed**, in ten sequential batches, including **277 B2 core tests / 16 files**, the three CI-failing files, the changed target-handler contract, and staging's added wire test. Exact commands/counts: [FIX1-green-summary.json](FIX1-green-summary.json).

Before every test invocation, the exit code of `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` gated execution; the runner also recorded the measured load. Every invocation used at most two files, `--maxWorkers=1 --no-file-parallelism --configLoader=runner`, and `< /dev/null`. One gate refused at load `26.8828125`; **no tests ran** on that attempt. Only the unrun remaining batches resumed after load fell. Full attempt history: [checks-fix1.jsonl](checks-fix1.jsonl).

- Full `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit` on the final source: exit 2, **290 errors outside all 16 PR/FIX1/staging-changed TypeScript files, zero in changed files**. Initial and final full-pass diagnostics are identical. The repository-wide typecheck is not clean. Output: [FIX1-tsc-full.log](FIX1-tsc-full.log); counts/source identity: [FIX1-tsc-summary.json](FIX1-tsc-summary.json).
- Full `node_modules/.bin/eslint .`: exit 0, zero errors, two warnings in unchanged files (`trace-captures.ts`, `analysable-option-gate.ts`). Eslint of all 16 changed TypeScript files on the final source: exit 0, zero errors/warnings. Logs and counts: `FIX1-eslint-*.log`, `FIX1-eslint-summary.json`.
- `git diff --check` and isolated merge `git diff --cached --check`: passed.
- Final HEAD/branch, source SHA-256 hashes, unchanged M1 fixture identity and the absence of `supabase/` changes: [FIX1-final-tree.json](FIX1-final-tree.json).

The local FIX1 source/test checks meet the requested changed-file threshold. The staging working tree is integrated and its pending merge is held in isolated metadata; the original linked Git metadata remains unwritable as documented above. No commit or push.
