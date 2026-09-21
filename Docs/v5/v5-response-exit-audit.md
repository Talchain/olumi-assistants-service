# V5 response exit audit

This document is the **contract** for V5 response finalisation, not a snapshot of route-v2.ts line numbers. Line numbers in route-v2.ts will change as new dispatch families land; the contract below — four mechanisms guarding "every 200-OK V5 wire body was produced by `finaliseV5Response`" — is what stays stable.

## Defence-in-depth contract (current)

Four mechanisms enforce the contract. Each catches what the others miss; no single bypass slips through all four.

| # | Mechanism | What it catches | Where it lives |
|---|---|---|---|
| **A** | Type brand + status-keyed Reply | Every Fastify send shape: `reply.code(200).send(raw)`, `reply.send(raw)`, `reply.status(200).send(raw)`, `reply.code(200).type(...).send(raw)`, implicit return of raw object, `reply.code(500).send(brand)`, `reply.code(200).send(boundaryError)` | `src/orchestrator-v5/response-finaliser.ts` (brand); `src/orchestrator/route-v2.ts` (`V5RouteReply`) |
| **B** | Runtime WeakSet hook | Casts that evaded the type system. The `preSerialization` hook substitutes the egress-violation fallback and emits `v5.finaliser.bypass_detected` — production-observable. | `src/orchestrator/route-v2.ts` (preSerialization hook) |
| **C** | Compile-time `@ts-expect-error` tests | Brand regression — if the brand silently becomes structurally compatible with `OlumiResponse` (e.g. a refactor accidentally widens the type), `tsc` fails on "Unused @ts-expect-error directive". | `src/orchestrator-v5/__tests__/response-finaliser-types.ts` (intentionally NOT a `.test.ts` file so it runs through `tsconfig.build.json` on every push) |
| **D** | Narrow grep gate | (D1) Direct `analysis_ready` writes in composers/handlers; (D2) `FinalisedV5Response` references outside the sanctioned files (catches `as`, `as unknown as`, type aliasing, `satisfies`). | `scripts/check-no-direct-analysis-ready.sh` (pre-push check #15) |

**No single bypass slips through all four.** A determined caster who casts `{} as FinalisedV5Response` evades A, but the grep gate D2 catches the identifier reference, the WeakSet hook B substitutes the fallback at runtime, and (if they refactor the brand to make C's directives "unused") C fails the build. The next-reviewer question shifts from "have you considered Fastify shape X?" to "explain how a single change simultaneously evades the type system, runtime hook, compile-time tests, and grep gate".

## Why this is the structural fix

Three rounds of external review on this brief and the prior one each found the same failure mode: **regex gates leak**. Each iteration was Claude declaring "the gate catches X" → reviewer enumerating bypass shape Y. The final lesson: stop trying to enforce a structural property (every 200-OK body went through the helper) with a syntactic primitive (grep). Type-brand the body; let the type system enforce it; layer runtime + tests + a narrow grep as defence in depth.

## How a future contributor adds a new dispatch path

1. Compute or surface an `AnalysisReadyPayload | undefined` on the dispatch-result type.
2. In `route-v2.ts`, after the new dispatch returns, call `sendFinalised200(reply, requestId, exitPath, response, { analysisReady })`. Status-keyed Reply makes this the only ergonomic compile-fitting option.
3. Add the new exit-path label to the `V5ExitPath` union.
4. Update this audit doc's "current dispatch families" list (below).

If the new path produces a non-2xx response, use `reply.code(N).send(boundaryError)` directly — `V5RouteReply` types `N: BoundaryError` for non-200 keys.

## Current dispatch families (as of HEAD)

Five 200-OK families converge on `sendFinalised200`. Eleven non-2xx exits use `reply.code(N).send(boundaryError)` directly. The exact line numbers are not maintained here — look at `route-v2.ts` for the current state.

| Family | Exit type | Body type |
|---|---|---|
| Pre-flight | 4xx (typically 422) | `BoundaryError` |
| System event | 200 OR 500 | `FinalisedV5Response` OR `BoundaryError` |
| Chip-click | 200 OR 500 | `FinalisedV5Response` OR `BoundaryError` |
| Draft-graph | 200 OR 500 | `FinalisedV5Response` OR `BoundaryError` |
| Edit-graph | 200 OR 500 | `FinalisedV5Response` OR `BoundaryError` |
| TurnExecutor | 200 OR 500 | `FinalisedV5Response` OR `BoundaryError` |

Each 500 site carries an inline comment `// 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)` to prevent a future "fix" that would silently invalidate the prior-store-value invariant.

## How `sendFinalised200` works

The route's only sanctioned `reply.code(200).send(...)` site. Every dispatch family calls it.

1. **Finalise the candidate** — `finaliseV5Response(candidate, ctx)` stamps `analysis_ready` (when `ctx.analysisReady` is provided), brands the response, registers WeakSet membership.
2. **Validate the post-finalise shape** — `validateEgress(finalised, requestId)` runs Zod schema validation. Sees the post-stamped shape, so a future schema tightening catches drift in the finaliser itself.
3. **Re-finalise the validated value (or fallback on drift)** — Zod's `safeParse` returns a fresh object, losing WeakSet membership. So the wire body is a fresh `finaliseV5Response(egress.value | egress.fallback, ctx)` call, ensuring the body the wire sees is always brand-tracked. Idempotent: the second `computed_at` is sub-ms-different from the first; observable behaviour is identical.
4. **Telemetry** — `v5.response.finalised` event with `{exit_path, analysis_ready_emitted, analysis_ready_status, computed_at, egress_ok}`.
5. **Send** — `reply.code(200).send(wireBody)`. The Reply type forces `wireBody: FinalisedV5Response`; raw or `BoundaryError` is a tsc error.

## Decision: 500 / BoundaryError paths skip the finaliser

Eleven exits return `BoundaryError` (status 500 or pre-flight 422). They legitimately do not carry `analysis_ready`:

- **No canvas mutation occurred.** The user's UI store still holds the most recent successful `ceeAnalysisReady` (from a prior turn). Stamping a fresh readiness on an error response would be misleading — it implies "the server thinks readiness changed", but readiness depends on graph state which the failed turn did not change.
- **`BoundaryError` is a typed error envelope, not an `OlumiResponse`.** Different schema. Adding analysis_ready would require schema changes in `@talchain/schemas` for marginal benefit.
- **The UI's null-as-unknown handling (Phase 5) covers the rare case where a user's first server contact is a failure response.** Chip stays hidden, neutral state, no false blocker.

Each 500 site gets a one-line inline comment: `// 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)`. This prevents a future developer from "fixing" the omission by adding analysis_ready to error responses, which would silently invalidate the prior-store-value invariant.

## Egress-drift fallback handling

`validateEgress` returns `{ ok: false, fallback }` when the upstream produced a response that fails `OlumiResponseSchema.parse`. The fallback is a hard-coded envelope with `error_code: 'EGRESS_CONTRACT_VIOLATION'`. **The finaliser stamps the fallback too**, implemented inside `sendFinalised200`:

```
const finalised = finaliseV5Response(candidate, ctx);
const egress = validateEgress(finalised, requestId);
const wireBody = egress.ok ? egress.value : finaliseV5Response(egress.fallback, ctx);
```

This is correct because:
- It IS an `OlumiResponse` (passes the schema)
- The user receives a 200 with this fallback; the UI treats it as a normal turn for state-update purposes
- Without `analysis_ready`, the UI store would lose the wire-driven readiness for this turn — same problem the brief is solving for the success case

The stamped value is the dispatch's `analysisReady` (computed from the same graph state the original response would have used). This means even when the upstream produced a malformed envelope, the UI still gets a coherent readiness view.

## Adversarial bypass enumeration (verified)

Each shape was tested by injection + observation. No shape evades all four mechanisms.

| # | Bypass shape | Caught by |
|---|---|---|
| 1 | `reply.code(200).send(rawOlumiResponse)` | A (tsc error: `Argument not assignable to FinalisedV5Response`) |
| 2 | `reply.send(rawObject)` (Fastify defaults to 200) | A (tsc error: `Object literal may only specify known properties, and 'response_version' does not exist in type 'V5RouteReply'`) |
| 3 | `reply.status(200).send(raw)` | A (status alias enforces same brand) |
| 4 | `reply.code(200).send(boundaryError)` | A (status↔body pairing rejects) |
| 5 | `reply.code(500).send(finalised)` | A (5xx wants BoundaryError, not the brand) |
| 6 | `return rawObject` (implicit handler return) | A (status-keyed Reply rejects raw at the route level) |
| 7 | `reply.code(200).type('json').send(raw)` (chained interleave) | A (covered by Reply map at `send` resolution) |
| 8 | `{} as FinalisedV5Response` (cast bypass) | D2 (grep catches identifier outside sanctioned files); B (WeakSet membership absent at runtime) |
| 9 | `as unknown as FinalisedV5Response` | D2 |
| 10 | `type Brand = FinalisedV5Response; ... as Brand` | D2 (grep catches the `FinalisedV5Response` reference in the alias declaration) |
| 11 | `satisfies FinalisedV5Response` | D2 (mentions identifier) |
| 12 | Brand silently regresses (e.g. refactor widens the type) | C (`@ts-expect-error` annotations turn into `Unused directive` errors when the negative cases stop type-erroring) |
| 13 | New dispatch family added without calling helper | A (status-keyed Reply forces the helper) + telemetry absent (visible in soak metrics) |

The remaining residual: a contributor casts `as FinalisedV5Response` in a sanctioned file (e.g. inside a test that's exempt). Reviewable; no automated guard. Documented as the single intentional escape hatch.
