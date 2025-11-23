# ADR: CEE v1 Streaming Surface

## Status

Accepted – CEE v1 is JSON-only. No dedicated CEE streaming endpoint will be
added in v1.

## Context

The core Assistants service already exposes a robust streaming API:

- `POST /assist/draft-graph/stream` (SSE)
- `POST /assist/draft-graph/resume` (SSE resume)

This layer is exercised heavily by:

- Frontend clients (Next.js / React SSE examples).
- Chaos and resume tests (`tests/chaos/*`, `tests/integration/sse-resume.test.ts`).
- Operator tooling (`scripts/smoke-prod.sh`, `scripts/smoke-staging-degraded.sh`).

CEE v1, by contrast, is deliberately small and deterministic:

- Sits on top of the existing draft pipeline.
- Adds a validation/finaliser layer (`src/cee/validation/pipeline.ts`).
- Produces rich but cheap metadata: `trace`, `quality`, `validation_issues`,
  `archetype`, and `response_limits`.
- Guarantees no additional LLM calls and no payload logging.

The question for v1 was whether CEE should:

1. Add a dedicated streaming route (e.g. `POST /assist/v1/draft-graph/stream`),
   mirroring the existing SSE surface with CEE wrappers.
2. Remain JSON-only and keep CEE logic tightly coupled to the synchronous draft
   pipeline, while continuing to rely on the existing SSE surface for
   streaming/resume.

## Decision

For CEE v1 we choose **option 2**: keep CEE JSON-only.

- No CEE-specific streaming route is defined in `openapi.yaml`.
- CEE endpoints are:
  - `POST /assist/v1/draft-graph`
  - `POST /assist/v1/explain-graph`
  - `POST /assist/v1/evidence-helper`
  - `POST /assist/v1/bias-check`
  - `POST /assist/v1/options`
  - `POST /assist/v1/sensitivity-coach`
  - `POST /assist/v1/team-perspectives`
- All CEE responses are single JSON envelopes described by the
  `CEE*ResponseV1` schemas.

The rationale:

- **Determinism & simplicity** – The CEE finaliser can reason over the complete
  draft result once, compute `quality` and `validation_issues` deterministically,
  and apply caps (`response_limits`) centrally. This is much simpler than
  streaming partial CEE metadata and then reconciling at the end.
- **Reuse of proven SSE surface** – The existing `/assist/draft-graph/stream`
  API already handles retries, resume tokens, and degraded modes. CEE v1 would
  mostly be a thin wrapper around the *final* result of that stream, so adding a
  parallel SSE surface would increase complexity without materially improving
  product value for v1.
- **Risk & scope control** – CEE v1 is already a substantial change set with new
  error codes, telemetry, and endpoints. Keeping the CEE layer JSON-only
  reduces the risk of subtle SSE regressions, especially around auth,
  rate-limiting, and resume semantics.

## Consequences

- Integrators who want streaming today should continue to use
  `POST /assist/draft-graph/stream` (and `/resume`) and, if needed, layer their
  own CEE-style interpretation on top in the client.
- The CEE doc (`v1.md`) explicitly calls out that:
  - CEE v1 is JSON-only.
  - The existing SSE surface remains the source of truth for streaming.
- The TypeScript SDK exposes CEE helpers (`getCEETrace`, `getCEEQualityOverall`,
  `getCEEValidationIssues`, `ceeAnyTruncated`, `isRetryableCEEError`) and a
  `createCEEClient` factory for the JSON endpoints only.

## Future Work

If we decide to add CEE streaming in a later version (e.g. v1.x+), the plan is:

- Define explicit SSE event schemas in `openapi.yaml` for a new path such as
  `/assist/v1/draft-graph/stream`.
- Reuse the existing SSE infrastructure (including resume tokens and
  `ENABLE_LEGACY_SSE` behaviour) rather than building a second streaming stack.
- Ensure that the final event yields a payload exactly consistent with the
  JSON `CEEDraftGraphResponseV1` so that CEE clients can treat streaming and
  non-streaming results uniformly.
- Extend the TypeScript SDK `sse` helpers with a thin CEE-aware wrapper.
