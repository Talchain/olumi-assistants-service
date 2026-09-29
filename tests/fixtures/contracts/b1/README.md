# B1 boundary validator fixtures (synthetic)

This folder holds **synthetic** fixtures exercising the B1 ingress / egress
validator at `POST /orchestrate/v2/turn` (V5 slice A0).

Synthetic = authored by hand to exercise a specific validator branch. They do
**not** represent a captured real turn — no upstream LLM call, no real
scenario, no real user. Payloads use placeholder UUIDs and minimal text.

## Not the same as `tests/fixtures/v5-replay/`

`tests/fixtures/v5-replay/` is **reserved** for captured real bundles (e.g.
`b2968343`, `d8d0cab0`, `RB-01 … RB-08`) that are replayed against V5 in later
slices. Those fixtures will carry `source_environment: "staging"` or
`"production"` and `replay_suite` identifiers. They do not belong here.

## Fixture metadata (per Boundary Contract v1.1 §5.1)

Each fixture file carries an `_meta` block alongside the `request` / expected
`response` shape:

```jsonc
{
  "_meta": {
    "fixture_id": "B1-INGRESS-VALID-001",
    "boundary": "B1",
    "source_environment": "synthetic",
    "contract_version": "0.3.0",
    "capture_date": "2026-04-16",
    "scenario_tags": ["a0", "ingress", "valid"],
    "expected_result_class": "pass",
    "replay_suite": "N/A",
    "original_failure_mode": "N/A - synthetic",
    "expected_v5_outcome_class": "feature_unavailable"
  },
  "request": { ... },
  "expected": { ... }
}
```

Consumed by [../../../integration/orchestrate-v2.test.ts](../../../integration/orchestrate-v2.test.ts).
