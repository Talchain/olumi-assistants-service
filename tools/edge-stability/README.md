# Edge-Stability Harness (Sci-1A)

Permanent regression harness for the **draft-path parameter lottery**: how much do CEE's
drafted numbers and structure depend on LLM nondeterminism? Runs each brief in a locked
gold set through the draft path N times and measures reproducibility. Deterministic metrics
only — no semantic judging. **Benchmark tooling; never product, never PMS, never production.**

Motivation: LLM coefficient elicitation is provably unstable (Linear-LLM-SCM, Feb 2026). This
gives continuous, attributable visibility into our exposure and gates whether pairwise
decomposition (Sci-2A) is worth building.

## Architecture
- **Reuses bakeoff-v6 as the draft runner.** The multi-seed draft run is produced by the
  bakeoff CLI; this tool *measures* the resulting candidate records (identical record shape:
  one arm × brief × seed, drafted graph in `candidate`).
- `src/metrics.ts` — deterministic metrics core: canonical edge identity (normalised
  from-label → to-label, exact + fuzzy Jaccard tiers), per-edge CV of strength.mean/std/
  exists_probability, edge appearance rate, structural (node/edge count) variance.
- `src/run.ts` — consumes a bakeoff run dir → per-brief stability → markdown + JSON report.
- Uses only Node builtins → run it with **bakeoff-v6's tsx** (no separate install).

## Run (v0)
```
cd tools/bakeoff-v6
# 1) collect: N independent draws per brief (seeds label the draws; Anthropic has no seed param)
npx tsx src/cli/run.ts --run-id es-v0 --arms A --prompt-set v0.4.3 --seeds 17,42,101,2024,7
# 2) measure:
npx tsx ../edge-stability/src/run.ts --run-dir results/es-v0 --label es-v0 --attribution-ref "$(git rev-parse --short HEAD)"
```
Report artifact lands in `tools/edge-stability/reports/es-v0.{md,json}`.

## Key finding shaping v0
Independent draws re-issue different node ids and reword labels, so the parameter lottery is
**structural + lexical**, not only coefficient noise. Edges are keyed by canonical label
identity; non-recurrence is the instability (reported as appearance rate), not a matching
failure. This makes the **recommended-option flip rate** (outcome stability via live PLoT
`/v2/run`) the metric that matters most — added in phase 2 with a **pinned ISL seed** so the
flip rate is attributable to draft variance, not Monte-Carlo noise.

## Roadmap (per the brief)
1. **v0** — 6 briefs × 5 seeds + report artifact. ← this
2. Gold set → 20+ briefs, locked in `GOLD-SET.md`.
3. Outcome-stability via draft→PLoT adapter (pinned seed).
4. Nightly workflow (authored here, orchestrator-merged): alert on any brief crossing 20%
   flip rate, or a CV regression > 50% vs the trailing baseline.
5. Neil-review gate on interpretation (which edges *should* be stable, defensible thresholds).
