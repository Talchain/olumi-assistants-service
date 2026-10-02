/**
 * ⭐ "ASK ABOUT THIS COMPARISON" — THE MODEL IS GIVEN THE PAIR THE PRODUCT SHOWS (Compare audit scope, DL-approved; AI
 * HARNESS lease #85 5949274551; split 5950639713: this is the input half).
 *
 * After a rerun the user asks "why did the result change?". The post-rerun explanation answers from the selected pair
 * (`rerun-explanation.ts`), but a FOLLOW-UP question went to the Agent with no pair facts at all, so the model could only
 * guess a cause. Now the CURRENT MODEL STATE carries ONE `comparison` block, and so does a Run's tool result when that Run
 * made a new pair, built from ONE source: `current_read.run_delta` of the canonical graph read, through the explanation's
 * own plan (`rerunPlanForGraph`):
 *   · the endpoints, the case and the coverage;
 *   · `what_changed`: Olumi's code line from the typed rows, verbatim;
 *   · `cause_licensed`: C1 with complete coverage and every row named (the plan's own attribution case);
 *   · `movement_licensed`: matched figures, a row beyond noise, AND the leader may be named (F1b's licence, as the saved
 *     Run's per-option chances): then each option that moved beyond noise is named with its DIRECTION, never a figure;
 *   · `beyond_noise`: the leader's own noise verdict.
 * No figures and no leader identity: those reach the model only through the licensed run view. No pair → no block.
 * Nothing is stored: the next turn reads the pair again.
 */
import type { RerunExplanationPlan } from './rerun-explanation.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** What the model is told the block means. Code-owned; it never restates a figure. */
export const COMPARISON_BLOCK_RULE = 'The two Runs the user can compare. Say what changed between them only as what_changed says it. '
  + 'Say a change caused the difference only if cause_licensed is true; otherwise say the difference cannot be put down to the '
  + 'change alone, and give no other reason for it. Say an option rose or fell between the Runs only if movement_licensed is '
  + 'true, only for an option in moved_beyond_noise and only in its direction, and give no figure: the Compare panel shows '
  + 'them. Call a difference significant or clearly better only if beyond_noise is true. Never say nothing changed when '
  + 'what_changed names a change.';

export type MovementUnavailable = 'prior_withheld' | 'no_matched_figures' | 'within_noise' | 'leader_withheld';

export interface ComparisonBlock {
  readonly endpoints: { readonly prior: { readonly computed_at?: string }; readonly current: { readonly computed_at?: string } };
  readonly attribution_case?: string;
  readonly input_coverage?: string;
  readonly what_changed: string;
  readonly cause_licensed: boolean;
  readonly movement_licensed: boolean;
  readonly movement_unavailable?: MovementUnavailable;
  /** Only when movement is licensed: each option whose own row is `signal`, with which way it moved. */
  readonly moved_beyond_noise: readonly { readonly option: string; readonly direction: 'up' | 'down' }[];
  readonly beyond_noise: boolean;
  readonly rule: string;
}

/**
 * The model-facing block, or `undefined` when there is no pair (a first Run, a stale Run, a failed read).
 * `graph`: the graph the read returned (option labels); `leaderLicensed`: the read's `leader_may_be_named`.
 */
export function comparisonBlockOf(runDelta: unknown, plan: RerunExplanationPlan | null, graph: unknown, leaderLicensed: boolean): ComparisonBlock | undefined {
  const d = rec(runDelta);
  if (d === undefined || plan === null) return undefined;
  const at = (end: unknown) => { const computed = text(rec(end)?.computed_at); return computed === undefined ? {} : { computed_at: computed }; };
  const endpoints = rec(d.endpoints);
  const nodes = Array.isArray(rec(graph)?.nodes) ? (rec(graph)!.nodes as unknown[]).map(rec).filter((n): n is Rec => n !== undefined) : [];
  const labelOf = (id: unknown) => text(nodes.find((n) => n.id === id)?.label);
  const rows = Array.isArray(d.win_probabilities) ? d.win_probabilities.map(rec).filter((r): r is Rec => r !== undefined) : [];
  const moved = rows.flatMap((r) => {
    const label = labelOf(r.option_id);
    const prior = r.prior; const current = r.current;
    if (r.noise_verdict !== 'signal' || label === undefined || typeof prior !== 'number' || typeof current !== 'number' || prior === current) return [];
    return [{ option: label, direction: current > prior ? 'up' as const : 'down' as const }];
  });
  const { inputs } = plan;
  const movementUnavailable: MovementUnavailable | undefined = inputs.prior_withheld === true ? 'prior_withheld'
    : inputs.no_matched_figures === true ? 'no_matched_figures'
      : moved.length === 0 ? 'within_noise'
        : !leaderLicensed ? 'leader_withheld' : undefined;
  return {
    endpoints: { prior: at(endpoints?.prior), current: at(endpoints?.current) },
    ...(text(d.attribution_case) !== undefined ? { attribution_case: d.attribution_case as string } : {}),
    ...(text(d.input_coverage) !== undefined ? { input_coverage: d.input_coverage as string } : {}),
    what_changed: plan.codeLine,
    cause_licensed: inputs.attribution_case === 'C1_attributable',
    movement_licensed: movementUnavailable === undefined,
    ...(movementUnavailable !== undefined ? { movement_unavailable: movementUnavailable } : {}),
    moved_beyond_noise: movementUnavailable === undefined ? moved : [],
    beyond_noise: inputs.noise_verdict === 'signal',
    rule: COMPARISON_BLOCK_RULE,
  };
}
