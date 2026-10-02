/**
 * ⭐ "ASK ABOUT THIS COMPARISON" — AN ORDINARY TURN ANSWERS ABOUT THE TWO RUNS ONLY FROM THE PAIR THE PRODUCT SHOWS
 * (Compare audit scope, DL-approved; AI HARNESS lease #85 5949274551; RC checker id COMPARISON-ANSWER).
 *
 * After a rerun the user asks "why did the result change?". The post-rerun explanation already answers from the selected
 * pair (`rerun-explanation.ts`), but a FOLLOW-UP question went to the Agent with no pair facts and no check, so a cause
 * could be invented. Two halves, one source (`current_read.run_delta` of the canonical graph read, through
 * `rerunPlanForGraph`, the explanation's own plan):
 *   · INPUT: `comparisonBlockOf` puts ONE `comparison` block in the CURRENT MODEL STATE: the endpoints, the case and
 *     coverage, Olumi's code line, and what may be said (cause / movement / beyond-noise). No figures and no leader:
 *     those reach the model only through the licensed run view.
 *   · BACKSTOP: `enforceComparisonAnswer` checks each of the narrator's own sentences with RC's COMPARISON-ANSWER bans
 *     and drops a failing sentence; the record (the code line) is then appended. No pair at all → every ban fails closed.
 * Nothing is stored: the next turn reads the pair again.
 */
import { checkMethodTurn, type MethodInputs } from './guidance/index.js';
import { RERUN_NO_CHANGE_LINES, type RerunExplanationPlan } from './rerun-explanation.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** What the model is told the block means. Code-owned; it never restates a figure. */
export const COMPARISON_BLOCK_RULE = 'The two Runs the user can compare. Say what changed between them only as what_changed says it. '
  + 'Say a change caused the difference only if cause_licensed is true. Say a figure rose or fell between the Runs only if '
  + 'movement_licensed is true. Call a difference significant or clearly better only if beyond_noise is true. Never say nothing '
  + 'changed when what_changed names a change.';

export interface ComparisonBlock {
  readonly endpoints: { readonly prior: { readonly computed_at?: string }; readonly current: { readonly computed_at?: string } };
  readonly attribution_case?: string;
  readonly input_coverage?: string;
  /** Olumi's code line from the typed rows (`rerunExplanationPlan`), verbatim. */
  readonly what_changed: string;
  /** C1 with complete coverage and every row named (the plan's own `attribution_case`). */
  readonly cause_licensed: boolean;
  readonly movement_licensed: boolean;
  readonly movement_unavailable?: 'prior_withheld' | 'no_matched_figures';
  readonly beyond_noise: boolean;
  readonly rule: string;
}

/** The model-facing block, or `undefined` when there is no pair (a first Run, a stale Run, a failed read). */
export function comparisonBlockOf(runDelta: unknown, plan: RerunExplanationPlan | null): ComparisonBlock | undefined {
  const d = rec(runDelta);
  if (d === undefined || plan === null) return undefined;
  const at = (end: unknown) => { const computed = text(rec(end)?.computed_at); return computed === undefined ? {} : { computed_at: computed }; };
  const endpoints = rec(d.endpoints);
  const { inputs } = plan;
  const movementUnavailable = inputs.prior_withheld === true ? 'prior_withheld' as const
    : inputs.no_matched_figures === true ? 'no_matched_figures' as const : undefined;
  return {
    endpoints: { prior: at(endpoints?.prior), current: at(endpoints?.current) },
    ...(text(d.attribution_case) !== undefined ? { attribution_case: d.attribution_case as string } : {}),
    ...(text(d.input_coverage) !== undefined ? { input_coverage: d.input_coverage as string } : {}),
    what_changed: plan.codeLine,
    cause_licensed: inputs.attribution_case === 'C1_attributable',
    movement_licensed: movementUnavailable === undefined,
    ...(movementUnavailable !== undefined ? { movement_unavailable: movementUnavailable } : {}),
    beyond_noise: inputs.noise_verdict === 'signal',
    rule: COMPARISON_BLOCK_RULE,
  };
}

/** The check's inputs: the plan's own, or with no pair, every licence refused (fail-closed) and nothing recorded. */
export function comparisonCheckInputs(plan: RerunExplanationPlan | null, modelLabels: readonly string[]): MethodInputs {
  return plan !== null ? plan.inputs : {
    change_labels: [],
    attribution_case: 'C2_unpaired',
    no_matched_figures: true,
    model_labels: modelLabels,
  };
}

const SENTENCE_BREAK = /(?<=[.!?])\s+/u;
const LIST_MARKER = /^(\s*(?:[-*•]|\d+[.)])\s+)/u;

/**
 * The narrator's text with every sentence RC's COMPARISON-ANSWER check fails dropped, then Olumi's record (the plan's code
 * line) appended once; with no pair nothing is appended. Untouched (the SAME string) when nothing fails.
 * Line structure is kept: a list marker stays with the line's first kept sentence; a line left empty goes.
 */
export function enforceComparisonAnswer(reply: string, plan: RerunExplanationPlan | null, modelLabels: readonly string[]): {
  readonly text: string; readonly dropped: readonly string[]; readonly failed: readonly string[];
} {
  const inputs = comparisonCheckInputs(plan, modelLabels);
  const dropped: string[] = [];
  const failed = new Set<string>();
  const lines = reply.split(/\r?\n/u).map((line) => {
    if (line.trim() === '') return line;
    const marker = LIST_MARKER.exec(line)?.[1] ?? '';
    const kept = line.slice(marker.length).split(SENTENCE_BREAK).filter((sentence) => {
      if (sentence.trim() === '') return false;
      const verdict = checkMethodTurn('COMPARISON-ANSWER', sentence, inputs);
      if (verdict.pass) return true;
      dropped.push(sentence);
      for (const id of verdict.failed) failed.add(id);
      return false;
    });
    return kept.length === 0 ? null : `${marker}${kept.join(' ')}`;
  });
  if (dropped.length === 0) return { text: reply, dropped, failed: [] };
  const body = lines.filter((line): line is string => line !== null).join('\n').replace(/\n{3,}/gu, '\n\n').trim();
  // No pair: there is no record to append, so a dropped sentence simply goes (a first-Run turn never reads "these two
  // runs"); only an answer left empty says Olumi can't tell.
  if (plan === null) return { text: body === '' ? RERUN_NO_CHANGE_LINES.unknown : body, dropped, failed: [...failed] };
  return { text: body === '' ? plan.fallback : body.includes(plan.fallback) ? body : `${body}\n\n${plan.fallback}`, dropped, failed: [...failed] };
}
