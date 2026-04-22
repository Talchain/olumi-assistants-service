# route-v2.ts dispatch-branch pre-flight audit

**Date:** 2026-04-22
**Author:** claude (opus 4.7)
**Branch:** `claude/v5-route-refactor`
**Related briefs:** v5-handler-surface, v5-upsert-scenario-preflight, v5-route-refactor

## Summary

`POST /orchestrate/v2/turn` has five dispatch branches that were added across separate briefs. Each branch owns its own post-dispatch logic (commit-status check, egress validation, BoundaryError envelope shape) but relies on three ingress-side checks being run before any branch is entered:

1. extension parse (`parseRequestExtensions`)
2. B1 ingress validation (`validateIngress`)
3. scenario upsert pre-flight (`preflightEnsureScenario`)

Before this refactor the invariant "every branch runs those three in order" was preserved by convention only. A future branch added above the shared block could silently bypass it. That class of bug has already appeared three times in adjacent briefs; this refactor converts the invariant to structural enforcement via helper extraction plus a file-scoped ESLint rule plus a spy-based integration test.

## Note on the brief's premise

The v5-route-refactor brief describes a symptom: *"draft_graph dispatch bypasses `preflightEnsureScenario`, causing `append_turn_atomic` to fail with 'scenario not found' on first turns."*

That symptom is **not** present on staging HEAD at investigation time (commit `d1e4856f`). Commit `cee67efe` (feat(v5): upsert-on-append pre-flight replaces 422 SCENARIO_NOT_FOUND) installed the shared pre-flight at [route-v2.ts:178-194](../../src/orchestrator/route-v2.ts#L178-L194) of the pre-refactor file, and every branch inherits it.

The reported production failure was most likely a deployment-ordering or rollout-timing effect: the UI-side change that started sending `user_id` on turns landed at a time when only some pods had received the pre-flight migration, or the migration race described in the brief for CEE-7 occurred before `cee67efe` merged. By the time staging HEAD was audited for this refactor, the invariant already held.

The value of this work is therefore not in fixing a current symptom — it is in making the invariant structurally enforced so that the next contributor cannot regress it even accidentally.

## Before state (pre-refactor, commit cee67efe on staging)

Route body at [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) ran, inline, in sequence:

| Step | Lines | Call |
|---|---|---|
| 1. request id | 135 | `getOrGenerateRequestId(req)` |
| 2. extension parse | 141–153 | `parseRequestExtensions(req.body, requestId)` |
| 3. strip + B1 ingress | 156–164 | `validateIngress(stripExtensionFields(req.body), requestId)` |
| 4. scenario upsert pre-flight | 178–194 | `preflightEnsureScenario(ingress.value.scenario_id, extensions.value.userId, requestId)` |
| 5. dispatch branch | 211+ | `if (ingress.value.kind === 'system_event') …` etc. |

Every branch at or after step 5 inherited the results of steps 1–4 via lexical scope (`ingress.value.*`, `extensions.value.*`, `requestId`). The invariant held because nothing in the handler body preceded steps 1–4.

Branch map:

| Branch | Lines (pre-refactor) | Trigger |
|---|---|---|
| `system_event` | 211–249 | `ingress.value.kind === 'system_event'` |
| `isChipClickRunAnalysis` | 268–362 | `source === 'chip_click' && chip?.action_type === 'run_analysis'` |
| `isDraftGraphShape` | 385–450 | `stage === 'frame' && graphState == null && message ≥ MIN_LEN && decision-regex` |
| `isEditGraphShape` | 470–537 | `graphState != null && stage in {analyse, decide} && edit-regex && !negative-regex` |
| TurnExecutor fallthrough | 544–615 | default |

### Per-branch audit matrix (pre-refactor)

"Inherited" means the branch does not run the check directly — it runs once at module scope (lines 135–194) upstream of every branch. "Branch-local" means the branch runs it itself.

| Branch | Extension parse | B1 ingress | Scenario pre-flight | Commit path | Egress validation | BoundaryError construction |
|---|---|---|---|---|---|---|
| `system_event` (211–249) | ✓ inherited (141) | ✓ inherited (157) | ✓ inherited (178) | Inside `dispatchSystemEvent`; `commitSkippedReason === 'client_only_event'` permits `commitPerformed:false` | ✓ branch-local (240) | Manual literal (217–230) |
| `isChipClickRunAnalysis` (268–362) | ✓ inherited (141) | ✓ inherited (157) | ✓ inherited (178) | Inside `dispatchChipClickRunAnalysis`; 4-way discriminated `outcome` with per-case `validator`/`cause_kind`/`retryable` | ✓ branch-local (330) | Manual literal × 4 (281–294, 298–310, 313–326, 347–359) |
| `isDraftGraphShape` (385–450) | ✓ inherited (141) | ✓ inherited (157) | ✓ inherited (178) | Inside `dispatchDraftGraph`; simple `commitPerformed` check + try/catch for pipeline throws | ✓ branch-local (413) | Manual literal × 2 (398–410, 435–447) |
| `isEditGraphShape` (470–537) | ✓ inherited (141) | ✓ inherited (157) | ✓ inherited (178) | Inside `dispatchEditGraph`; same shape as draft_graph | ✓ branch-local (505) | Manual literal × 2 (490–502, 522–534) |
| TurnExecutor fallthrough (544–615) | ✓ inherited (141) | ✓ inherited (157) | ✓ inherited (178) | Inside TurnExecutor; `telemetry.commit_performed` + `failure_type` + `extractRetryableFlag(response)` | ✓ branch-local (606) | Manual literal (572–594) |

**Key invariant:** every branch inherits the three ingress-side checks; no branch runs them locally. That invariant is what the refactor locks structurally.

**Deliberate non-uniformity:** the commit path and BoundaryError construction differ per branch, because the typed failure granularity on the wire differs per branch (different `validator` values, different `cause_kind` enum, different `retryable` policy). Unifying those would change the response shape — explicitly forbidden by the brief's §8 "What must NOT change".

### Per-branch audit matrix (post-refactor)

| Branch | Extension parse | B1 ingress | Scenario pre-flight | Commit path | Egress validation | BoundaryError construction |
|---|---|---|---|---|---|---|
| `system_event` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | unchanged | unchanged | unchanged |
| `isChipClickRunAnalysis` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | unchanged | unchanged | unchanged |
| `isDraftGraphShape` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | unchanged | unchanged | unchanged |
| `isEditGraphShape` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | unchanged | unchanged | unchanged |
| TurnExecutor fallthrough | ✓ via `runPreFlight` | ✓ via `runPreFlight` | ✓ via `runPreFlight` | unchanged | unchanged | unchanged |

Every branch now reads the results from the destructured `PreFlightContext` (`ingress`, `extensions`, `requestId`) rather than from inline primitive returns. No branch calls the three primitives directly. The file-scoped ESLint rule enforces that no future branch can.

Existing `tests/integration/orchestrator/route-v2-*.test.ts` covered each branch's dispatcher behaviour but mocked `ensureScenarioExists` with an inline arrow that always resolves — so the tests would have passed even if a branch had silently skipped the pre-flight. The shared-pre-flight invariant was therefore not actually guarded at test time.

## After state (post-refactor)

### Call graph

```
app.post('/orchestrate/v2/turn', async (req, reply) => {
  const pre = await runPreFlight(req);                  // single call site
  if (!pre.ok) return reply.code(pre.status).send(pre.error);
  const { requestId, ingress, extensions } = pre.context;

  if (ingress.kind === 'system_event') { … }
  if (isChipClickRunAnalysis) { … }
  if (isDraftGraphShape) { … }
  if (isEditGraphShape) { … }
  // TurnExecutor fallthrough
});
```

The five branch bodies are byte-identical to pre-refactor except that they read `ingress.*` / `extensions.*` (the destructured context) instead of `ingress.value.*` / `extensions.value.*` (the primitive return values).

### Helper ([src/orchestrator/route-v2-preflight.ts](../../src/orchestrator/route-v2-preflight.ts))

`runPreFlight(req)` returns a discriminated `PreFlightOutcome`:

- `{ ok: true; context: PreFlightContext }` — `requestId`, validated `ingress`, parsed `extensions`
- `{ ok: false; status: 422; error: BoundaryError }` — the same typed 422 envelope that the pre-refactor route emitted inline

The helper is side-effect free apart from telemetry and structured logging (emitted by the underlying primitives and by two `log.warn` calls inside `runPreFlight` on the extension-parse and B1 failure paths, preserved from the pre-refactor handler). It does not touch the Fastify request or reply; the caller owns `reply.code(...).send(...)`.

### Structural guards

Two independent layers, either of which would catch a regression alone:

**1. File-scoped ESLint `no-restricted-syntax` block ([eslint.config.js](../../eslint.config.js))**

Forbids route-v2.ts from invoking the three primitives by any path:

- `CallExpression[callee.name="validateIngress"]` etc. — direct bare-identifier calls
- `ImportSpecifier[imported.name="validateIngress"]` etc. — the import site, which catches `import { validateIngress as x }` alias escape
- `MemberExpression[property.name="validateIngress"]` etc. — namespace access (`import * as b1; b1.validateIngress(...)`)

Fires at `pnpm lint` and CI lint-gate before test runtime. Verified by manually reintroducing an `import { validateIngress }` line and observing the correct error message.

**2. Spy-based integration test ([tests/integration/orchestrator/route-v2-preflight-invariant.test.ts](../../tests/integration/orchestrator/route-v2-preflight-invariant.test.ts))**

Installs `vi.fn()` as the `ensureScenarioExists` stub (unlike every other route-v2 test which uses an inline arrow) and asserts:

- system_event branch → spy called exactly once with `(scenario_id, user_id)`
- chip_click run_analysis branch → spy called exactly once
- draft_graph branch → spy called exactly once
- edit_graph branch → spy called exactly once
- TurnExecutor fallthrough branch → spy called exactly once
- null `user_id` branch → spy NOT called (pre-flight short-circuits before RPC)
- order: on the draft_graph branch, `ensureScenarioExistsSpy.mock.invocationCallOrder[0] < dispatchDraftGraphSpy.mock.invocationCallOrder[0]`

Verified that temporarily stubbing `preflightEnsureScenario` to never call `ensureScenarioExists` causes 6 of 7 tests to fail (only the null-user case passes) — i.e., the test actually catches the regression it claims to catch.

**3. Helper unit tests with inline snapshots ([tests/unit/orchestrator/route-v2-preflight.test.ts](../../tests/unit/orchestrator/route-v2-preflight.test.ts))**

Three cases, one per 422 path. The `V5RequestExtensions` and `scenario_preflight` envelopes are pinned byte-for-byte via `toMatchInlineSnapshot`; a future schema change produces a visible snapshot diff rather than a silent wire-contract drift. The `OrchestratorTurnPayload` case pins the stable outer fields but not the issue list (which depends on upstream `@talchain/schemas` evolution).

## For future maintainers

**To add a new dispatch branch:**

1. Read the `PreFlightContext` from the existing `const { requestId, ingress, extensions } = pre.context;` destructuring. Add your branch after the existing `system_event` / chip_click / draft_graph / edit_graph blocks. Write your branch's post-dispatch logic (commit-status check, egress validation) in its own form — every branch here already has a subtly different shape and that is deliberate.
2. Do NOT re-invoke `validateIngress`, `parseRequestExtensions`, or `preflightEnsureScenario` inside your branch. The lint rule in `eslint.config.js` will block the import and the call. The spy-based integration test in `route-v2-preflight-invariant.test.ts` will fail if the shared pre-flight was bypassed for your branch.
3. Add a new test case to `route-v2-preflight-invariant.test.ts` for your branch asserting `ensureScenarioExistsSpy` was called once.
4. If you genuinely need a new ingress-side check that applies to every branch, add it to `runPreFlight` in `route-v2-preflight.ts`. Do not add it to the route handler body.

**To change a dispatch primitive:**

If `validateIngress` / `parseRequestExtensions` / `preflightEnsureScenario` needs to be replaced (e.g., ingress moves to a JWT-derived identity rather than caller-trusted `user_id`), update `runPreFlight` and the lint rule's symbol list in tandem. The inline snapshots in the unit test will surface any envelope-shape changes.

## Acceptance criteria mapping

| Criterion | Evidence |
|---|---|
| Brief submission (draft_graph) succeeds with `commit_performed: true` | [tests/integration/orchestrator/route-v2-draft-graph.test.ts](../../tests/integration/orchestrator/route-v2-draft-graph.test.ts), [route-v2-golden-path.test.ts](../../tests/integration/orchestrator/route-v2-golden-path.test.ts) green |
| System events succeed | [route-v2-system-events.test.ts](../../tests/integration/orchestrator/route-v2-system-events.test.ts) green |
| Chip click run_analysis succeeds | [route-v2-chip-click.test.ts](../../tests/integration/orchestrator/route-v2-chip-click.test.ts) green |
| Conversation message succeeds | [orchestrate-v2.test.ts](../../tests/integration/orchestrate-v2.test.ts) green |
| Every turn type's pre-flight runs once with a new `scenario_id` | [route-v2-preflight-invariant.test.ts](../../tests/integration/orchestrator/route-v2-preflight-invariant.test.ts), 7 cases |
| No branch calls ingress / extension / preflight independently | ESLint `no-restricted-syntax` on [route-v2.ts](../../src/orchestrator/route-v2.ts), verified to fire on violation |
| Before-and-after state documented | this document |
| V1 routes still return 410 | out of scope (V1 guard lives in [src/orchestrator/route.ts](../../src/orchestrator/route.ts)) |

## Out of scope

- Unifying the five branch post-dispatch shapes into a common envelope. Each branch has intentionally different typed failure granularity (4-way `outcome` on chip_click; `commitSkippedReason` escape hatch on system_event; `failure_type` + `extractRetryableFlag` on TurnExecutor) that the wire contract depends on.
- Moving pre-flight into a Fastify `preHandler` hook. That would give the strongest structural guarantee but requires module augmentation of `FastifyRequest` to thread the typed context through the request lifecycle, which costs more than it gains for a single route.
- Re-examining the V1 guard at [src/orchestrator/route.ts](../../src/orchestrator/route.ts).
