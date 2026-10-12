/**
 * ⭐ THE WIN-SHARE CLASS, REBUILT AS ONE RULE (DL ruling after the f5689c76 check FAIL, 12 Oct; Paul's #87; AIE 6131687656).
 * The share of runs in which an option came out on top (`win_probability`) is supporting detail, never the headline and never
 * the chance of meeting the goal. Two instance fixes failed the same way: FILTER ELIGIBILITY stood in for RUN EVIDENCE (round 2:
 * an emptied non-Run reply became the Run template; round 4: any provider call counted as a Run, and a replay lost its filter).
 *
 * The rule:
 *   1. RUN EVIDENCE IS A TYPED FACT OF ONE TURN, never inferred from the text, the model, a provider call or a re-shown block
 *      ({@link ReplyRunEvidence}). The V5 executor reads its own handler facts ({@link executorReplyRunEvidence}); the Agent
 *      route reads its own tool results (`agent-lane/run-share-evidence.ts`); a replay reads the STORED ROW it replays.
 *   2. REMOVAL AND THE RUN TEMPLATE ARE SEPARATE PERMISSIONS. Every `analysis_result` summary is a result surface: its share
 *      sentences are removed wherever the block is shown. A reply is a result surface only on a turn that RAN (removal, and the
 *      locked Run template if nothing is left — only for a Run of THIS turn), that EXPLAINS the current Run, or that REPLAYS a
 *      row proving either (removal only: a reply that would be left with nothing keeps its words, followed by the AIE's fixed
 *      qualifier, and never claims an execution).
 *   3. A REASONING REPLY IS NEVER FILTERED OR TEMPLATED (tipping points, the advice gate, constraint disclosure, the decision
 *      review): the AIE's ruling keeps same-Run comparative support as supporting reasoning.
 * The structured `win_probability` data is not edited. A body with nothing to change is returned by reference, so an exit that
 * re-finalises an edited V5 body (route-v2's pre-serialisation hook ships only finalised bodies) re-finalises only an edit.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { RUN_ANALYSIS_LOCKED_TEMPLATES, summaryWithoutLeadSentence } from '../coaching/analysis-result-headline.js';
import { isAnalysisRefusalFact } from '../context/analysis-refusal-continuity.js';
import { log } from '../../utils/telemetry.js';

/** The DL's census, verbatim (12 Oct): no result surface may match it. */
export const RUN_SHARE_CENSUS = /\d+% of runs|supported by .* runs|more runs than|gave the highest|gave the lowest|out on top/i;
const RUN_SHARE_SENTENCE = new RegExp([
  RUN_SHARE_CENSUS.source,
  String.raw`\bmost runs\b`, String.raw`\bmore of the runs\b`, String.raw`\bmore runs\b`, String.raw`\bnext most runs\b`,
  String.raw`\bscor(?:ed|es) highest\b`, String.raw`\bcame out (?:ahead|lowest|highest|top)\b`, String.raw`\bcomes? out ahead\b`,
].join('|'), 'i');

/** The existing locked Run template: said only where THIS turn (or the replayed row) ran the analysis, so it is true. */
export const RUN_RESULT_TEMPLATE = [...RUN_ANALYSIS_LOCKED_TEMPLATES][0]!;
/** The AIE's exact fixed qualifier (#94 6132054663, the 6131687656 bullet). */
export const RUN_SHARE_QUALIFIER = 'This compares the analysed options; it is not the chance of meeting your goal.';
/**
 * The AIE's exact supporting label (same post) for a share of runs said on a REASONING surface, where comparative support is
 * kept as supporting reasoning. `share` is the formatted percentage, with its sign ("62%"). The surface names the option
 * before it and says {@link RUN_SHARE_QUALIFIER} once after its share lines.
 */
export function runShareSupportingLabel(share: string): string {
  return `Share of model runs in which this option ranks first: ${share}.`;
}

/**
 * What a reply IS, from one typed fact of the turn that wrote it. `run_result`: that turn ran the analysis (removal and the
 * Run template). `run_explanation`: that turn explains the current Run (removal only). `reasoning`: anything else (untouched).
 */
export type ReplyRunEvidence =
  | { readonly surface: 'run_result'; readonly basis: 'ran_this_turn' | 'replayed_row_ran' }
  | { readonly surface: 'run_explanation'; readonly basis: 'explains_current_run' | 'replayed_row_explained' }
  | { readonly surface: 'reasoning' };
export const REASONING_REPLY: ReplyRunEvidence = { surface: 'reasoning' };

/**
 * The V5 executor's evidence, from THIS turn's own handler facts: a completed run_analysis fact (never the refusal marker,
 * which is a run_analysis fact too), else an explain_results fact that answered (its precondition met).
 */
export function executorReplyRunEvidence(facts: readonly HandlerFact[]): ReplyRunEvidence {
  if (facts.some((f) => f.fact_type === 'run_analysis' && f.noop === false && !isAnalysisRefusalFact(f))) {
    return { surface: 'run_result', basis: 'ran_this_turn' };
  }
  if (facts.some((f) => f.fact_type === 'explain_results' && f.result.precondition_unmet === false)) {
    return { surface: 'run_explanation', basis: 'explains_current_run' };
  }
  return REASONING_REPLY;
}

/** `text` without any sentence that states a share of runs; the lead ladder's sentence is read by its own grammar first. */
export function withoutRunShareSentences(text: string): string {
  if (typeof text !== 'string' || text === '') return text;
  const led = summaryWithoutLeadSentence(text);
  if (!RUN_SHARE_SENTENCE.test(led)) return led;
  const lines = led.split('\n').map((line) => {
    if (!RUN_SHARE_SENTENCE.test(line)) return line;
    const bullet = /^(\s*(?:[•\-*]|\d+\.)\s+)/.exec(line)?.[1] ?? '';
    const kept = line.slice(bullet.length).split(/(?<=[.!?…])\s+/).filter((s) => !RUN_SHARE_SENTENCE.test(s)).join(' ').trim();
    return kept === '' ? null : `${bullet}${kept}`;
  });
  return lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when `text` states a share of runs (the removal rule, wider than the census). */
export function statesRunShare(text: unknown): boolean {
  return typeof text === 'string' && RUN_SHARE_SENTENCE.test(text);
}

/** An `analysis_result` summary: the block is its own Run's record, so a summary left with nothing is the locked template. */
function summaryWords(summary: string): string {
  const kept = withoutRunShareSentences(summary);
  return summary.trim() !== '' && kept.trim() === '' ? RUN_RESULT_TEMPLATE : kept;
}

/**
 * A result reply's words: removal; when nothing is left, the Run template ONLY where THIS turn ran (AIE #94 6132355107: a
 * replay filters its stored words without claiming a new execution), otherwise the whole words and the AIE qualifier.
 */
function replyWords(text: string, evidence: Exclude<ReplyRunEvidence, { surface: 'reasoning' }>): { text: string; outcome: string } {
  const kept = withoutRunShareSentences(text);
  if (kept.trim() !== '') return { text: kept, outcome: 'removed' };
  if (evidence.basis === 'ran_this_turn') return { text: RUN_RESULT_TEMPLATE, outcome: 'templated' };
  return { text: text.includes(RUN_SHARE_QUALIFIER) ? text : `${text.trimEnd()}\n\n${RUN_SHARE_QUALIFIER}`, outcome: 'qualified' };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The body with its result surfaces free of any share-of-runs sentence, BY REFERENCE when nothing changed: every
 * `analysis_result` summary, and — only when `evidence` makes the reply a result surface — `assistant_text`, its
 * `_answer_shape` and its chips. Logs the edited paths and the outcome, never prose.
 */
export function withRunShareFreeResult<T extends object>(body: T,
  opts: { readonly evidence: ReplyRunEvidence; readonly exitPath: string; readonly requestId?: string }): T {
  const b = body as unknown as Rec;
  const changed: string[] = [];
  const next: Rec = { ...b };
  let outcome: string | undefined;
  if (Array.isArray(b.blocks)) {
    let blocks: unknown[] | null = null;
    b.blocks.forEach((block, i) => {
      if (!isRec(block) || block.type !== 'analysis_result' || !statesRunShare(block.summary)) return;
      blocks ??= [...(b.blocks as unknown[])];
      blocks[i] = { ...block, summary: summaryWords(block.summary as string) };
      changed.push(`$.blocks[${i}].summary`);
    });
    if (blocks !== null) next.blocks = blocks;
  }
  const evidence = opts.evidence;
  if (evidence.surface !== 'reasoning') {
    if (statesRunShare(b.assistant_text)) {
      const words = replyWords(b.assistant_text as string, evidence);
      outcome = words.outcome;
      if (words.text !== b.assistant_text) {
        next.assistant_text = words.text;
        changed.push('$.assistant_text');
        // The shape no longer derives the words that ship: the text ships whole (`_answer_shape` is optional).
        if ('_answer_shape' in next) { delete next._answer_shape; changed.push('$._answer_shape'); }
      }
    } else if (isRec(b._answer_shape) && statesRunShare(JSON.stringify(b._answer_shape))) {
      delete next._answer_shape;
      changed.push('$._answer_shape');
    }
    if (Array.isArray(b.suggested_actions) && b.suggested_actions.some((c) => isRec(c) && statesRunShare(c.label))) {
      next.suggested_actions = b.suggested_actions.filter((c) => !(isRec(c) && statesRunShare(c.label)));
      changed.push('$.suggested_actions');
    }
  }
  if (changed.length === 0) return body;
  log.info({ event: 'cee.run_share_text.removed', request_id: opts.requestId, exit_path: opts.exitPath,
    surface: evidence.surface, ...(evidence.surface !== 'reasoning' ? { basis: evidence.basis } : {}),
    ...(outcome !== undefined ? { outcome } : {}), paths: changed.slice(0, 40), count: changed.length },
  'egress: a sentence stating a share of runs was removed from a result surface');
  return next as unknown as T;
}
