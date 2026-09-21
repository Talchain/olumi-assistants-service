# Graph Evaluator

A CLI tool for evaluating LLM draft-graph generation quality across multiple OpenAI models and prompt versions. Calls OpenAI directly (not via CEE endpoints), scores the resulting graphs on automated quality metrics, and produces comparison reports.

## Why this exists

We need to determine which OpenAI model to use for fast, normal, and deep graph generation modes. This tool is reusable — when we change prompts or add models, we re-run without code changes.

## Setup

```bash
cd tools/graph-evaluator
pnpm install
```

Copy your `.env` file:

```bash
cp .env.example .env   # or create manually
```

Required environment variables (set in `.env`):

```
OPENAI_API_KEY=sk-...
```

## Usage

```bash
# Run all models against all briefs with a specified prompt
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt

# Run specific models
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --models gpt-4.1,gpt-5-mini

# Run a specific brief
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --briefs 01-simple-binary

# Dry run — see what would execute without calling APIs
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --dry-run

# Force re-run (ignore cache)
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --force

# Resume failed runs only (re-runs parse_failed, timeout_failed, rate_limited)
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --resume
```

**`--prompt` is required.** This forces explicit prompt version selection every run.

Results are written to `results/{run_id}/`:
- `run.json` — run manifest with provenance (git SHA, file hashes)
- `{model_id}/{brief_id}/response.json` — raw response + parsed graph + metadata
- `scores.csv` — all scores in tabular form
- `summary.md` — ranked table, per-mode breakdown, failure summary
- `analysis-pack.md` — designed for pasting into an LLM conversation for qualitative review

## Adding a new model

Create a JSON file in `models/`:

```json
{
  "id": "gpt-4.2",
  "display_name": "GPT-4.2",
  "provider": "openai",
  "model": "gpt-4.2",
  "api_key_env": "OPENAI_API_KEY",
  "params": {
    "temperature": 0
  },
  "target_mode": "normal",
  "pricing": {
    "input_per_1m": 2.50,
    "output_per_1m": 10.00,
    "source": "openai_api_docs_2026-03"
  }
}
```

For reasoning models (e.g., o-series), add `reasoning_effort` to `params`:

```json
"params": {
  "reasoning_effort": "high"
}
```

**No code changes required.** The runner detects `reasoning_effort` and uses the `reasoning` parameter in the API call automatically.

See `models/_template.json` for the full template.

## Adding a new brief

Create a markdown file in `briefs/` with YAML front-matter:

```markdown
---
expect_status_quo: true
has_numeric_target: false
complexity: simple
---

Your brief text here. This is what gets sent to the LLM as the user message.
```

**Front-matter fields:**
- `expect_status_quo` (bool) — whether a "Status Quo" option is expected in the graph
- `has_numeric_target` (bool) — whether the brief contains an explicit numeric success target (affects scoring of goal threshold)
- `complexity` (`simple` | `moderate` | `complex`) — used for reporting

**No code changes required.**

## Switching prompts

Pass a different `--prompt` file:

```bash
npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v21.txt
```

The run ID includes the prompt filename, so runs with different prompts produce separate result directories. Prompt content is hashed in the run manifest for traceability.

## Scoring methodology

All scoring is **deterministic** — no LLM judge.

### ⚠ Rubric version — read before comparing any two runs

Every `ScoreResult`, every row of `scores.csv`, and the header of every generated
report carries a **`rubric_version`**. The current value is defined by
`DRAFT_RUBRIC_VERSION` in `src/scorer.ts`.

**Scores produced under different rubric versions are DIFFERENT MEASURES.** Do
not plot them on one axis, average them together, plug them into a regression
check, or describe a rubric change as a quality change. Results predating the
introduction of this field carry no `rubric_version` column — treat an absent
column as `draft-graph-rubric-1` and do not compare it with rubric 2.

#### The rubric's governing invariant

> **The rubric scores only fields the model is PERMITTED to emit.**

A rubric term that rewards a field the model cannot write is not a quality
measure. It is unearnable for every model equally, and it silently advantages
any graph that has been through the enricher. `tests/rubric-invariant.test.ts`
enforces this **by derivation**: it reads CEE's own `CEE_MINTED_GOAL_FIELDS`
(`src/adapters/llm/normalisation.ts` — the list the ingress strip applies) at run
time and asserts that setting any of those fields cannot change a score. It is
not a hand-maintained copy, and it fails loud if it cannot find the list.

### Rubric changelog

#### `draft-graph-rubric-2.0.0` — 2026-08-02 (ROADMAP 2.285a)

**⚠ NOT COMPARABLE WITH EARLIER RESULTS.** This is a re-cut of the rubric, not a
bug-fix that restores the old numbers.

Trigger: PR #789 (ROADMAP 2.281) made the enricher the only mint of
`goal_threshold` — the quad is cut from the sent grammar by
`buildDraftGraphSchema()` and stripped at ingress by
`stripModelAuthoredGoalThreshold()`. The model can no longer author
`goal_threshold`, `goal_threshold_raw`, `goal_threshold_unit`, or
`goal_threshold_cap`. Rubric 1 scored all of them.

| Rubric term | Rubric 1 | Rubric 2 |
|---|---|---|
| Completeness → *goal threshold* (0.20 of the dimension) | `goalNode.goal_threshold != null` — **unearnable post-#789**, so every numeric-target brief silently lost 0.20 of completeness (0.04 of overall) | Renamed *numeric-target capture*: a well-formed `goal_constraints[]` entry (finite `value` + `>=`/`<=` operator). **1.0** on the goal node · **0.5** on another node · **0.0** if absent |
| Completeness → *currency preservation* (0.10) | Preferred `goal_threshold_unit` ahead of every other channel | `goal_threshold_unit` **not consulted**. Goal node `data.unit` → `goal_constraints[].unit` → any node's `data.unit` |
| Ratio encoding | Hard-zeroed on `goal_threshold < expected_min` | That arm **removed**. Still hard-zeroes on `data.value` and `goal_constraints[].value` |

**This is a change of question, not a relocation of the same one.** Rubric 1
asked *"did the model set the goal's threshold?"*. Rubric 2 asks *"did the model
record the brief's numeric target as a machine-readable constraint?"*. Rubric 1's
question is now unanswerable **and no longer about the model at all**: the
enricher derives the threshold from **brief text by regex**
(`src/cee/factor-extraction/enricher.ts`, value from
`extractGoalTargetWithBaseline`), not from anything the draft contains.

⚠ **`goal_constraints[]` does NOT become the goal threshold.** Nothing maps a
model-authored constraint into the quad; the array is forwarded to PLoT
(`parse.ts` → `compound-goals.ts` → `package.ts`). Do not read the numeric-target
sub-dimension as a proxy for threshold extraction.

Known overlap, stated rather than hidden: dimension 5 (*constraint retention*)
also reads `goal_constraints[]`, but only against a brief's
`expected_constraints` front-matter — which **no brief in `briefs/` currently
sets**, so dimension 5 returns 1.0 (not-applicable) for the whole shipped corpus.
The two terms ask different questions (*was the target recorded at all* vs *does
each expected constraint match on operator and value*), but if
`expected_constraints` is ever populated they will share evidence.

Effect on `scripts/pipeline-parity-benchmark.ts`: under rubric 1 that benchmark
was **structurally biased**. Its pipeline arm goes through the enricher and
carries the quad; its raw arm cannot, post-#789. The pipeline therefore banked up
to 0.20 of completeness and 0.10 of currency that no raw draft could match — a
delta attributable to a forbidden field, not to pipeline quality. Parity deltas
from earlier runs are not comparable with rubric-2 deltas.

#### `draft-graph-rubric-1` — everything before the above

Unlabelled. Rewarded the goal-threshold quad. Results carry no `rubric_version`
column.

### 1. Structural validity (pass/fail)

Validates graph topology against the decision-graph specification:
- Exactly 1 goal, 1 decision, 2–6 options
- At least 1 outcome or risk
- No cycles (topological sort)
- No forbidden edge types (option→outcome, option→goal, factor→goal, decision→factor)
- Every controllable factor has ≥1 incoming option edge
- Every outcome/risk reachable from decision via controllable factor
- Every option has a path through controllable factors to goal
- No orphan nodes
- ≤50 nodes, ≤100 edges

If structural validation fails, all other scores are `null`.

### 2. Parameter quality (0–1)

Scores the diversity and calibration of causal edge parameters. Calculated from causal directed edges only (excludes structural edges and bidirected confounders).

| Sub-dimension | Weight | Description |
|---|---|---|
| Strength diversity | 25% | Distinct \|mean\| values (rounded to 1dp). Full marks at ≥3 distinct values. |
| Exists_prob diversity | 20% | Distinct exists_probability values. Full marks at ≥2 distinct values. |
| Std variation | 15% | Binary: 1.0 if std values differ across edges, 0.0 if all identical. |
| Default takeover | 25% | % of edges with \|mean\|=0.5 AND std=0.125. Penalised linearly — 0 at ≥50%. |
| Range discipline | 15% | Proportion of outcome/risk/goal nodes where Σ\|inbound mean\| ≤ 1.0. |

### 3. Option differentiation (0–1)

| Sub-dimension | Weight | Description |
|---|---|---|
| Status quo present | 25% | When brief.expect_status_quo=true, at least one option matches "status quo / baseline / keep / maintain". |
| No identical interventions | 25% | No two options have the same intervention map. |
| Each option sets ≥1 factor | 25% | Every option has non-empty interventions. |
| Unique factor per option | 25% | Every option touches at least one controllable factor not set by all other options. |

### 4. Completeness (0–1)

| Sub-dimension | Weight | Description |
|---|---|---|
| External factor present | 15% | At least 1 factor with category="external". |
| Coaching populated | 15% | Coaching object has ≥1 strengthen_item or a non-empty summary. |
| Numeric-target capture | 20% | When `brief.has_numeric_target=true`: a well-formed `goal_constraints[]` entry (finite `value` + `>=`/`<=`). 1.0 on the goal node, 0.5 on another node, 0.0 if absent. Full marks when the brief has no numeric target. **Rubric 2 — see the changelog above; this was `goal_threshold` under rubric 1.** |
| Factor label specificity | 20% | Proportion of factors with non-generic labels. Generic = ["market risk", "competition", "cost", "revenue", "growth", "risk", "demand", "supply"]. |
| Readability band | 20% | 6–12 nodes = full marks; 13–20 = 0.5 marks; >20 = 0 marks. |
| Currency preservation | 10% | When the brief names a currency, the graph preserves it in a **model-permitted** unit field: goal node `data.unit` → `goal_constraints[].unit` → any node's `data.unit`. Matched = 1.0, some unit but unmatched = 0.5, no unit anywhere = 0.0. Full marks when the brief names no currency. |

### 5. Overall score

```
overall_score = param_quality           × 0.20
              + option_diff             × 0.20
              + completeness            × 0.20
              + constraint_retention    × 0.15
              + external_factor_presence × 0.10
              + coaching_quality        × 0.10
              + ratio_encoding          × 0.05
```

Only calculated when `structural_valid === true`.

> ⚠ **This section was stale and has been corrected (2026-08-02).** It documented
> a three-dimension formula (`0.30 / 0.30 / 0.40`) and a five-sub-dimension
> completeness table, neither of which the code has used since the seven-dimension
> weighting landed — the weights above are read off `src/scorer.ts`. Dimensions
> 5–8 below were entirely undocumented here. A rubric description that drifts from
> the rubric is the same hand-maintained-mirror defect this tool now guards
> against in `tests/rubric-invariant.test.ts`; derive from `src/scorer.ts` if this
> table and the code ever disagree again.
>
> ⚠ Note also that dimensions 5 (constraint retention), 6 (ratio encoding) and 7
> (external factor presence) are gated on brief front-matter
> (`expected_constraints`, `ratio_metrics`, `expect_external_factor`) that **no
> brief in `briefs/` currently sets**. All three therefore return 1.0
> (not-applicable) for the entire shipped corpus — 30% of `overall_score` is
> currently constant. That is a corpus gap, not a rubric change, and it is not
> addressed by rubric 2.

### Efficiency metrics (not scored)

Reported in the CSV and reports: latency (ms), input/output/reasoning tokens, estimated cost ($), node count, edge count.

## Running tests

```bash
cd tools/graph-evaluator
pnpm test
```

Tests cover scorer dimensions (hand-built fixtures) and JSON extraction (fence/prose/invalid inputs).

## Project structure

```
tools/graph-evaluator/
├── src/
│   ├── cli.ts          # Entry point: arg parsing, orchestration, file I/O
│   ├── runner.ts       # LLM calls (OpenAI Responses API), retry, caching
│   ├── scorer.ts       # Deterministic scoring (5 dimensions)
│   ├── reporter.ts     # CSV + markdown generation
│   ├── json-extractor.ts  # 4-step JSON extraction pipeline
│   ├── validator.ts    # Pure structural validation functions
│   ├── io.ts           # File system utilities
│   └── types.ts        # Shared TypeScript interfaces
├── briefs/             # Brief files with YAML front-matter
├── models/             # Model config JSON files
├── prompts/            # Prompt text files (paste here)
├── tests/              # Vitest unit tests
└── results/            # Run outputs (gitignored)
```

## Architecture note — future UI integration

The core modules (`runner.ts`, `scorer.ts`, `reporter.ts`, `json-extractor.ts`) export clean async functions with typed I/O. They do not read CLI args, write to stdout, or perform file I/O directly. This means a future Express/Fastify API can import them directly without touching the CLI layer.

File I/O is isolated in `cli.ts` and `io.ts`. All state flows through typed interfaces (`RunConfig`, `ScoredResult`, `ReportFiles`).
