# Coefficient Clamping Audit — 2026-03-18

## Summary

Both PLoT and ISL clamp edge `strength.mean` to `[-1, 1]`. No new clamping code needed.

---

## What each service enforces

### PLoT (`plot-lite-service`)

**At parse/normalisation time** (`src/normalisation/graph-normaliser.ts`):
- `strength.mean` clamped to `[-1, 1]` — emits `CLAMP_STRENGTH_MEAN` repair warning
- `strength.std` floored to `0.05` (causal edges) / `0.01` (structural: decision→option, option→factor)
- `strength.std` capped at `0.4`
- `exists_probability` clamped (implicit via validation)
- Original values preserved in repair log before clamping

**Code path:** `graph-normaliser.ts` → called before every ISL request in the PLoT pipeline.

### ISL (`Inference-Service-Layer`)

**At input parse time** (`src/models/robustness_v2.py`, `StrengthDistribution.clamp_mean()`):
- `strength.mean` clamped to `[-1.0, 1.0]` at Pydantic model validation
- Original value stored in `_pre_clamp_mean`; emits `STRENGTH_MEAN_CLAMPED` `InferenceWarning` if clamped
- `std` values: not clamped by ISL (relies on PLoT normalisation upstream)

**At Monte Carlo sampling time** (`src/services/robustness_analyzer_v2.py`, `EdgeSampler.sample_edge_configuration()`):
- Line 178: `strength = np.clip(strength, EDGE_STRENGTH_MIN, EDGE_STRENGTH_MAX)` — constants = `[-1.0, 1.0]`
- Implemented at **three** additional points in the file (lines 1352, 1359, 1388, 1393, 2383)
- `ClampMetrics` datamodel exists in `src/models/robustness_v2.py` but is not yet populated — counts not surfaced in response metadata

---

## Authoritative service

**PLoT is authoritative** for normalised `strength.mean` bounds before ISL is called.

ISL adds a defensive layer at both parse time and sampling time. This is intentional belt-and-suspenders — not the triple-clamping pattern flagged in the UI audit, because:
1. PLoT clamps at the API boundary before ISL is called
2. ISL clamps at parse time (input validation)
3. ISL clamps at sampling time (numeric stability during Monte Carlo)

Each layer has a distinct purpose: boundary enforcement → input validation → numerical stability. No redundant clamping.

---

## Gap: ClampMetrics not populated

`ClampMetrics` in `src/models/robustness_v2.py` tracks `clamped_samples` and `clamp_rate` but is imported without being populated in `robustness_analyzer_v2.py`. This means clamp events at sampling time are silently absorbed. Low priority — PLoT normalisation prevents out-of-range inputs reaching ISL in normal operation.
