# CEE Decision Model Transforms Audit

## Summary

This audit documents all data transformations CEE applies to decision model data, classifying each as:
- **Generation**: Creating derived data correctly (no intervention needed)
- **Repair**: Fixing invalid LLM output (should be logged/moved to validation)

---

## Transform Inventory

### 1. LLM Output Normalization ([normalisation.ts](../../src/adapters/llm/normalisation.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| Node kind normalization | Repair | YES (telemetry) | 86-98 | Maps non-standard kinds (evidence→option, constraint→risk) |
| V4 belief_exists clamping | Repair | YES (warn) | 166-182 | Clamps belief_exists to [0,1] |
| V4 exists_probability clamping | Repair | YES (warn) | 207-222 | Clamps exists_probability to [0,1] |
| Legacy belief clamping | Repair | YES (warn) | 230-249 | Clamps legacy belief to [0,1] |
| String→number coercion | Repair | NO | 153-163 | Converts "0.7" → 0.7 |
| Controllable factor baseline | Generation | YES (info) | 299-384 | Adds default value=1.0 for factors with option→factor edges |

### 2. Schema V3 Transformation ([schema-v3.ts](../../src/cee/transforms/schema-v3.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| strength_mean clamping | Repair | YES (info+telemetry) | 167-187 | Clamps to [-1, +1] range |
| strength_std bounding | Generation | YES (debug) | 194-214 | Bounds to [1e-6, max(0.5, 2×\|mean\|)] |
| Default strength_mean | Silent Default | NO | 231 | `edge.strength_mean ?? edge.weight ?? 0.5` |
| Default belief_exists | Silent Default | NO | 232 | `edge.belief_exists ?? edge.belief ?? 0.5` |
| Effect direction sign | Generation | NO | 240-242 | Negates strength if direction is "negative" |
| strength_std derivation | Generation | NO | 264-266 | Derives from strength/belief/provenance |
| Effect direction derivation | Generation | NO | 272 | Derives from strength_mean sign |
| Provenance source mapping | Generation | NO | 296-310 | Maps strings to V3 enum values |
| Node kind→V3 mapping | Generation | YES (warn on unknown) | 96-107 | Maps constraint→factor, unknown→factor |

### 3. Strength Uncertainty Derivation ([strength-derivation.ts](../../src/cee/transforms/strength-derivation.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| strength_std derivation | Generation | NO | 35-64 | `std = max(0.05, cv × \|strength\| × sourceMultiplier)` |
| Belief clamping (internal) | Silent | NO | 42 | Clamps belief to [0,1] for CV calculation |
| Strength clamping (internal) | Silent | NO | 41 | Uses abs(strength) or 0.5 if undefined |

**Formula**: `cv = 0.3 × (1 - belief) + 0.1`, `sourceMultiplier = 1.5 for hypothesis, 1.0 otherwise`

### 4. Value Uncertainty Derivation ([value-uncertainty-derivation.ts](../../src/cee/transforms/value-uncertainty-derivation.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| CV-based std derivation | Generation | NO | 208-236 | `std = max(0.01, baseCV × \|value\| × typeMultiplier)` |
| Range-based std derivation | Generation | NO | 174-200 | `std = (max - min) / 4` for range extractions |
| Confidence clamping | Silent | NO | 214 | Clamps confidence to [0,1] |
| Missing range fallback | Repair | YES (warn) | 152-158 | Falls back to CV when range missing |

### 5. ID Normalization ([id-normalizer.ts](../../src/cee/utils/id-normalizer.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| Label→ID conversion | Generation | YES (warn when changed) | 35-88 | Converts "Marketing Spend" → "marketing_spend" |
| Collision deduplication | Generation | YES (warn) | 100-114 | Appends `__2`, `__3`, etc. for duplicates |

### 6. Schema V2 Transformation ([schema-v2.ts](../../src/cee/transforms/schema-v2.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| kind→type mapping | Generation | YES (warn on unknown) | 255-277 | Maps decision→option, action→option, constraint→factor |
| data→observed_state | Generation | NO | 310-342 | Renames field for V2 schema |
| label defaulting | Silent Default | NO | 306 | `label: node.label ?? node.id` |
| Default weight | Silent Default | NO | 362 | `weight: edge.weight ?? 0.5` |
| Default belief | Silent Default | NO | 363 | `belief: edge.belief ?? 0.5` |
| Effect direction inference | Generation | NO | 366 | Infers from node kinds/labels |
| strength_std derivation | Generation | NO | 369 | Derives from weight/belief/provenance |
| Provenance extraction | Generation | NO | 283-290 | Converts object to string |
| value_std derivation | Generation | NO | 330-339 | Derives from extraction metadata |

### 7. Graph Structure Transforms ([structure/index.ts](../../src/cee/structure/index.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| Decision branch belief normalization | Repair | NO | 151-238 | Normalizes decision→option beliefs to sum=1.0 |
| Single goal enforcement | Repair | NO | 329-437 | Merges multiple goals into compound goal |
| Outcome edge belief defaulting | Repair | NO | 452-524 | Sets default belief=0.5 on option→outcome edges |
| Edge belief normalization (post-merge) | Repair | NO | 410-418 | Sets belief=1.0 on edges from compound goal |
| Edge deduplication | Repair | NO | 398-406 | Prefers edges with provenance/metadata |

### 8. Graph Normalizer for ISL ([graph-normalizer.ts](../../src/cee/decision-review/graph-normalizer.ts))

| Transform | Type | Logged | Lines | Description |
|-----------|------|--------|-------|-------------|
| V3→V1 format conversion | Generation | YES (debug) | 82-166 | Copies observed_state to data |
| value_std derivation | Generation | NO | 116-134 | Derives from extraction metadata or 20% CV default |
| Option→factor edge filtering | Repair | YES (debug) | 178-201 | Removes option-originated edges for ISL |
| Conservative uncertainty default | Generation | NO | 133 | Uses 20% CV when no metadata |

---

## Classification Summary

### Generation Transforms (Correct - No Changes Needed)

These derive new data from existing properties correctly:
1. strength_std derivation from belief/provenance
2. value_std derivation from extraction confidence
3. Effect direction derivation from strength sign
4. Label→ID normalization
5. Schema format conversions (V1→V2→V3)
6. Provenance source mapping

### Silent Default Transforms (Document or Log)

These silently apply defaults without logging:
1. `strength_mean ?? weight ?? 0.5` - **Consider logging when fallback used**
2. `belief_exists ?? belief ?? 0.5` - **Consider logging when fallback used**
3. `label ?? id` - Acceptable silent default
4. `weight ?? 0.5` - **Consider logging in V2 path**
5. `belief ?? 0.5` - **Consider logging in V2 path**

### Repair Transforms (Should Be Explicit)

These fix invalid LLM output and should have clear logging:

| Transform | Status | Recommendation |
|-----------|--------|----------------|
| Node kind normalization | LOGGED | Keep as-is |
| belief_exists clamping | LOGGED | Keep as-is |
| strength_mean clamping | LOGGED | Keep as-is |
| Decision branch normalization | SILENT | **Add telemetry event** |
| Single goal enforcement | SILENT | **Add telemetry event** |
| Outcome edge belief defaulting | SILENT | **Add telemetry event** |
| Option→factor edge filtering | LOGGED | Keep as-is |
| String→number coercion | SILENT | **Consider logging** |

---

## PLoT Overlap Analysis

### No Significant Duplication Found

The transforms serve distinct purposes:
- **CEE transforms**: Prepare LLM output for downstream consumption (V3 schema)
- **ISL graph normalizer**: Bridge V3 to V1 format specifically for ISL engine
- **PLoT**: Consumes analysis_ready payload (already transformed)

### Intentional Separation

| Component | Responsibility |
|-----------|---------------|
| normalisation.ts | Fix raw LLM output format issues |
| schema-v3.ts | Transform to canonical V3 schema |
| graph-normalizer.ts | Bridge V3→V1 for ISL compatibility |
| PLoT | Consume analysis_ready without further transforms |

---

## Recommendations

### 1. Add Telemetry to Silent Repairs (Medium Priority)

Add telemetry events for:
- `cee.structure.decision_branch_normalized` - when beliefs normalized
- `cee.structure.single_goal_enforced` - when goals merged
- `cee.structure.outcome_belief_defaulted` - when beliefs filled

### 2. Document Silent Defaults (Low Priority)

The silent defaults (0.5 for missing strength/belief) are documented in code comments but could benefit from:
- API documentation noting these defaults
- Debug logging when fallback values used

### 3. No Transforms Should Move to PLoT

Current separation is correct:
- CEE handles schema normalization
- PLoT receives already-normalized data via analysis_ready
- ISL normalizer is specific to ISL engine requirements

### 4. Deprecation Path for V1/V2 (Future)

V1 and V2 schema paths contain legacy transforms. When deprecated:
- Remove schema-v2.ts entirely
- Remove V1 fallback logic from normalisation.ts
- Simplify graph-normalizer.ts

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| [src/adapters/llm/normalisation.ts](../../src/adapters/llm/normalisation.ts) | 385 | LLM output normalization |
| [src/cee/transforms/schema-v3.ts](../../src/cee/transforms/schema-v3.ts) | 791 | V3 schema transformation |
| [src/cee/transforms/schema-v2.ts](../../src/cee/transforms/schema-v2.ts) | 496 | V2 schema transformation |
| [src/cee/transforms/strength-derivation.ts](../../src/cee/transforms/strength-derivation.ts) | 94 | Uncertainty derivation |
| [src/cee/transforms/value-uncertainty-derivation.ts](../../src/cee/transforms/value-uncertainty-derivation.ts) | 249 | Value uncertainty |
| [src/cee/utils/id-normalizer.ts](../../src/cee/utils/id-normalizer.ts) | 167 | ID normalization |
| [src/cee/decision-review/graph-normalizer.ts](../../src/cee/decision-review/graph-normalizer.ts) | 290 | ISL bridge |
| [src/cee/structure/index.ts](../../src/cee/structure/index.ts) | 841 | Graph structure fixes |

---

*Audit completed: 2026-01-20*
