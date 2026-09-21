# The current pipeline, brief → canonical

Derived from the imports in `src/cee/unified-pipeline/index.ts:46-56` at
`ce28ab22`. Not a description of intent — the actual call order.

## The sequence

```
BRIEF (user prose)
  │
  ├─► LLM draft call  ── grammar: src/cee/draft/records/grammar.ts (47,459 B)
  │                      instruction: src/cee/draft/records/instruction.ts (34,824 B)
  │                      prompt family: src/prompts/defaults-v187.ts (43,694 B)
  │                      ⚠ WHICH version is served is UNRESOLVED — see below
  │
  ├─► SEAM            ── src/cee/draft/records/seam.ts
  │                      Zod parse (StatedItemWire / claims), then a
  │                      HAND-WRITTEN rebuild (:305) pinned by a derived
  │                      completeness guard (:526-543).
  │                      Emits cee.draft.records.wire_histogram (:450)
  │
  ├─► PROJECTOR       ── src/cee/draft/records/projector.ts
  │                      stated_items → nodes (pass 1, :2482)
  │                      claims       → nodes/edges (pass 2, :3223)
  │                      connectivity prune (:3757-3843)
  │
  └─► UNIFIED PIPELINE, in this order:
        1. parse                     stages/parse.ts
        2. normalise                 stages/normalise.ts
        3. enrich                    stages/enrich.ts
        4. option-mapping-recovery   stages/option-mapping-recovery.ts
        5. repair                    stages/repair/index.ts   ← 23 sub-stages
        6. coaching-pass             stages/coaching-pass.ts
        7. package                   stages/package.ts
        8. boundary                  stages/boundary.ts
        9. threshold-sweep           stages/threshold-sweep.ts
           + validation-pipeline     ../validation-pipeline/index.ts
  │
  └─► V3 TRANSFORM    ── src/cee/transforms/schema-v3.ts
                         :457-459  observed_state.source  (12 → 2 members)
                         :892-912  2.972 from_brief withdrawal
                         :1665     projectNodeProvenance (overwrites :1518-1521)
  │
  └─► CANONICAL MODEL → persisted; analysis reloads it (UI never sends a graph)
```

## Deterministic stages that can materially change semantics

⭐ These are the ones to audit first — each can alter meaning, not just shape.

| stage | file | semantic power |
|---|---|---|
| **V3 source mapping** | `schema-v3.ts:457-459` | **assigns authorship**; defaults to `brief_extraction` |
| **intervention extraction** | `extraction/intervention-extractor.ts:1243` | early-return makes every warrant check below it dead |
| **semantic factor matching** | `extraction/factor-matcher.ts:31` | `rate ≈ price` → wrote `churn := 0.102` |
| **connectivity prune** | `projector.ts:3757-3843` | **deletes nodes** and `delete provenance[node.id]` (:3842) |
| **constraint direction map** | `projector.ts:1044-1054` | `floor`/`ceiling` → `>=`/`<=`; **no strict operator exists** |
| **2.972 withdrawal** | `schema-v3.ts:892-912` | `from_brief` → `ai_inferred`, but leaves `observed_state.source` stale |
| **provenance overwrite** | `schema-v3.ts:1518-1521` | unconditional rewrite of `node.provenance` |
| **option framing** | `records/option-framing.ts:166-170` | **flips a stated option to `ai_inferred`** |
| **no-op target repair** | `repair/no-op-target-repair.ts` | rewrites intervention targets |
| **observed-state salvage** | `repair/observed-state-salvage.ts` | sheds a malformed optional field (#1674, fail-closed) |

## Models

Configured ids across `src/config/` and `src/cee/draft/` (occurrence counts,
**not** a statement of what is served): `claude-sonnet-5` ×17,
`gpt-4.1-2025-04-14` ×16, `claude-sonnet-4-6` ×12, `gpt-4.1` ×10, `gpt-5.2` ×9,
`claude-haiku-4-5` ×7, `gpt-4o` ×6, `gpt-4o-mini` ×5, `gpt-5-mini` ×4.

Per an earlier measurement this session, deployed CEE runs `claude-sonnet-5`
for 7 of 8 roles.

## ⚠ The unresolved question that gates several findings

**Four prompt generations coexist** — `defaults.ts` (130,811 B),
`defaults-v187.ts` (43,694 B), `defaults-v19.ts` (38,861 B),
`defaults-v15.ts` (37,381 B) — **with different constraint-mapping text**.
Three independent evidence sweeps each flagged that they could not resolve
which is served. Findings attributed to v187/v201 rest on in-repo comments
citing past captures.

**Settle this first.** It is cheap and several conclusions depend on it.
