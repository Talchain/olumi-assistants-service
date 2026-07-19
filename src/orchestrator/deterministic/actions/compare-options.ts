/**
 * compare_options Action
 *
 * Code templates comparison from option probabilities.
 * Returns a ComparisonBlock with structured option data.
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, ComparisonBlockData } from "../types.js";
import { createComparisonBlock } from "../../blocks/factory.js";
import { readRawRobustnessSignals } from "../../../orchestrator-v5/coaching/pick-raw-robustness.js";
import { nearTieReasonByMargin } from "../../../orchestrator-v5/coaching/robustness-honesty.js";

export const compareOptionsAction: ActionDefinition = {
  action_type: 'compare_options',
  description: 'Compare options side-by-side with probabilities and trade-offs.',
  stage_eligibility: new Set(['evaluate', 'decide', 'optimise']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'none',
  reversible: true,
  surface: 'inline',
  role: 'scientist',
  cooldown: 'suppress_same_turn',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.analysis_summary) return 'No analysis results available. Run analysis first.';
    if (!ctx.analysis) return 'No analysis data available.';
    return null;
  },

  async execute(_params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const analysis = ctx.analysis!;
    const rawResults = analysis.results;
    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return { blocks: [], assistantText: 'No analysis results available to compare.', guidance_items: [] };
    }
    const results = (rawResults as Array<Record<string, unknown>>)
      .filter((r) => r != null && typeof r === 'object' && typeof r.win_probability === 'number')
      .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

    if (results.length < 2) {
      return {
        blocks: [],
        assistantText: 'Need at least two options with analysis results to compare.',
        guidance_items: [],
      };
    }

    // Fix 4: differentiator source. Prefer the UI-forwarded factor_sensitivity
    // (carries influence_percent) over the legacy top_drivers.
    const factorSensitivity = ctx.analysis_summary?.factor_sensitivity ?? [];
    const topDrivers = ctx.analysis_summary?.top_drivers ?? [];
    const driverLabels: string[] = factorSensitivity.length > 0
      ? factorSensitivity.slice(0, 3).map((f) => f.label)
      : topDrivers.slice(0, 3).map((d) => d.label);
    const differentiators = driverLabels.length > 0
      ? driverLabels
      : ['Combined factor effects'];

    const options: ComparisonBlockData['options'] = results.map((r, i) => ({
      id: (r.option_id as string) ?? '',
      label: r.option_label as string,
      probability: r.win_probability as number,
      rank: i + 1,
      strengths: [],
      weaknesses: [],
      key_differentiators: differentiators,
    }));

    const winnerLabel = results[0].option_label as string;
    const runnerUpLabel = results[1].option_label as string;
    const winnerPct = (results[0].win_probability as number) * 100;
    const runnerUpPct = (results[1].win_probability as number) * 100;
    const margin = winnerPct - runnerUpPct;
    const fragileCount = ctx.analysis_summary?.fragile_edge_count ?? 0;

    // Fix 4: narrative must ALWAYS be non-empty when results.length >= 2.
    // It must reference winner, runner-up, margin, and at least one
    // concrete differentiator (driver label or structural fragility cue).
    const narrativeParts: string[] = [];

    // Base comparison line — fired unconditionally
    narrativeParts.push(
      `${winnerLabel} leads in ${winnerPct.toFixed(0)}% of simulations, ahead of ${runnerUpLabel} at ${runnerUpPct.toFixed(0)}%, a ${margin.toFixed(0)}-point gap.`,
    );

    // ---- S4 ROUND 5: closeness verdict comes from the SSOT, not from here ----
    //
    // This site was invisible to rounds 1-4 BY CONSTRUCTION: the sweep grepped
    // for CALLERS of the shared primitives, and a composer that classifies with
    // its own bare literals (`margin < 5`, `margin > 20`) imports none of them.
    // Reinventing the classification is exactly what makes a site unfindable by
    // a caller-grep — see the manifest note on the inverted search.
    //
    // `margin` here is already win_probability percentage points (winnerPct -
    // runnerUpPct), the SAME quantity as `margin_pp` on the V5 projection, so
    // it feeds the shared classifier directly with no unit conversion.
    //
    // The V4 deterministic ctx holds the PLoT envelope at `ctx.analysis`, where
    // the raw robustness object sits at the TOP level (`analysis.robustness`)
    // rather than under `enrichment` as it does on a V5 prior fact. Both
    // addresses now normalise through the one `readRawRobustnessSignals`
    // reader, so V4 can finally consult the `near_tie.is_tie` override that
    // was previously unreachable from this pipeline.
    const rawRobustness = readRawRobustnessSignals(
      (ctx.analysis as { robustness?: unknown } | null)?.robustness,
    );
    const tieReason = nearTieReasonByMargin(margin, rawRobustness);

    // Margin context. The near-tie verdict OUTRANKS the local wide-gap band:
    // an upstream-flagged tie must never be narrated as "a clear lead" just
    // because the projected gap happens to exceed 20 points.
    if (tieReason === 'margin') {
      narrativeParts.push(`This is a close call: relatively small assumption changes could swap the ranking.`);
    } else if (tieReason === 'override') {
      // Wider-than-threshold gap that upstream still calls a tie. State the
      // real gap (the base line above already did) and attribute the verdict
      // rather than claiming the options look fractionally apart — the
      // mirror-image overclaim of a false "clear lead".
      narrativeParts.push(`Despite that gap, the analysis treats this as a close call: relatively small assumption changes could swap the ranking.`);
    } else if (margin < 5) {
      // Sub-5pp but NOT a shared-SSOT near-tie (the SSOT threshold is 1pp).
      // Retained deliberately as a SOFTER caution tier layered ABOVE the tie
      // verdict, not as a competing classifier: dropping it would have made
      // this surface MORE confident at 2-4pp than it is today, which is a
      // regression in honesty dressed up as unification. The SSOT owns the
      // tie/not-tie boundary; this owns "worth a sensitivity check".
      narrativeParts.push(`This is a close call: relatively small assumption changes could swap the ranking.`);
    } else if (margin > 20) {
      narrativeParts.push(`${winnerLabel} has a clear lead.`);
    }

    // Differentiator context — always include when drivers exist
    if (driverLabels.length > 0) {
      const topLabel = driverLabels[0];
      const supporting = driverLabels.slice(1, 3);
      if (supporting.length > 0) {
        narrativeParts.push(`Main differentiators: ${topLabel}, ${supporting.join(', ')}.`);
      } else {
        narrativeParts.push(`Main differentiator: ${topLabel}.`);
      }
    } else if (fragileCount > 0) {
      narrativeParts.push(`${fragileCount} fragile edge${fragileCount > 1 ? 's' : ''} detected; small assumption changes could shift the ranking.`);
    } else {
      narrativeParts.push(`The outcome is shaped by the combined effect of multiple factors.`);
    }

    const narrative = narrativeParts.join(' ');

    const blockData: ComparisonBlockData = { options, narrative };
    const block = createComparisonBlock(blockData, ctx.turn_id);

    // Fix 4: assistantText names the top differentiator when available.
    // Verb choice scales with margin — "edges out" implies a narrow win,
    // "leads" works for mid-range, "clearly leads" for wide gaps — so we
    // don't describe an 80-point sweep as "edges out".
    const topDifferentiator = driverLabels.length > 0 ? driverLabels[0] : null;
    // Verb choice scales with margin, but the SHARED near-tie verdict wins
    // first: "clearly leads" on an upstream-flagged tie is the single most
    // damaging sentence this action can emit, and a bare `margin > 20` test
    // would emit it. Below the tie verdict the local bands still apply.
    const verb = tieReason !== null
      ? 'edges out'
      : margin < 5 ? 'edges out' : margin > 20 ? 'clearly leads' : 'leads';
    const pctCompare = `${winnerPct.toFixed(0)}% vs ${runnerUpPct.toFixed(0)}%`;
    const assistantText = topDifferentiator
      ? `${winnerLabel} ${verb} ${runnerUpLabel} (${pctCompare}); ${topDifferentiator} is the main differentiator.`
      : `${winnerLabel} ${verb} ${runnerUpLabel} by ${margin.toFixed(0)} points (${pctCompare}).`;

    return {
      blocks: [block],
      assistantText,
      guidance_items: [],
    };
  },

  chipLabel() { return 'Compare options'; },
  chipPrompt() { return 'Compare the options'; },
};
