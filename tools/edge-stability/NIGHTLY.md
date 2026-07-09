# Edge-Stability nightly workflow — design (authored-by-lane, merged-by-orchestrator)

Purpose: run the full instrument against the locked gold set on a schedule, compare to a trailing
baseline, and alert on a real regression. Authored here; the orchestrator reviews + merges the CI
wiring (it touches product-repo `.github/` + secrets).

## What one nightly run does
1. **Draft** the gold set (GOLD-SET.md, currently 22 briefs) × 5 seeds through arm A under the
   pinned canonical M1 prompt (`--prompt-set v0.4.3`, aligned). ~110 draft calls (~$10 Anthropic).
2. **Emit V2** (draft's own interventions; [0,1] regime asserted) and **run PLoT** `/v2/run` per
   draft with the pinned ISL seed (110 infra calls; retry-on-transient in place).
3. **Compute** per-brief: which-option + act-vs-SQ flip-rate; structural CV/heatmap; node-label
   reproducibility; sign-flips; option-differentiation rate; no-goal-node / analysis-failed skips.
4. **Compare to the trailing baseline** (the prior N good runs, stored as a committed JSON baseline
   in `reports/baseline/`).

## Alert conditions (fail the run / notify)
- **Flip-rate breach:** any brief's faithful which-option flip-rate crosses **20%** where the
  trailing baseline was ≤20% (a NEW instability), OR the gold-set mean flip-rate rises materially
  vs baseline. (Most briefs already flag >20% at v1 — so the alert is *change vs baseline*, not the
  absolute >20%; the absolute number is the standing finding, the alert watches drift.)
- **CV regression:** any brief's structural edge-count CV, or mean strength.mean CV over recurring
  causal edges, worsens by **>50%** vs the trailing baseline.
- **Fidelity guards (hard fails, not drift):** option-differentiation rate drops below a floor
  (the data.interventions requirement silently regressed — the exact class of bug the parity
  checklist exists to catch); or draft validity drops; or `seed_used` stops echoing the pinned seed
  (regime/seed integrity broken → the whole comparison is void).

## Baseline discipline
- Baseline = median of the last K accepted runs (K≥3), committed. A run only updates the baseline
  after a human/orchestrator accepts it (no silent baseline drift that would mask a slow regression).
- The FIRST baseline is a clean 22-brief × 5-seed run under aligned prompts (not yet taken — it is
  the first nightly's job, flagged as baseline-establishing, no alerts).

## Cost / cadence
- ~$10 Anthropic + ~110 PLoT infra calls per run. Nightly is defensible for a permanent instrument;
  if cost is a concern, cadence can drop to 2–3×/week or the gold set can be sampled (log the sample).

## Secrets / wiring (orchestrator-owned at merge)
- `ANTHROPIC_API_KEY`, `PLOT_AUTH_TOKEN`, `PLOT_BASE_URL` as CI secrets. Never logged.
- Workflow: `.github/workflows/edge-stability-nightly.yml` (cron) → runs a single entrypoint
  `tools/edge-stability/src/nightly.ts` (to be authored) that does steps 1–4 + the alert exit code.

## Open decisions for the orchestrator before the YAML lands
1. Absolute-threshold vs drift-vs-baseline for the flip-rate alert (recommend drift, since v1
   absolutes are already high — the finding, not the alarm).
2. Nightly vs 2–3×/week (cost).
3. Where alerts go (CI failure only, or a notification channel).
