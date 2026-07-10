# Benchmark ↔ served-prompt PARITY CHECKLIST

**Standing lesson (filed 2026-07-09).** A benchmark arm prompt must carry the SERVED prompt's
structural REQUIREMENTS, not just satisfy the schema's optional shape. **schema-optional +
prompt-required is a live-representativeness trap**: the structured-output schema
(`ANTHROPIC_DRAFT_GRAPH_SCHEMA`) makes a field optional, the served prompt *requires* the model
to populate it, and a benchmark prompt that only mentions the concept produces drafts that omit
it — so the benchmark measures a draft the live product never emits.

**How it bit us:** the M1 benchmark prompts (v0.4.3/v0.4.4/m1-dedup) mentioned "intervention
values" conceptually but never required `data.interventions` emission. The served prompt does
(`src/prompts/defaults.ts:108/:137/:180/:599/:621`). Every benchmark M1 draft therefore omitted
per-option interventions, and the edge-stability outcome-flip pass ran on option-less drafts
(buy≡build was an artifact of that gap, not the live draft). Cost: a full re-baseline.

## The check — run before ANY arm goes to a scored/measured run
1. Open the served draft prompt (`src/prompts/defaults.ts`, the active served version) and list
   every **structural requirement** — the imperative "must"/"each option must"/"no two…" class,
   not the optional/descriptive lines. Grep starting points: `must`, `each option`, `every`,
   `no two`, numbered output-contract rules, and any explicit `data.<field>` mention.
2. Diff the arm prompt against that list. For each served requirement, the arm prompt either
   **carries an equivalent requirement** or **records a justified, deliberate omission** (e.g. a
   field the benchmark intentionally ablates — note WHY and what it changes about representativeness).
3. Pay special attention to fields that are **optional in the schema but required in the prompt**
   (the trap class): `data.interventions` on options, and any future field where the schema says
   optional but the served prompt says "must".
4. No silent omissions. An omission with no recorded justification is a parity defect and blocks
   the run until resolved (align the prompt) or justified (documented ablation).

## Known parity requirements (keep current as the served prompt evolves)
| served requirement | served ref | benchmark status |
|---|---|---|
| Each option emits `data.interventions` (array {factor_id,value}); no two identical | defaults.ts:108/137/180 | ALIGNED 2026-07-09 in 8/14 M1 prompt files — see manifest below |
| Graph is a connected DAG; every factor reaches an outcome/risk | defaults.ts:~5/9 | present (STRUCTURE + FACTORS rules) |
| Every edge `effect_direction` matches sign of `strength.mean` | defaults.ts:~7 | present (PARAMETERS) |
| Causal edges have varied coefficients (not all 0.5) | defaults.ts:~10 | present (PARAMETERS) |

Extend this table whenever the served prompt gains a structural requirement, and re-diff before
the next scored run.

## Alignment manifest (complete scope, per the absence-claim rule)
**Precise claim:** *every M1-emitting arm prompt in the prompt-sets that back the faithful
`es-v0a` measurement and its blind-grade companions carries the served `data.interventions`
structural REQUIREMENT (emission + "no two identical"), not merely a descriptive mention.*

**Scope searched (exhaustive, not sampled):** `prompts/**/{arm-a,arm-c.m1}.system.txt` — every
M1-emitting file across all 7 prompt-sets (arm-a = M1; arm-c.m1 = arm-C's M1 draft leg). 14 files.
Alignment marker = file contains BOTH `data.interventions` AND the "no two options … identical"
uniqueness clause (grep-verified 2026-07-09; not a mention count).

| prompt-set | arm-a.system.txt | arm-c.m1.system.txt | status |
|---|---|---|---|
| `prompts/` (default) | ✅ | ✅ | ALIGNED |
| `prompts/v0.4.3/` | ✅ | ✅ | ALIGNED — **the set that produced the es-v0a number of record** |
| `prompts/v0.4.4/` | ✅ | ✅ | ALIGNED |
| `prompts/m1-dedup/` | ✅ | ✅ | ALIGNED — blind-grade companion draws |
| `prompts/m1-plain/` | ✗ | ✗ | ABLATION — descriptive mention only (2×), requirement absent BY DESIGN (plain variant) |
| `prompts/m1-lean-audit/` | ✗ | ✗ | ABLATION — mention only (1×), requirement absent BY DESIGN (lean variant) |
| `prompts/v0.4.3-B/` | ✗ | ✗ | UNALIGNED — mention only (1×); a v0.4.3 B-variant NOT yet re-aligned |

**Load-bearing conclusion:** the faithful flip-rate (v0.4.3) and every blind-grade companion
(m1-dedup, default, v0.4.4) run on ALIGNED prompts — the number of record is clean. The three
✗ sets are experimental/ablation variants that were **not** used in any measured run; each is a
deliberate ablation (m1-plain, m1-lean-audit) or a not-yet-realigned draft (v0.4.3-B), and per
check step 4 any of them is **blocked from a scored run** until it is either aligned or its
omission is recorded as a justified ablation. This corrects the earlier "all M1 arm prompts"
phrasing, which overgeneralised from the aligned subset.
