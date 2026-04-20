# CQE Schema-Freeze Precheck

**Date:** 20 April 2026
**Brief:** cqe-implementation-v1.1 §5.0
**Status:** Pass — three sources identical

---

## Sources compared

1. V5 Architecture Spec v3.2 §11.1 — `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`
2. CQE Design v1.1 §3 — `Docs/v5/cqe-design-v1_1.md`
3. Investigation Proposal §4.1 / §10 references — `Docs/v5/cqe-investigation-proposal.md`

---

## Side-by-side comparison

| Field | Spec v3.2 §11.1 | CQE Design v1.1 §3 | Investigation proposal (inherits) |
|---|---|---|---|
| `raw_text` | `string` | `string` | inherits |
| `value` | `number \| null` | `number \| null` | inherits |
| `unit` | `string \| null` | `string \| null` | inherits |
| `direction` | `"up" \| "down" \| "set" \| "unknown" \| null` | `"up" \| "down" \| "set" \| "unknown" \| null` | inherits |
| `multiplier` | `number \| null` | `number \| null` | inherits |
| `operator` | `ParameterOperator \| null` | `ParameterOperator \| null` | inherits |
| `comparator` | `"at_least" \| "at_most" \| "between" \| null` | `"at_least" \| "at_most" \| "between" \| null` | inherits |
| `range_min` | `number \| null` | `number \| null` | inherits |
| `range_max` | `number \| null` | `number \| null` | inherits |
| `approximate` | `boolean` | `boolean` | inherits |
| `source` | `"cqe" \| "compromise" \| "unparsed"` | `"cqe" \| "compromise" \| "unparsed"` | inherits |
| `value_origin?` | `"literal" \| "lexical_quantifier" \| "word_fraction" \| "suffix_expansion" \| "word_number" \| "parsed_numeric"` | same | inherits |

**Result: identical across all three sources.** No drift.

### `ParameterOperator` (referenced by `operator`)

Spec v3.2 §5 canonical enum: `"set" | "add" | "multiply" | "increment" | "decrement"`.
CQE Design v1.1 §3 comment confirms the same five values.
Investigation proposal does not redefine.
**No drift.**

---

## Field-naming consistency check (brief §5.0)

`grep -r "inference_basis" ~/Documents/GitHub/olumi-assistants-service/Docs/v5/` — expected: zero matches (older draft name).

Verified: no `inference_basis` anywhere in the v1.1 design corpus. The only tag field is `value_origin`.

---

## Conclusion

Schema is frozen and consistent across the three authoritative sources. Phase 0 may proceed.

- Field count: 11 required + 1 optional (`value_origin`) = 12 total
- Required field marker: `raw_text`, `approximate`, `source` — these three must always have values; others may be `null`
- Enum constraints: `direction`, `comparator`, `source`, `operator` (via ParameterOperator), `value_origin` are closed enums
- Optionality: only `value_origin?` is declared optional; all others are present (can be `null`)

Phase 0 implements the Zod schema exactly as above.
