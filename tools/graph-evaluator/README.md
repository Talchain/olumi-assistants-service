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
| External factor present | 20% | At least 1 factor with category="external". |
| Coaching populated | 20% | Coaching object has ≥1 strengthen_item or a non-empty summary. |
| Goal threshold | 20% | When brief.has_numeric_target=true, goal node has goal_threshold set. |
| Factor label specificity | 20% | Proportion of factors with non-generic labels. Generic = ["market risk", "competition", "cost", "revenue", "growth", "risk", "demand", "supply"]. |
| Readability band | 20% | 6–12 nodes = full marks; 13–20 = 0.5 marks; >20 = 0 marks. |

### 5. Overall score

```
overall_score = param_quality × 0.30 + option_diff × 0.30 + completeness × 0.40
```

Only calculated when `structural_valid === true`.

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
