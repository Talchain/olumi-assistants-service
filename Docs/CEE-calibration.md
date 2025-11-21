# CEE Calibration Suite

This document describes the small, deterministic calibration suite for CEE v1
quality and guidance.

## 1. Purpose

The calibration suite provides a few hand-crafted cases that exercise the
`computeQuality` and `buildCeeGuidance` helpers using metadata-only fixtures.
It is intended to catch accidental regressions in:

- Quality banding (`low` / `medium` / `high`).
- Presence of CEE validation issues.
- Truncation flags derived from `response_limits`.

The suite does **not** depend on live LLMs or external services.

## 2. Location

- Fixtures: `tests/fixtures/cee/golden-calibration/`
  - `golden_high_quality.json` – healthy graph, high confidence, no issues; locks in **high** band behaviour.
  - `golden_under_specified.json` – tiny/sparse graph with structural issues; locks in **low** band + validation issues.
  - `golden_limits_truncated.json` – medium graph with truncation flags; locks in truncation-only guidance.
  - `golden_engine_issues.json` – medium-band case with non-zero `engine_issue_count` and no CEE issues; ensures engine issues are treated as metadata only.
  - `golden_boundary_low_medium.json` – case near the low/medium numeric threshold where rounding plus `CEE_QUALITY_MEDIUM_MIN` yields **medium**.
  - `golden_boundary_medium_high.json` – case at the medium/high boundary where rounding plus `CEE_QUALITY_HIGH_MIN` yields **high**.
  - `golden_mixed_truncation_issues.json` – medium-band case with both truncation and validation issues; calibrates combined risk posture.
- Loader/helper: `tests/utils/cee-calibration.ts`
- Integration test: `tests/integration/cee.calibration.test.ts`

## 3. Fixture shape

Each calibration fixture today has the following shape:

```jsonc
{
  "kind": "quality_guidance",
  "id": "golden_high_quality",
  "description": "Human-readable description of the case.",
  "quality_input": {
    "graph": { "version": "1", "default_seed": 17, "nodes": [...], "edges": [...], "meta": {...} },
    "confidence": 0.85,
    "engine_issue_count": 0,
    "cee_issues": [],
    "limits": {
      "bias_findings_truncated": false,
      "options_truncated": false,
      "evidence_suggestions_truncated": false,
      "sensitivity_suggestions_truncated": false
    }
  },
  "expectations": {
    "expected_band": "high",
    "expect_validation_issues": false,
    "expect_any_truncated": false
  }
}
```

The loader (`loadCalibrationCase`) parses these fixtures and exposes them as
strongly-typed `CeeCalibrationCase` objects for tests.

## 4. Running the calibration tests

From the repo root:

```bash
pnpm test:cee:calibration
```

The test suite asserts that:

- The derived quality band from `quality.overall` matches `expected_band`.
- The presence or absence of validation issues matches `expect_validation_issues`.
- `guidance.any_truncated` matches both the limits-derived truncation state and
  `expect_any_truncated`.

## 5. Extending the suite

To add a new calibration case:

1. Create a new JSON file in `tests/fixtures/cee/golden-calibration/` following
   the same shape as the existing fixtures.
2. Add the fixture ID to `CEE_CALIBRATION_CASES` in `tests/utils/cee-calibration.ts`.
3. Optionally, add a short comment to the JSON `description` explaining what the
   case is intended to protect (e.g. a particular boundary around low vs
   medium, or medium vs high, quality).
4. Re-run the calibration test file.

When adjusting heuristics in `src/cee/quality/index.ts` or
`src/cee/guidance/index.ts`, update fixtures and expectations deliberately
instead of changing tests to match regressions.
