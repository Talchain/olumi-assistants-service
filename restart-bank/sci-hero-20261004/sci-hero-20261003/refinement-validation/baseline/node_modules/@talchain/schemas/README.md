# @talchain/schemas

Shared TypeScript schemas and runtime validation for Olumi's boundary contracts. Single source of truth for wire-format types consumed by UI, CEE, PLoT, and ISL.

For curated meaning, source authority and the preserved v2.6 FRAME reconciliation, see [Decision-model semantics](docs/decision-model/README.md) (document revision 2.7, separate from the package version).

## Installation

Configure your `.npmrc` for GitHub Packages:

```
@talchain:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then install:

```bash
npm install @talchain/schemas
```

**⚠ That is not how the Olumi services consume this package today.** All three
(`DecisionGuideAI`, `plot-lite-service`, `olumi-assistants-service`) pin a
checked-in tarball — `"@talchain/schemas": "file:./vendor/talchain-schemas-<v>.tgz"` —
each with a `.tgz.sha256` manifest beside it (CEE and the UI additionally
enforce that hash with a checked-in guard script). Upgrading one is a
**re-vendor PR in that repo**, following its own `vendor/README.md`; a registry
`npm install --save-exact` would rewrite the `file:` pin and, on CEE, trip the
guard. See [`CLAUDE.md`](./CLAUDE.md) § Publish model.

## Usage

```typescript
import {
  GraphV3Schema,
  NodeV3Schema,
  EdgeV3Schema,
  LIMITS,
  validateGraphLimits,
  CIL_WARNING_CODES,
  STRENGTH_DEFAULT_SIGNATURE,
} from '@talchain/schemas';

// Validate a graph
const graph = GraphV3Schema.parse(rawData);

// Check PoC limits (schema is permissive; limits are checked separately)
const violations = validateGraphLimits(graph);
if (violations.length > 0) {
  // Handle over-limit graph
}
```

All Zod schemas export inferred TypeScript types:

```typescript
import type { NodeV3, EdgeV3, GraphV3, ValidationWarning } from '@talchain/schemas';
```

## Package contents

| Module | Exports |
|--------|---------|
| `graph.ts` | `NodeV3Schema`, `EdgeV3Schema`, `GraphV3Schema`, `NodeKind`, `FactorCategory`, `StrengthSchema`, `ObservedStateSchema`, `StateSpaceSchema` |
| `analysis.ts` | `OptionForAnalysisSchema`, `AnalysisReadyV3Schema`, `ResponseMetaSchema`, `AnalysisRequestIdChainSchema`, `ProductReadiness`, `SeedSource`, `DetailLevel` |
| `warnings.ts` | `ValidationWarningSchema`, `CIL_WARNING_CODES`, `CIL_WARNING_SEVERITY`, `STRENGTH_DEFAULT_SIGNATURE`, threshold constants, typed detail schemas |
| `cee-errors.ts` | `CeeErrorCode`, `CeeTypedErrorSchema`, `CeeTimeoutErrorSchema`, `CeeBudgetErrorSchema`, `CeeUpstreamLlmErrorSchema` |
| `plot-errors.ts` | `PlotProxyTimeoutErrorSchema`, `PlotCeeUpstreamEnvelopeSchema` |
| `repairs.ts` | `REPAIR_CODES`, `RepairEntrySchema`, `RepairLayer` |
| `limits.ts` | `LIMITS`, `validateGraphLimits()` |
| `enums.ts` | Re-exports: `NodeKind`, `FactorCategory`, `ProductReadiness`, `SeedSource`, `DetailLevel`, `RepairLayer` |

## Error ownership model

Error codes are owned by the service that generates them:

| Code | Owner | Schema |
|------|-------|--------|
| `CEE_LLM_TIMEOUT` | CEE | `CeeTimeoutErrorSchema` |
| `CEE_REQUEST_BUDGET_EXCEEDED` | CEE | `CeeBudgetErrorSchema` |
| `CEE_LLM_UPSTREAM_ERROR` | CEE | `CeeUpstreamLlmErrorSchema` |
| `CEE_LLM_VALIDATION_FAILED` | CEE | `CeeTypedErrorSchema` |
| `CEE_CLIENT_DISCONNECT` | CEE | `CeeTypedErrorSchema` |
| `CEE_INTERNAL_ERROR` | CEE | `CeeTypedErrorSchema` |
| `CEE_PROXY_TIMEOUT` | **PLoT BFF** | `PlotProxyTimeoutErrorSchema` |
| `CEE_UPSTREAM_ERROR` | **PLoT BFF** | `PlotCeeUpstreamEnvelopeSchema` |

Do not create CEE errors in PLoT or PLoT errors in CEE. The `CeeErrorCode` enum only contains CEE-owned codes.

## `field_path` convention

Repair entries and validation warnings use JSONPath-style field references:

```
edges[0].strength.std
edges[3].exists_probability
nodes[2].observed_state.value
```

Array indices are zero-based. Paths refer to the canonical graph structure.

## Semver policy

| Change type | Version bump | Example |
|-------------|-------------|---------|
| New schemas, new optional fields, new enum values | **Minor** | Adding `DraftGoalConstraintSchema` |
| Bug fixes, documentation, internal refactors | **Patch** | Fixing regex pattern |
| Field removal, type changes, stricter validation | **Major** | Removing `.passthrough()`, renaming fields |

Note `@talchain/schemas` is **0.x**, so per semver-caret the breaking axis is the
**minor**, not the major — `releaseLine('0.24.1') === '0.24'`
(`src/contracts/health-manifest.ts`). Compatibility between two services is
judged on release lines.

## Unknown-key policy

**This is not uniform, and assuming it is has cost time.** Each namespace makes
the opposite trade-off, and a nested schema often differs from its parent. The
counts below were derived at `0.25.x` by introspecting `_def.unknownKeys` on
every object schema exported from each entry point — read the code, not this
table, when it matters.

| Entry point | Exported object schemas | Policy |
|---|---|---|
| `@talchain/schemas/orchestrator` | 40 strict · 0 passthrough · 0 strip | **100% `.strict()`.** |
| `@talchain/schemas/boundary` | 45 strict · 27 passthrough · 0 strip | **Split by role** — see below. |
| `@talchain/schemas` (root) | 9 strict · 17 passthrough · 9 strip | Mostly tolerant; the graph/analysis/warning wire types are `.passthrough()`. |

- **`/orchestrator` is `.strict()` everywhere.** These are CEE-internal shapes —
  handler args, handler results, the `HandlerFact` union, session rows — and
  they describe the JSONB persisted in `handler_facts.payload`. Strictness is
  the point: an unknown key on a persisted fact is a bug, not forward
  compatibility. **Consequence: you cannot add a field to a handler result
  without a package release**, and an old reader will *reject* a fact written by
  a newer writer, which makes rolling deploys reader-first.
- **`/boundary` splits by who owns the bytes.** Producer-owned envelopes and
  block types are `.strict()` — `OlumiResponseSchema`, every `BlockSchema`
  member, the turn payloads, `V2RunRequestSchema` / `V2RunResponseSchema`. The
  PLoT enrichment family (`AnalysisEnrichmentSchema` plus its 19 exported
  `Enrichment*` members) and the graph types (`GraphV3Schema`, `NodeV3Schema`, `EdgeV3Schema`)
  are `.passthrough()`. A `.strict()` parent with a `.passthrough()` child is
  normal here and deliberate.
- **Root is mostly `.passthrough()`** for forward compatibility, with the
  coaching / causal-claim / health-manifest families `.strict()`.

Where a schema *is* `.passthrough()`, consumers should handle unknown fields
gracefully. Where it is `.strict()`, they must not receive them at all.

### Canonical committed-graph receipts

`DraftGraphBlockSchema` is the backwards-compatible reader for the existing
`OlumiResponse.draft_graph` field. Older producers may omit `options`,
`goal_node_id`, and `goal_constraints`; that omission means the receipt is
partial, not that the corresponding committed state is empty.

Transactional producers use `CanonicalCommittedGraphReceiptSchema` (or its
block-discriminated twin). It requires own keys for all five canonical hash
carriers. Explicit absence is `options: []`, `goal_node_id: null`, and
`goal_constraints: []`. Counts are derived metadata and must describe the same
node/edge arrays; the canonical producer schemas enforce those equalities, and
counts are not a second graph identity. The contract exports a
complete hash-carrier/derived-metadata classification but intentionally no hash
or readiness implementation. The versioned
`CANONICAL_GRAPH_HASH_NESTED_PROJECTION` is the one nested field vocabulary;
CEE's canonical digest imports it, while clients can use it for receipt
reconciliation without mirroring CEE source. Ordering, canonical JSON and the
digest remain CEE-owned.

### Response-only model-building notices

`ModelBuildingNoticesSchema` is the strict aggregate-only carrier for optional
`OlumiResponse.model_building_notices`. It exposes closed construction-kind
codes and positive counts only, requires unique kinds and exact sum equality,
and requires `details_redacted: true`. It deliberately has no labels, values,
node ids, source text or raw reasons.

The notice is ephemeral response metadata, not part of the living model's
authored graph. It is not declared on `DraftGraphBlockSchema` or
`CanonicalCommittedGraphReceiptSchema`, so those strict schemas reject any
attempt to carry it into graph/receipt persistence, hashing, compute or context.
Absence means no attestation was supplied, never zero. A UI maps kind codes to
neutral model-building copy; they are not conclusions and must not be rendered
as human-authored “you said” claims.

### The composed analysis-state verdict

`AnalysisStateV1Schema` is the optional top-level `OlumiResponse.analysis_state`
— ONE composed verdict per turn covering run state, readiness, leader
entitlement, robustness and usability. It exists because each surface currently
derives its own answer to "what is the state of the analysis, and what may I say
about it" from a different subset of the payload, and the derivations disagree.
A verdict composed once by the producer is the structural fix.

`run_state` is a seven-branch discriminated union on `kind`, every branch
`.strict()` and declaring only what its kind can honestly carry — so a `refused`
state cannot smuggle a `computed_at`. `refused` is the new state: this turn
declined to analyse, so any visible result is from an earlier run whose currency
is not vouched for. An unknown `kind` fails to parse.

`leader_claim.permitted` is a CONJUNCTION verdict (CEE constraint entitlement ∧
engine statistical separation). A ranked leader or ordinal may render only when
it is true AND `run_state.kind` is `complete_current`; withholding drops the
DESIGNATION and keeps the DATA, so win probabilities stay shown.

The `.describe()` strings on this shape are the specification — a consumer may
quote them as licence, and the contract is earmarked for a one-shot external
adjudication before any UI consumer migrates. Three limits the parser does NOT
enforce are named in the module header and pinned by tests.

## Adding new schemas

**First check whether the vocabulary already exists as a checked-in artefact
under `contracts/`. If it does, GENERATE the schema from it rather than
hand-writing one that restates it.** `src/contracts/generated-population-ref.ts`
is the worked example: `PopulationRefSchema` is built from
`contracts/population-registry.json` by `scripts/generate-population-ref.mjs`, and
`npm run generate:population-ref:check` (in the PR gate) fails if the artefact and
the registry ever disagree. A hand-written mirror of a vocabulary this repo
already owns will drift, and the drift reads as green.

**Second, if the shape has states where a member is meaningless, make it a
DISCRIMINATED UNION rather than a flat status field beside an optional member.**
`src/contracts/analysis-fact.ts` is the worked example (0.27.0): `ComputedFact`
requires `value`, while `UnavailableFact` and `SuppressedFact` **do not declare
`value` at all** and are `.strict()` — so a withheld metric carrying a number
fails to parse. The flat alternative (`status: 'suppressed'` beside an optional
`value`, or beside a separate value map) parses the contradiction happily and
leaves the invariant to producer discipline it cannot enforce. A rule the type
system can hold should never be left to a convention.

1. Create or edit the relevant file in `src/`
2. Define the Zod schema, matching the **namespace's** unknown-key policy above
   — `.strict()` under `/orchestrator`, `.strict()` or `.passthrough()` under
   `/boundary` per the split described there
3. Export inferred type via `z.infer<typeof Schema>`
4. Add exports to the namespace's `index.ts`
5. Register a maximal fixture in `src/fixtures/index.ts` (or a documented
   exclusion) — the completeness ratchet fails otherwise
6. Add tests in `tests/`
7. Bump version in `package.json` per semver policy, add a CHANGELOG entry, and
   run `npm run generate:contract-constants` (a version bump changes `SCHEMA_SHA`)
8. Open a PR. Merging to `main` publishes; **adoption in each consumer is a
   separate re-vendor PR in that consumer's repo** — all three consumers pin a
   checked-in `file:` tarball, not a registry version, so nothing here updates
   them automatically. See `CLAUDE.md` § Publish model.

## Development

```bash
npm ci            # Install dependencies
npm test          # THE GATE — check:contracts && build && vitest run
npm run build     # Compile to dist/ (tsc)
npm run lint      # tsc --noEmit; same tsconfig as build, so no extra coverage
```

`npm test` is a superset of what `.github/workflows/pr.yml` runs. `tsconfig.json`
excludes `tests` and `fixtures`, so **no test file is typechecked by any gate**.
Contract-evolution rules, the S0 conventions, the publish model and this repo's
hazards are in [`CLAUDE.md`](./CLAUDE.md).
