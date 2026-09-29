# V5 reference

Operator-facing notes on V5 wire-response behaviour. Pin-narrow facts only — for ownership contracts and design rationale see the relevant brief / evidence files.

## Wire response sanitisation

Internal trace fields (`ceeTrace`) are stripped from the wire response unless `CEE_TURN_DEBUG_ENABLED` is explicitly true. This is egress sanitisation only; it does not affect `analysis_ready` stamping.

Implementation: [src/orchestrator-v5/response-finaliser.ts](../../src/orchestrator-v5/response-finaliser.ts) `finaliseV5Response` → `stripCeeTrace`. Behaviour pinned by [src/orchestrator-v5/__tests__/response-finaliser.test.ts](../../src/orchestrator-v5/__tests__/response-finaliser.test.ts) "ceeTrace defensive scrub" group.
