/**
 * ⭐ "ASK ABOUT THIS COMPARISON" — AN ORDINARY TURN ANSWERS ABOUT THE TWO RUNS ONLY FROM THE PAIR THE PRODUCT SHOWS
 * (Compare audit scope, DL-approved; AI HARNESS lease #85 5949274551; RC checker id COMPARISON-ANSWER).
 *
 * After a rerun the user asks "why did the result change?". The post-rerun explanation already answers from the selected
 * pair (`rerun-explanation.ts`), but a FOLLOW-UP question went to the Agent with no pair facts and no check, so a cause
 * could be invented. Two halves, one source (`current_read.run_delta` of the canonical graph read, through
 * `rerunPlanForGraph`, the explanation's own plan):
 *   · INPUT (primary): `comparisonBlockOf` puts ONE `comparison` block in the CURRENT MODEL STATE, and in a Run's tool
 *     result when the Run made a new pair: the endpoints, the case and coverage, Olumi's code line, and what may be said
 *     (cause / movement / beyond-noise). No figures and no leader: those reach the model only through the licensed run view.
 *   · BACKSTOP: `enforceComparisonAnswer` checks the narrator's own sentences ABOUT the two Runs (the user asked about
 *     them, or the sentence names them) with RC's COMPARISON-ANSWER bans, drops a failing sentence and appends the record
 *     (the code line). No pair at all → every licence is refused. The provisional view's words get the same check.
 * Nothing is stored: the next turn reads the pair again.
 */
import { checkMethodTurn, type MethodInputs } from './guidance/index.js';
import { PAIR_CONTEXT } from './guidance/method-turn-check.js';
import { RERUN_NO_CHANGE_LINES, type RerunExplanationPlan } from './rerun-explanation.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** What the model is told the block means. Code-owned; it never restates a figure. */
export const COMPARISON_BLOCK_RULE = 'The two Runs the user can compare. Say what changed between them only as what_changed says it. '
  + 'Say a change caused the difference only if cause_licensed is true; otherwise say the difference cannot be put down to the '
  + 'change alone, and give no other reason for it. Say a figure rose or fell between the Runs only if movement_licensed is '
  + 'true, only for an option in options_moved_beyond_noise, and give no figure: the Compare panel shows them. Call a '
  + 'difference significant or clearly better only if beyond_noise is true. Never say nothing changed when what_changed names '
  + 'a change.';

export interface ComparisonBlock {
  readonly endpoints: { readonly prior: { readonly computed_at?: string }; readonly current: { readonly computed_at?: string } };
  readonly attribution_case?: string;
  readonly input_coverage?: string;
  /** Olumi's code line from the typed rows (`rerunExplanationPlan`), verbatim. */
  readonly what_changed: string;
  /** C1 with complete coverage and every row named (the plan's own `attribution_case`). */
  readonly cause_licensed: boolean;
  readonly movement_licensed: boolean;
  readonly movement_unavailable?: 'prior_withheld' | 'no_matched_figures' | 'within_noise';
  /** The options whose movement is beyond noise (no direction, no figure). */
  readonly options_moved_beyond_noise: readonly string[];
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
    : inputs.no_matched_figures === true ? 'no_matched_figures' as const
      : inputs.signal_movement !== true ? 'within_noise' as const : undefined;
  return {
    endpoints: { prior: at(endpoints?.prior), current: at(endpoints?.current) },
    ...(text(d.attribution_case) !== undefined ? { attribution_case: d.attribution_case as string } : {}),
    ...(text(d.input_coverage) !== undefined ? { input_coverage: d.input_coverage as string } : {}),
    what_changed: plan.codeLine,
    cause_licensed: inputs.attribution_case === 'C1_attributable',
    movement_licensed: movementUnavailable === undefined,
    ...(movementUnavailable !== undefined ? { movement_unavailable: movementUnavailable } : {}),
    options_moved_beyond_noise: movementUnavailable === undefined ? [...(inputs.signal_option_labels ?? [])] : [],
    beyond_noise: inputs.noise_verdict === 'signal',
    rule: COMPARISON_BLOCK_RULE,
  };
}

/**
 * The user's question is about the two Runs: it names them (RC's pair context) or asks why or what changed, moved or
 * differs. It only WIDENS what the backstop judges (every sentence of the answer); it never licenses anything.
 */
// A change that HAPPENED ("why did it change", "what changed", "why is it different now"), never a hypothetical: "What would
// change the result?" is the sensitivity chip, and its "if price rose…" answer is not about two Runs.
const ASKS_WHAT_CHANGED = /\b(why|how come|what)\b(?![^.?!]*\b(would|could|might|if)\b)[^.?!]{0,80}?\b(changed|moved|shifted|went (?:up|down)|rose|fell|dropped|jumped|flipped|swapped|differ(?:s|ed)?|different|did\b[^.?!]{0,40}\b(?:change|move|shift|differ))\b/iu;
export function isComparisonQuestion(message: string): boolean {
  return PAIR_CONTEXT.test(message) || ASKS_WHAT_CHANGED.test(message);
}

/** The check's inputs: the plan's own, or with no pair, every licence refused (fail-closed) and nothing recorded. */
export function comparisonCheckInputs(plan: RerunExplanationPlan | null, modelLabels: readonly string[], comparisonQuestion: boolean): MethodInputs {
  return plan !== null ? { ...plan.inputs, comparison_question: comparisonQuestion } : {
    change_labels: [],
    attribution_case: 'C2_unpaired',
    no_matched_figures: true,
    model_labels: modelLabels,
    comparison_question: comparisonQuestion,
  };
}

const SENTENCE_BREAK = /(?<=[.!?])\s+/u;
const LIST_MARKER = /^(\s*(?:[-*•]|\d+[.)])\s+)/u;
const normal = (t: string) => t.replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * The narrator's text with every sentence RC's COMPARISON-ANSWER check fails dropped, then Olumi's record (the plan's code
 * line) appended once; with no pair nothing is appended. A sentence that only repeats Olumi's own code line is its words and
 * stays. Untouched (the SAME string) when nothing fails. Line structure is kept: a list marker stays with the line's first
 * kept sentence; a line left empty goes.
 */
export function enforceComparisonAnswer(reply: string, plan: RerunExplanationPlan | null, modelLabels: readonly string[], comparisonQuestion = false): {
  readonly text: string; readonly dropped: readonly string[]; readonly failed: readonly string[];
} {
  const inputs = comparisonCheckInputs(plan, modelLabels, comparisonQuestion);
  const own = plan === null ? '' : normal(plan.codeLine);
  const dropped: string[] = [];
  const failed = new Set<string>();
  const lines = reply.split(/\r?\n/u).map((line) => {
    if (line.trim() === '') return line;
    const marker = LIST_MARKER.exec(line)?.[1] ?? '';
    const kept = line.slice(marker.length).split(SENTENCE_BREAK).filter((sentence) => {
      if (sentence.trim() === '') return false;
      if (own !== '' && own.includes(normal(sentence))) return true;
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

/**
 * The typed provisional view is the model's words too: each text field passes the same check, on the same terms as the
 * answer (a field about the two Runs, or any field when the user asked about them). A view's reason about the CURRENT
 * result is not a comparison claim. Any failure → the view is not shown (never a partial view).
 */
export function comparisonViewFailures(view: object, plan: RerunExplanationPlan | null, modelLabels: readonly string[], comparisonQuestion = false): string[] {
  const inputs = comparisonCheckInputs(plan, modelLabels, comparisonQuestion);
  const failed = new Set<string>();
  for (const field of Object.values(view as Record<string, unknown>)) {
    if (typeof field !== 'string' || field.trim() === '') continue;
    for (const id of checkMethodTurn('COMPARISON-ANSWER', field, inputs).failed) failed.add(id);
  }
  return [...failed];
}
