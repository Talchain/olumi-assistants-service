# Versioning Strategy

This document summarizes how the Olumi Assistants Service handles API and behavior changes over time, and how operators should think about upgrades.

## Schema versioning (draft-graph)

The `/assist/v1/draft-graph` endpoint supports multiple response schema versions:

| Version | Response | Default? | Query Param |
|---------|----------|----------|-------------|
| V1 | Basic graph only | ❌ | `?schema=v1` |
| V2 | `schema_version: "2.2"` + enhanced graph | ❌ | `?schema=v2` |
| V3 | `schema_version: "3.0"` + `analysis_ready` payload | ✅ **Default** | (none) or `?schema=v3` |

**V3 is the default** since late 2025. Clients receive `analysis_ready` automatically without any query parameter. This payload is ready for direct pass-through to PLoT analysis.

Legacy clients can explicitly request V1 or V2 via query parameter, but deprecation logging is active to help operators track migration progress.

## API surface and stability

- The primary public surface is the HTTP API described by `openapi.yaml`.
- Backwards compatibility is a strict goal:
  - Existing HTTP paths, methods, and response schemas should not change in breaking ways.
  - New behavior is added via additive fields, new endpoints, or new feature flags.
- Validation, privacy, and rate-limit hardening changes are allowed **as long as**:
  - Response schemas remain stable.
  - Error schemas remain `error.v1`.
  - New failure modes are clearly documented in release notes.

## Version identifiers

- **Service version**
  - Exposed from `/healthz` as the `version` field (e.g. `1.11.0`).
  - Used in production readiness and deployment docs.
- **CEE feature versions**
  - Each CEE component (draft_graph, options, bias_check, etc.) exposes a `feature_version` string.
  - These are configuration values (env-driven) that allow CEE behavior to evolve without changing the outer HTTP contract.

## Upgrade and migration expectations

- Minor and patch releases are expected to be **backwards-compatible** at the HTTP level.
- When a behavior change could affect clients (for example, stricter validation or new rate-limit semantics):
  - The change should be covered by tests.
  - The change should be described in the relevant completion / validation docs under `Docs/` (e.g. `v1.x` summaries).
- Operators upgrading between adjacent minor versions should be able to do so without client code changes, assuming clients respect the documented API.

## Where to look for version-specific details

- `Docs/production-readiness-checklist.md` – high-level criteria for shipping.
- `Docs/v1.*-completion-summary.md`, `Docs/*-implementation-summary.md` – concrete changes per release.
- `Docs/CEE-*.md` – CEE-specific behavior and configuration.

This document is intentionally high-level; detailed migration notes continue to live alongside the versioned completion and validation reports.
