# Lane 31 — adopt @talchain/schemas 0.14.0 (D-F1 rollout step 2; FIRST consumer)

**Branch:** `claude-lane31/schemas-bump-0140` (base: `origin/staging` @ `20821685c`)
**Spec of record:** olumi-schemas `main` @ `5612e266632bd759d4b5457923e58517b3a0f531` —
`docs/enrichment-v1/ROLLOUT.md` (step 2) + `contract-tests/README.md` §CEE lane.
**Scope owned:** `vendor/`, `package.json`/`pnpm-lock.yaml` schemas pin,
`tests/contract/` (two new specs), the two export keywords in
`src/orchestrator-v5/compose.ts`, one new fixture + metadata entry.
**Not touched:** telemetry registry (no new event names), reserved staging
scenarios (`1909b083*`/`def3cb31*`/`8e0bf73d*`/`90385279*`/`104d65bd*`),
ingress validators, handlers, prompts, any behavioural code path.

## Why this lane exists (the two payloads)

1. **Defuses the 0.13.0/0.13.1 strict-422 ingress skew.** 0.13.1's only
   delta is two OPTIONAL keys on `MessageTurnPayloadSchema`
   (`generate_model` / `explicit_generate`). The schema is `.strict()`, so
   CEE on 0.13.0 REJECTED any `kind:'message'` turn carrying either key
   (B1 `validateIngress` → 422 `INGRESS_CONTRACT_VIOLATION`, fail-closed;
   the route-v2-preflight strip-list does not cover the flags). The
   landmine had not detonated only because the UI's live V5 payload
   builder does not emit the flags yet. **With this pin CEE ACCEPTS
   them** — per ROLLOUT.md ordering, CEE (the validator) must be ≥0.13.1
   BEFORE any UI change emits the flags on `/orchestrate/v2/turn`. The UI
   lane (rollout step 4) is unblocked once this is deployed to staging.
2. **Adopts the typed enrichment envelope (0.14.0)** and installs the CEE
   lane of the wire-shape contract-test pack, including the keep-list
   drift bolt.

0.14.0 is a superset of 0.13.1; both deltas over 0.13.0 are ADDITIVE
(no transport field changes, no strictness changes). CEE code imports
only 0.13.0-era names, so nothing breaks and no behaviour changes until
code opts in to the new envelope types.

## Commits (staged execution)

### 1. Vendor bump (`79137737a`)

- `vendor/talchain-schemas-0.14.0.tgz` — built from olumi-schemas `main`
  @ `5612e2666` (tag `v0.14.0`, published to GitHub Packages) via
  `npm ci && npm run prepublishOnly && npm pack` (lint + build + 646
  tests green at pack time). sha256
  `4e4915552a36654b7736eb56d42740e44b5c655209b606882782c55aff749767`;
  lockfile integrity `sha512-CUTJk8xf…` matches the pack output.
- `vendor/talchain-schemas-0.14.0.tgz.sha256` — dep-audit manifest; the
  pre-push `scripts/validate-tarball-sha.sh` gate verified green.
- 0.13.0 tarball + manifest retired (single-current-version policy).
- `package.json` `file:` pin flipped; `pnpm-lock.yaml` delta is exactly
  the schemas specifier/integrity swap (lockfileVersion still 9.0).
- **node_modules:** NO tracked delta — `@talchain/schemas` paths are not
  in the tracked set. The 911-file worktree `pnpm install` churn (known
  DL-9 noise class, reproduced byte-identically BEFORE any change was
  made) was inspected and restored, not committed.

### 2. Contract tests + drift bolt (`767bcd640`)

- `tests/contract/plot-to-cee.contract.test.ts` — persisted PLoT `/v2/run`
  envelope parses against `AnalysisEnrichmentSchema`; load-bearing
  run-analysis.ts read-paths pinned PRESENT; silent-empty reads pinned
  ABSENT (`results`, `robustness.recommendation_stability`,
  suppressed-variant constraint numbers).
- `tests/contract/cee-to-ui.contract.test.ts` — **drift bolt**:
  `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` (compose.ts) `===`
  `CEE_UI_ENRICHMENT_KEEP_LIST` (`@talchain/schemas/boundary`)
  element-for-element; the REAL `toSafeTransportEnrichment` projection
  (imported, not mirrored) parses against the schema, ships no internal
  carrier at any depth, membership pins (11 keys, `m1_coaching`
  deferred).
- `src/orchestrator-v5/compose.ts` — `export` added to the keep-list
  const and `toSafeTransportEnrichment` (test-only; lock-step comment
  points at the schemas source of truth).
- Fixtures: REAL capture path is the repo's own
  `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`
  (`blocks[0].enrichment` — verified byte-equal to the schemas-repo
  mirror); CODE-DERIVED doctrine-B fixture mirrored in and registered in
  `fixture-metadata.json`.

## RED demonstration (drift bolt is behavioural)

Perturbed the compose.ts keep-list locally (appended a 12th key
`lane31_drift_probe`): exactly the drift-bolt test flipped RED
(1 failed / 7 passed in the file); reverted; suite green again. The bolt
fails on ANY element-for-element divergence (order, membership, count).

## Gate results (at `767bcd640`)

| Gate | Result |
|---|---|
| `pnpm typecheck:src` (tsc -p tsconfig.build.json) | clean |
| `scripts/ci/typecheck-ratchet.sh` (baseline 462) | 462 == 462, no new erroring files (one baseline file now fixed) |
| `pnpm test:required` | 953 files / 18,956 tests passed, 0 failed |
| `scripts/validate-tarball-sha.sh` | SHA OK (`4e49155…`) |
| Drift bolt RED check | fails on perturbation, green on revert |

## Rollback

Revert both commits (or the squash-merge commit); `pnpm install`
repopulates node_modules from the restored 0.13.0 tarball. NOTE:
rollback re-arms the strict-ingress landmine — the UI must not be
emitting `generate_model`/`explicit_generate` while CEE sits on ≤0.13.0.

## Follow-ups (not this lane)

- PLoT lane (rollout step 3): 0.13.1 → 0.14.0 + producer-side
  `AnalysisEnrichmentSchema.safeParse` assertion + ISL→PLoT contract test.
- UI lane (rollout step 4): 0.13.1 → 0.14.0 + CEE→UI contract test;
  may emit the generate flags only AFTER this lane is deployed to staging.
- Optional (README §CEE lane item 5): validate freshly captured staging
  envelopes in the cross-service capture harness with
  `AnalysisEnrichmentSchema.safeParse`.
- Replace the doctrine-B CODE-DERIVED fixture with a live capture once a
  constraint-bearing analysis is exercised on staging (fresh scenario —
  reserved scenarios are hands-off).
