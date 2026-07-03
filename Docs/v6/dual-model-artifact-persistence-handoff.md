# Handoff — wiring M2 artifact persistence (dual-model production branch)

**Status: DECISION REQUIRED (Paul). Nothing described here is wired.**
Branch: `claude/v6-dual-model-production-system` (quarantined; no merge before MVP
prompt-insertion + live smoke + acceptance).

## What exists after this branch (all inert)

| Piece | Where | State |
|---|---|---|
| Artifact contract + caps | `src/cee/dual-model/artifacts/types.ts` | built, tested |
| Pure row core (caps/drops/truncation) | `src/cee/dual-model/artifacts/store.ts` | built, tested |
| In-memory reference impl | `src/cee/dual-model/artifacts/memory-store.ts` | built, tested |
| Supabase impl (injected client) | `src/cee/dual-model/artifacts/supabase-store.ts` | built, tested with stub client, **constructed by nothing live** |
| Table schema | `migrations/006_create_cee_m2_artifacts.sql` | committed, **NOT applied to any DB** |
| Surfacing composer | `src/cee/dual-model/worth-checking.ts` | built, tested, **not wired to any surface** |

## The blocker the wiring lane must solve first

`enrichDraftGraph` (`src/cee/dual-draft/index.ts`) **drops the merge's defer
artifacts**: `mergeProposals` returns them, but `EnrichmentOutcome` carries only
`{enriched, reason, graph}` — bodies die inside the stage; only counts reach
telemetry. The dispatch layer therefore never sees an artifact to persist.

Fixing this requires an **additive optional field on the frozen contract**
(`src/cee/dual-draft/types.ts`):

```ts
export interface EnrichmentOutcome {
  readonly enriched: boolean;
  readonly reason: EnrichmentReason;
  readonly graph: GraphV3T;
  /** NEW, optional: defer artifacts from the merge (empty on degrade paths). */
  readonly artifacts?: readonly DeferArtifact[];
}
```

The freeze ruling in `types.ts` is a **change-log gate**: this extension is
additive and consistent with the two accepted precedents, but it must be
stopped-and-reported (this document is that report) and separately approved
before any edit. It is an MVP-activation-path file.

## Proposed wiring (once approved — one small diff per step)

1. **Contract** — add optional `artifacts?` to `EnrichmentOutcome`; populate it in
   `enrichDraftGraph` from `outcome.artifacts` on the `applied` AND
   `no_proposals_applied` paths (artifacts exist even when nothing merged). Log-note:
   still no bodies in telemetry.
2. **Dispatch** — in `draft-graph-dispatch.ts`, inside the existing flag-gated
   block: fire-and-forget `store.appendArtifacts({requestId, scenarioId, turnId,
   graphHash, artifacts})` where `graphHash = computeDeterministicGraphHash(graph)`
   is computed **at the dispatch layer** (orchestrator-v5 owns the hash util; the
   cee layer must not import it — layering rule in `dual-draft/types.ts`; the store
   takes it as an opaque string). Failures cannot break a turn (store swallows to
   zero-counts by design).
3. **Store construction** — a small factory behind a NEW default-OFF flag (e.g.
   `CEE_M2_ARTIFACT_PERSISTENCE_ENABLED`), injecting the same Supabase
   client/credentials family the session store uses. Flag added only at this step,
   never earlier.
4. **Migration application** — ops step, separate approval: apply
   `006_create_cee_m2_artifacts.sql` to staging Supabase before flipping the flag.
5. **Telemetry** — register the `DualModelTelemetryEvents` names
   (`src/cee/dual-model/telemetry-events.ts`) in `utils/telemetry.ts` and emit
   `artifacts_persisted` counts from the dispatch wiring.
6. **Retention** — a `startM2ArtifactRetentionJob` mirroring the draft-failures
   retention job. Deferred until the table is live and has traffic.

## Composer surfacing (separate decision — amendment #3 territory)

`composeWorthChecking` is ready but **must not** be wired without the
harness/coaching lane's authorisation (standing ruling quoted in
`dual-draft/index.ts`). Likely wiring: an orchestrator-v5 compose-layer call
reading `ArtifactStore.readByScenario(scenarioId, {statuses: ['deferred']})`,
mapping records → `WorthCheckingArtifactInput`, and rendering the section as
coaching prose or chips. The composer's fail-closed nulling + local leak-token
parity test make the egress posture auditable before that decision is taken.
Treat artifact `question` text as **untrusted content** at any surface (see
injection findings).

## Rejected alternative (documented, not built)

**Harness-owned JSONB column** on `v5_conversation_turns` (+ a new
`append_turn_atomic` parameter): atomic with the turn write and no new table, but
it is a harness-owned migration + RPC signature change (outside this repo's
`migrations/`), couples artifact retention to conversation-turn retention, and
bloats a hot row with up to 8×~1.3KB of text. The repo-owned audit-table pattern
(`cee_draft_failures` precedent) keeps ownership and retention local. Revisit only
if atomicity with the turn write becomes a requirement.
