# CEE Tier A — Draft Speed (ROADMAP 1.8) — measurement + verdict

Branch `claude-cee/draft-speed`, worktree off `origin/staging` tip `051d5c009`
(healthz `build: 051d5c0` confirmed live on `cee-staging` at measurement time —
deployed build matches the tip these numbers describe).

## STEP 0 — FIX-4 live grammar probe (edit_graph), closing the #401 known gap

```
schema: ANTHROPIC_EDIT_GRAPH_SCHEMA, serialized 995 bytes
PASS | claude-sonnet-4-6 | 995B | 3458ms | grammar compiled (HTTP 200)
```

Full output: `step0-edit-graph-grammar-probe.txt`. The `edit_graph` structured-output
schema (v2, Tier A #1) compiles live (HTTP 200, no "compiled grammar is too large"
400) — same rationale as the `draft_graph` v8 probe, now confirmed for the edit
path too. Closes the receipt-honesty lane's #401 gap: edit_graph grammar was
verified compiling in principle but never probed live with a real key.

## MAIN — latency breakdown (measure first)

### Method

Three live `POST /assist/v1/draft-graph` calls direct to `cee-staging`
(`https://cee-staging.onrender.com`), each with a distinct realistic brief, header
`X-Olumi-Debug: timings` set to receive the `_timings.draft_graph` block (server
permission gate `V5_TIMING_DEBUG=true` was already ON in cee-staging env — verified
via the Render API before the runs, not toggled by this lane). Full response
bodies captured as `live-draft-{1,2,3}-*.json`; timing/token summary below is
pulled directly from `_timings.draft_graph` and `trace.pipeline.llm_metadata` in
each capture — nothing here is estimated.

### Results

| # | brief (nodes/edges/options) | curl wall (ms) | server `total_ms` | LLM call `parse_llm_ms` | non-LLM pipeline (ms) | network (ms) | completion tokens | tok/s | prompt tokens (uncached) | cache_status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | EU market expansion (18n/36e/4opt) | 73,829 | 73,490 | 73,321 | 169 | 339 | 5,634 | 76.8 | 329 | stale (rewrite) |
| 2 | EV delivery fleet (n/e not re-tallied) | 61,382 | 61,008 | 60,948 | 60 | 374 | 4,682 | 76.8 | 339 | fresh (hit) |
| 3 | Hospital nurse staffing | 65,133 | 64,841 | 64,769 | 72 | 292 | 5,240 | 80.9 | 310 | fresh (hit) |

`non-LLM pipeline` = server `total_ms` − `parse_llm_ms` (normalise + enrich +
repair + threshold-sweep + validation-pipeline + package + boundary stages,
summed). `network` = curl wall-clock − server `total_ms` (TLS/TCP + request/
response transfer for a 56–62 KB response body). `tok/s` = completion_tokens ÷
(parse_llm_ms/1000).

**As a share of user-perceived (curl wall-clock) time:**

| # | LLM generation | CEE pipeline | Network |
|---|---:|---:|---:|
| 1 | 99.31% | 0.23% | 0.46% |
| 2 | 99.29% | 0.10% | 0.61% |
| 3 | 99.44% | 0.11% | 0.45% |

All three: `repair_fired: false` (the LLM repair pass never engaged on these
runs — grammar-v8 already producing clean-enough first-pass output),
`structured_outputs_used: true` (no fallback-to-prompt-only-JSON on any of the
three; the 400 that used to force the fallback is gone post-#367), same
prompt version served throughout (`draft_graph_default@v194 (staging)`).

### Verdict

**The 50–75 s draft latency is ~99.3–99.4% pure LLM decode time, and it is
essentially irreducible from CEE's side without either shrinking the graph
content itself or accepting a quality/model tradeoff the brief rules out.**

Three independent lines of evidence converge on this, not just one:

1. **Non-LLM pipeline overhead is 60–169 ms out of 61,000–73,500 ms total**
   (0.1–0.2% of server time). Parsing, normalising, enriching, the
   deterministic repair sweep, threshold sweep, validation, packaging, and
   boundary-shaping — every stage CEE's own code controls — together cost
   less than two-tenths of one percent of the turn. There is no pipeline
   stage worth parallelising: you cannot meaningfully speed up 100 ms hiding
   inside a 65,000 ms call.
2. **Decode throughput is flat at ~77–81 tokens/sec across all three calls**,
   regardless of prompt-cache state (draft #1 hit a *stale* cache — a full
   cache rewrite — and drafts #2/#3 hit a *fresh* cache; the tok/s figures
   are within 5% of each other either way). This rules out prompt-processing
   /prefill and cache misses as a material contributor: the model is decode-
   bound on output length, full stop.
3. **`max_tokens` (16,384) is not a lever.** Actual completions ran
   4,682–5,634 tokens — 29–36% of the cap — with `finish_reason: end_turn`
   on all three. Nothing is truncating or retrying; lowering `max_tokens`
   would not speed up a call that already stops well short of it.

### Candidate levers evaluated (per the brief — not assumed)

- **Output-size trim on aux subtrees (coaching / causal_claims / topology_plan
  — the "v8 stringified aux fields" fields).** Checked directly against the
  three captures: `causal_claims` and `topology_plan` were **empty (`[]`, 2
  bytes) on all three live drafts** — they contribute ~0% of output tokens
  today, not "inflating generation tokens" as hypothesised. `coaching` is
  non-trivial (1,608–1,864 chars, ~8–11% of the raw completion) but it is a
  real, shipped product feature (drives the UI's strengthen/coaching
  surfaces) — cutting it would directly regress "aux completeness," which
  this lane's own gate forbids. **Verdict: no justified trim here; the aux
  subtrees are not the inflation source the hypothesis suspected.**
- **The dominant cost is `nodes` + `edges`** (13.5–17.7 KB combined per
  capture, 75–85% of the raw completion) — i.e., the actual decision graph
  content the user asked for. Trimming that is a quality regression by
  definition, not a latency win.
- **max_tokens / prompt right-sizing.** Prompt is already tiny post-caching
  (310–339 uncached tokens per call) and `max_tokens` is not binding (see
  above). No win available on either axis.
- **Parallelising post-LLM pipeline stages.** Total non-LLM pipeline time is
  60–169 ms. Parallelising six stages that together cost under 0.2% of the
  turn is not a "highest-value bounded win" — it's noise.
- **Wire-format compaction (e.g. collapsing the three redundant provenance
  fields observed on every edge — `provenance.source` / `provenance_display`
  / `origin` all encoding "AI-inferred" in slightly different shapes) is a
  real, plausible token-reduction idea** spotted while inspecting the raw
  node/edge shapes, but it is a **cross-repo wire-contract change**
  (`@talchain/schemas`, consumed by PLoT/UI) — squarely the platform's
  schema-version-skew hazard, and explicitly out of bounds for a single-repo
  CEE lane. **Filed as a new roadmap candidate below, not implemented here.**
- **Model swap** — out of scope per the brief (product call); not evaluated.

### What was NOT done, and why

No code change is included in this lane. Every bounded, single-repo,
quality-safe lever the brief asked to evaluate turned out — on live evidence,
not assumption — to be either already-negligible (pipeline stages, aux
subtrees, prompt size, max_tokens) or to require crossing a repo boundary
this lane isn't scoped for (wire-format compaction). Forcing a change here
would either save ~0.2% of wall-clock (not worth the risk/review cost) or
require a multi-repo contract change this lane cannot safely land alone.
Per the brief's own instruction: when the breakdown shows the time is
~all irreducible LLM generation, say so with numbers rather than force a
fake win.

### Recommendation

1. **Route latency through UX, not further compute-side squeezing**: land
   ROADMAP **2.16 (staged-progress narration during the ~55–75 s draft)** —
   the honest, bounded, high-value response to a decode-bound call. This
   lane's numbers (99.3–99.4% LLM, flat ~78 tok/s, 4.7–5.6k completion
   tokens) are the evidence base for that row.
2. **New roadmap candidate** (not this lane, cross-repo, Paul-gated): audit
   whether `provenance.source` / `provenance_display` / `origin` on every
   edge (and equivalent redundancy elsewhere in the node/edge schema) can be
   collapsed to one field without an information loss for PLoT/UI consumers.
   With 36 edges in draft #1 alone, three overlapping provenance encodings
   per edge is a real, if modest, token tax — but changing it means walking
   the `@talchain/schemas` producer→validator→consumer chain across
   CEE/PLoT/UI, which is out of this lane's blast radius.
3. Confirm with the orchestrator whether `2.16` should now move out of
   "if 1.8 lands via UX route" conditional phrasing in ROADMAP.md into a
   committed row — this lane's finding is that the UX route is the only
   honest route available given the data above (only the orchestrator
   writes ROADMAP.md/PROGRAM-BOARD.md; this file is the evidence, not
   the row edit).

## Gates

No `src/` changes were made (measurement-only lane; the breakdown itself is
the deliverable). `pnpm run typecheck:src` is clean on this branch (see
`typecheck-src.txt`) confirming the baseline is undisturbed. Full
`test:required` / `validate-prepush` were not re-run since nothing in `src/`
changed — the baseline gate state carried over from `origin/staging` tip
`051d5c009` is unaffected by a docs+evidence-only diff.

## Files in this directory

- `step0-edit-graph-grammar-probe.txt` — STEP 0 probe output.
- `live-draft-1-eu-expansion.json`, `live-draft-2-ev-fleet.json`,
  `live-draft-3-hospital-staffing.json` — full response bodies from the three
  live `cee-staging` draft calls (synthetic briefs, no real user data),
  including the raw `_timings.draft_graph` and `trace.pipeline.llm_metadata`
  blocks the table above is drawn from.
- `typecheck-src.txt` — clean `pnpm run typecheck:src` output on this branch.
