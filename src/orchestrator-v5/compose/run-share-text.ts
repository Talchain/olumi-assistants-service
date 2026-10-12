/**
 * ⭐ RECOVERY BATCH E (DL ruling (ii), 12 Oct, refining ruling A to Paul's #87 and the guiding principle; score run 4 C3 FAIL):
 * THE RUN'S RESULT SURFACES NEVER STATE AN OPTION'S SHARE OF RUNS. The share of runs in which an option came out on top
 * (`win_probability`) is supporting detail, never the headline and never the chance of meeting the goal. Run 4's blocking
 * sentences were on the result surfaces: the `analysis_result` summary ("… gave the highest weekly support capacity in 88% of
 * runs of this model …") and the Run turn's reply (the run handler's text on the V5 route, the Agent's prose on its Run turn).
 *
 * Removed there, and ONLY there: every sentence that states a share of runs, on
 *   · every `analysis_result` block's summary, wherever the block is shown (the builder, and each exit as a backstop);
 *   · the Run turn's reply — `assistant_text`, its `_answer_shape` and its chips — when the caller says the turn RAN.
 * The REASONING surfaces keep it as supporting detail ("What would change the result?" tipping points, the advice gate,
 * constraint disclosure, the decision review): they are model-relative findings for reasoning, never called a chance.
 *
 * No word is added, except that a result surface left with nothing says the existing locked template, which is true there
 * (the analysis ran). A chip left without a label is dropped; a shape whose words changed is dropped (the text ships whole).
 * Nothing it changes can leave a required field empty. The structured `win_probability` fields are data and are not edited.
 *
 * The census pattern is the DL's, verbatim (`RUN_SHARE_CENSUS`); removal also covers the plural and ranking forms CEE
 * writes that it does not spell out ("the most runs", "scored highest", "came out lowest").
 */
import { RUN_ANALYSIS_LOCKED_TEMPLATES, summaryWithoutLeadSentence } from '../coaching/analysis-result-headline.js';
import { log } from '../../utils/telemetry.js';

/** The DL's census, verbatim (12 Oct): no CEE text a Run emits may match it. */
export const RUN_SHARE_CENSUS = /\d+% of runs|supported by .* runs|more runs than|gave the highest|gave the lowest|out on top/i;
const RUN_SHARE_SENTENCE = new RegExp([
  RUN_SHARE_CENSUS.source,
  String.raw`\bmost runs\b`, String.raw`\bmore of the runs\b`, String.raw`\bmore runs\b`, String.raw`\bnext most runs\b`,
  String.raw`\bscor(?:ed|es) highest\b`, String.raw`\bcame out (?:ahead|lowest|highest|top)\b`, String.raw`\bcomes? out ahead\b`,
].join('|'), 'i');

/** The existing locked Run template (`RUN_ANALYSIS_LOCKED_TEMPLATES`): said only where the analysis ran, so it is true. */
export const RUN_RESULT_TEMPLATE = [...RUN_ANALYSIS_LOCKED_TEMPLATES][0]!;

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

/** A result surface's words without a share of runs; never empty (the analysis ran, so the locked template is true). */
export function runResultWords(text: string): string {
  const kept = withoutRunShareSentences(text);
  return typeof text === 'string' && text.trim() !== '' && kept.trim() === '' ? RUN_RESULT_TEMPLATE : kept;
}

/** True when `text` states a share of runs (the removal rule, wider than the census). */
export function statesRunShare(text: unknown): boolean {
  return typeof text === 'string' && RUN_SHARE_SENTENCE.test(text);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The body with its result surfaces free of any share-of-runs sentence, BY REFERENCE when nothing changed (the V5 route
 * re-finalises only an edited body). `runTurn`: this turn ran the analysis, so its reply is a result surface. Logs the
 * edited paths, never prose.
 */
export function withoutRunShareTextAtEgress<T extends object>(body: T,
  opts: { readonly requestId?: string; readonly exitPath: string; readonly runTurn: boolean }): T {
  const b = body as unknown as Rec;
  const changed: string[] = [];
  const next: Rec = { ...b };
  if (Array.isArray(b.blocks)) {
    let blocks: unknown[] | null = null;
    b.blocks.forEach((block, i) => {
      if (!isRec(block) || block.type !== 'analysis_result' || !statesRunShare(block.summary)) return;
      blocks ??= [...(b.blocks as unknown[])];
      blocks[i] = { ...block, summary: runResultWords(block.summary as string) };
      changed.push(`$.blocks[${i}].summary`);
    });
    if (blocks !== null) next.blocks = blocks;
  }
  if (opts.runTurn) {
    if (statesRunShare(b.assistant_text)) {
      next.assistant_text = runResultWords(b.assistant_text as string);
      changed.push('$.assistant_text');
      // The shape no longer derives the words that ship: the text ships whole (`_answer_shape` is optional).
      if ('_answer_shape' in next) { delete next._answer_shape; changed.push('$._answer_shape'); }
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
  log.info({ event: 'cee.run_share_text.removed', request_id: opts.requestId, exit_path: opts.exitPath, run_turn: opts.runTurn,
    paths: changed.slice(0, 40), count: changed.length }, 'egress: a sentence stating a share of runs was removed from a result surface');
  return next as unknown as T;
}
