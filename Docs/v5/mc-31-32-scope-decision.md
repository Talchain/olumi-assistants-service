# MC-31 / MC-32 scope decision

**Date:** 22 April 2026
**Decision:** Deferred to production readiness gate.

## MC-31: Behavioural replay fixtures (RB-01..08)

Eight replay fixtures per Boundary Contract v1.1 §9. These verify that real staging
responses are correctly handled end-to-end across service boundaries.

**Status:** Not implemented. Fixture README exists at `tests/fixtures/contracts/b1/README.md`.

**Rationale for deferral:** Golden-path integration tests (19 dispatcher tests, 6 B1 egress
tests, route-level tests) provide sufficient coverage for constrained pilot testing with
known users. RB fixtures add value for production-scale regression detection, not for
initial golden-path validation.

**Production gate requirement:** Implement all 8 RB fixtures before V5 production exit
per Architecture Spec v3.2 §18.2.

## MC-32: CIL invariants (seed chain, request ID chain, repair logging)

**Status:** Partially implemented. `request-extensions.ts:260` covers request_id
propagation. Seed chain and repair logging checks are not implemented.

**Rationale for deferral:** CIL invariants ensure cross-service traceability at scale.
For constrained pilot testing with manual log inspection, the existing request_id
propagation is sufficient.

**Production gate requirement:** Implement all three CIL invariant checks before
production exit.
