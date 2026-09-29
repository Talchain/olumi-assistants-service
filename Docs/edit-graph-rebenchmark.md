# Edit Graph Re-Benchmark Report

**Date:** 2026-03-14
**Prompt:** `edit_graph_v2` (sha256: 2d6fcbc9)
**Fixtures:** 12 cases (9 original + 3 new value-update)
**Models:** gpt-4.1, gpt-4o, claude-sonnet-4-6

---

## 1. Summary

| Model | Mean Score | Perfect (1.0) | Lowest | Avg Latency | Est. Cost |
|---|---|---|---|---|---|
| **gpt-4.1** | **0.867** | 3/12 | 0.800 | 3,364ms | $0.155 |
| **gpt-4o** | **0.858** | 3/12 | 0.750 | 2,727ms | $0.179 |
| **claude-sonnet-4-6** | **0.858** | 3/12 | 0.800 | 13,877ms | $0.000 (cached) |

All models achieved 100% valid JSON, correct shape, and topology compliance across all 12 cases.

---

## 2. Per-Case Results

### gpt-4.1

| Case | Score | op_types | topology | rationale | ordering | empty_ops | coaching | path_syntax | Latency |
|---|---|---|---|---|---|---|---|---|---|
| 01-add-factor | 0.850 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7,293ms |
| 02-remove-factor | 0.850 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5,151ms |
| 03-strengthen-edge | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 2,416ms |
| 04-forbidden-edge | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3,665ms |
| 05-compound | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 6,752ms |
| 06-already-satisfied | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1,540ms |
| 07-forbidden-refused | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1,905ms |
| 08-cycle-creation | 0.900 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | 2,400ms |
| 09-update-node-label | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 1,555ms |
| **10-reduce-edge** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 2,520ms |
| **11-change-value** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 3,667ms |
| **12-flip-direction** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 3,002ms |

### gpt-4o

| Case | Score | op_types | topology | rationale | ordering | empty_ops | coaching | path_syntax | Latency |
|---|---|---|---|---|---|---|---|---|---|
| 01-add-factor | 0.850 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4,905ms |
| 02-remove-factor | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | 2,830ms |
| 03-strengthen-edge | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 2,626ms |
| 04-forbidden-edge | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1,548ms |
| 05-compound | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5,824ms |
| 06-already-satisfied | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2,064ms |
| 07-forbidden-refused | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2,073ms |
| 08-cycle-creation | 0.900 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | 2,430ms |
| 09-update-node-label | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 2,401ms |
| **10-reduce-edge** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 1,483ms |
| **11-change-value** | 0.750 | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | 2,101ms |
| **12-flip-direction** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 2,433ms |

### claude-sonnet-4-6

| Case | Score | op_types | topology | rationale | ordering | empty_ops | coaching | path_syntax | Latency |
|---|---|---|---|---|---|---|---|---|---|
| 01-add-factor | 0.850 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 17,826ms |
| 02-remove-factor | 0.850 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 13,712ms |
| 03-strengthen-edge | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 15,772ms |
| 04-forbidden-edge | 0.900 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | 7,405ms |
| 05-compound | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 43,133ms |
| 06-already-satisfied | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7,114ms |
| 07-forbidden-refused | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8,976ms |
| 08-cycle-creation | **1.000** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 10,423ms |
| 09-update-node-label | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 4,375ms |
| **10-reduce-edge** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 15,704ms |
| **11-change-value** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 10,509ms |
| **12-flip-direction** | 0.800 | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 11,415ms |

---

## 3. New Value-Update Fixtures Analysis

Three new fixtures were added to test value-update operations (cases 10-12):

| Fixture | Edit Type | Expected Op | Description |
|---|---|---|---|
| 10-reduce-edge-strength | Edge value change | `update_edge` | Reduce investment→risk strength |
| 11-change-factor-value | Node data change | `update_node` | Set churn rate from 3% to 5% |
| 12-flip-effect-direction | Edge direction flip | `update_edge` | Competition negative→positive |

### Value-update scores (new fixtures only)

| Model | Case 10 | Case 11 | Case 12 | Mean |
|---|---|---|---|---|
| gpt-4.1 | 0.800 | 0.800 | 0.800 | **0.800** |
| gpt-4o | 0.800 | 0.750 | 0.800 | **0.783** |
| claude-sonnet-4-6 | 0.800 | 0.800 | 0.800 | **0.800** |

All three models score consistently on value-update cases. The main deduction is `operation_types_correct` (all models use `remove+add` instead of `update_edge`/`update_node`) and `path_syntax_valid` (non-standard path format).

gpt-4o scored lowest (0.750) on case 11 due to missing coaching in addition to the op-type and path-syntax misses.

---

## 4. Dimension Analysis

### Pass rates by dimension (all 12 cases)

| Dimension | Weight | gpt-4.1 | gpt-4o | claude-sonnet-4-6 |
|---|---|---|---|---|
| valid_json | 15% | 12/12 | 12/12 | 12/12 |
| correct_shape | 15% | 12/12 | 12/12 | 12/12 |
| operation_types_correct | 10% | 4/12 | 4/12 | 4/12 |
| **topology_compliant** | **20%** | **12/12** | **12/12** | **12/12** |
| has_impact_rationale | 10% | 12/12 | 12/12 | 12/12 |
| correct_ordering | 10% | 12/12 | 12/12 | 12/12 |
| empty_ops_handled | 5% | 11/12 | 11/12 | 11/12 |
| coaching_present | 10% | 12/12 | 10/12 | 12/12 |
| path_syntax_valid | 5% | 6/12 | 5/12 | 6/12 |

**Key findings:**
- **Topology compliance is perfect** across all models — the highest-weight dimension (20%) shows zero regressions
- **operation_types_correct** is the weakest dimension universally (4/12 for all models) — all models prefer `remove+add` over `update_edge`/`update_node` for value changes
- **path_syntax_valid** is the second weakest — models emit non-standard path formats for value-update operations
- Claude loses 1 `empty_ops_handled` on case 04 (forbidden-edge), while OpenAI models lose it on case 08 (cycle-creation)

---

## 5. Original vs New Fixtures

| Metric | Original 9 cases | New 3 value-update cases |
|---|---|---|
| gpt-4.1 mean | 0.889 | 0.800 |
| gpt-4o mean | 0.883 | 0.783 |
| claude-sonnet-4-6 mean | 0.878 | 0.800 |

Value-update cases score ~0.08-0.10 lower than the original fixture set. This is expected — the op-type dimension penalises `remove+add` patterns that functionally achieve the same result as `update_edge`.

---

## 6. Latency Comparison

| Model | Min | Mean | Max | Median |
|---|---|---|---|---|
| gpt-4.1 | 1,540ms | 3,364ms | 7,293ms | 2,568ms |
| gpt-4o | 1,483ms | 2,727ms | 5,824ms | 2,417ms |
| claude-sonnet-4-6 | 4,375ms | 13,877ms | 43,133ms | 10,466ms |

gpt-4o is fastest (2.7s avg). Claude is 5x slower (13.9s avg), with a 43s outlier on compound case 05.

---

## 7. Recommendations

### 1. Consider `deriveEquivalentTypes()` for op-type scoring

The scorer already has `deriveEquivalentTypes()` logic that treats `remove+add` on the same entity as equivalent to `update_*`. Verify this is running — all three models consistently use `remove+add` for value changes, which should map to `update_edge`/`update_node` through functional equivalence.

### 2. Path syntax prompt refinement

6 of 12 cases fail `path_syntax_valid` for all models. The v2 prompt may need clearer path format examples (e.g., `/edges/from_id->to_id` vs freeform descriptions).

### 3. Model selection for edit operations

| Factor | gpt-4.1 | gpt-4o | claude-sonnet-4-6 |
|---|---|---|---|
| Mean score | **0.867** | 0.858 | 0.858 |
| Latency | 3.4s | **2.7s** | 13.9s |
| Cost | $0.155 | $0.179 | $0.000 (cached) |
| Perfect scores | 3 | 3 | 3 |

gpt-4.1 has the highest mean score. gpt-4o has the lowest latency. Claude matches gpt-4o on score but is 5x slower. For edit operations where latency matters (user is waiting), gpt-4o or gpt-4.1 are preferred.

---

## Appendix: Run IDs

- gpt-4.1: `2026-03-14_01-27-40_edit_graph_v2`
- gpt-4o: `2026-03-14_01-27-41_edit_graph_v2`
- claude-sonnet-4-6: `2026-03-14_01-27-42_edit_graph_v2`
