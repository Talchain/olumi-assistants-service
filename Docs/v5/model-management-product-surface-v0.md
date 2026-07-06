# Model Management v1 — CEE-side product surface (v0, DARK / prep-only)

**Status:** draft / do-not-merge lane · everything dark · no route, no UI wired
**Date:** 2026-07-06 · **Stack:** PR-D on #349 (`claude/mm-prod-*`)
**Scope:** CEE-side only. The DGAI UI is a **separate repo/track** and is NOT wired here.

This documents the wire shapes, copy states, and fixture coordination for the future
model-management surfaces, so the (separately-reviewed) wiring slice and the DGAI UI
build against one contract. Source of truth for shapes is
`src/orchestrator-v5/model-management/contracts.ts`; for copy,
`src/orchestrator-v5/model-management/copy.ts`.

---

## 1. Product entry points → service → wire shape

All reads/writes go through `ModelManagementService` (dark; flag
`CEE_MODEL_VERSIONS_ENABLED`, default OFF). Every method returns a discriminated
`ModelManagementResult<T>` = `ok | disabled | conflict | error`. The route layer (future)
maps that to HTTP; the shapes below are the `ok` payload `T`, validated by the PR-C
response schemas.

| UI surface | Service call | `ok` payload (response schema) |
|---|---|---|
| **Current-version indicator** | `getCurrentVersion(scenario_id)` | `ModelVersionRecord \| null` — `CurrentVersionResponseSchema` (`null` = no versions yet) |
| **Version history / list** | `listVersions(scenario_id, limit?)` | `ModelVersionSummary[]` (no graphs) — `ListVersionsResponseSchema` |
| **Save version** | `saveVersion({scenario_id, graph, label?, provenance?, expected?})` | `VersionWriteOutcome` — `VersionWriteOutcomeResponseSchema` |
| **Restore (as new version)** | `restoreVersion({scenario_id, version_id, label?, expected?})` | `VersionWriteOutcome` (carries `restored_from_version_id`) |
| **Single version read** | `getVersion(scenario_id, version_id)` | `ModelVersionRecord` (summary + graph) |
| **Compare / timeline** | `compareVersions(...)` — helper exists, dark | `VersionComparison` — **product surface waits for #341 merged to staging** |

**Server owns graph + hash truth** (PR-C): a request can carry the raw `graph` (save) and
an optional `expected_graph_identity_hash` (an optimistic-CAS *expectation*), and nothing
else hash-shaped. The stored identity is always computed server-side; restore accepts no
client graph. See `contracts.test.ts` for the fixture-proven rejections.

---

## 2. State → copy (`copy.ts`)

| State | When | Copy key |
|---|---|---|
| **Empty** | `getCurrentVersion → null` / `listVersions → []` | `MODEL_MANAGEMENT_COPY.empty` |
| **Loading** | a read/write is in flight | `MODEL_MANAGEMENT_COPY.loading` |
| **Conflict** | `status: 'conflict'` (CAS — model changed since read) | `MODEL_MANAGEMENT_COPY.conflict` |
| **Sign-in required** | `error.code: 'sign_in_required'` (guest, D3 Branch A) | `MODEL_MANAGEMENT_COPY.signInRequired` |
| **Error (per code)** | `status: 'error'` | `MODEL_MANAGEMENT_ERROR_COPY[code]` (complete over every code) |
| **Disabled** | flag OFF | not user-facing (the surface is not rendered) |

### 2.1 Guest copy is PROVISIONAL

The sign-in copy carries the **Branch-A** interim wording ("sign in to save versions"). If
the login/demo tripwire lands as an **Option-C non-durable preview**, the wording flips to
"preview only — not saved". **The schemas and error codes do not change — only this
user-facing wording does.** `copy.test.ts` pins the Branch-A strings so that flip is a
deliberate, reviewed edit. The `sign_in_required` error code + `SIGN_IN_REQUIRED_MESSAGE`
(the terse canonical form) remain the machine contract under either posture.

---

## 3. Fixture coordination (with #345)

#345 (layer-1 cross-track acceptance) is the **sole fixture/harness owner**. This track
does **not** fork a parallel harness. `__tests__/fixtures.ts` is a **proposal** shaped to
#345's convention — real Group A `computeGraphIdentityHash` envelopes (never hand-forged
hashes), graphs built from the sanctioned ingress shape — that #345 can lift in:

- `BASE_GRAPH`, `LABEL_ONLY_EDIT` (identity differs, analysis-equivalent), `STRUCTURAL_EDIT`
  (both differ) — the edit-class invariants that feed compare + freshness reasoning.
- `versionSummary()/versionRecord()/writeOutcome()` builders whose envelopes are consistent
  with the graph, and which parse under the PR-C response schemas (`fixtures.test.ts`).
- Envelope-version alignment is asserted as the **golden-pin surrogate** — it fails loudly
  on identity-regime drift without pinning a brittle magic hex.

---

## 4. Out of scope here (dark boundaries)

No route, no handler, no turn-executor path, no DGAI UI, no live SQL/migration, no flag
flip. Compare/timeline **product** surface waits for #341 → staging. Apply/Reject is not in
this track. Everything stays behind the stop conditions in the stack plan.
