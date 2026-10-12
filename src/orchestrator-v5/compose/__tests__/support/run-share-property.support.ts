/**
 * ⭐ THE WIN-SHARE CLASS PROPERTY (DL ruling after the f5689c76 check FAIL, 12 Oct): ONE property, checked over every exit
 * (route-v2, the Agent's final exit, the Agent's replay, the explanation fallback) by `run-share-exit-sweep.test.ts` and the
 * route rows. It judges a shipped body against the GROUND TRUTH of the flip that produced it (did this turn — or the replayed
 * row — run the analysis; does it explain the current Run), never against the evidence the exit itself computed, so an exit
 * that reads the wrong evidence is a violation here.
 *
 *   P1  no Run claim (the locked template) without this turn's, or the replayed row's own, run evidence;
 *   P2  no share text on a Run-evidenced result reply (its text, shape or chips);
 *   P3  a reasoning reply is never filtered or templated: text, shape and chips byte-identical;
 *   P4  an explanation of the current Run: share sentences removed; a reply that would be left with nothing keeps its words
 *       followed by the AIE's fixed qualifier — never the Run template;
 *   P5  no `analysis_result` summary states a share of runs, and none is left empty;
 *   P6  the structured `win_probabilities` data is never edited.
 */
import { RUN_RESULT_TEMPLATE, RUN_SHARE_QUALIFIER, statesRunShare } from '../../run-share-text.js';

type Rec = Record<string, unknown>;

export interface RunShareTruth {
  /** This turn ran the analysis, or (for a replay) the stored row is a Run reply. */
  readonly ran: boolean;
  /** This turn (or the replayed row) explains the Run that is still current. */
  readonly explains: boolean;
}

const summaries = (body: Rec): unknown[] => (Array.isArray(body.blocks) ? body.blocks : [])
  .filter((b): b is Rec => b !== null && typeof b === 'object' && (b as Rec).type === 'analysis_result');
const chipLabels = (body: Rec): unknown[] => (Array.isArray(body.suggested_actions) ? body.suggested_actions : [])
  .map((c) => (c !== null && typeof c === 'object' ? (c as Rec).label : undefined));
const json = (v: unknown): string => JSON.stringify(v ?? null);

/** Every way `after` breaks the class property, given the body `before` the exit and the flip's ground truth. */
export function runShareViolations(truth: RunShareTruth, before: Rec, after: Rec): string[] {
  const v: string[] = [];
  const textBefore = typeof before.assistant_text === 'string' ? before.assistant_text : '';
  const textAfter = typeof after.assistant_text === 'string' ? after.assistant_text : '';
  const claimsRun = (t: string) => t.includes(RUN_RESULT_TEMPLATE);
  if (!truth.ran && claimsRun(textAfter) && !claimsRun(textBefore)) v.push('P1: a Run claim without run evidence');
  if (truth.ran) {
    if (statesRunShare(textAfter)) v.push('P2: share text on a Run-evidenced reply');
    if (statesRunShare(json(after._answer_shape))) v.push('P2: share text in a Run-evidenced reply\'s shape');
    if (chipLabels(after).some(statesRunShare)) v.push('P2: share text on a Run-evidenced reply\'s chip');
  }
  if (!truth.ran && !truth.explains) {
    if (textAfter !== textBefore) v.push('P3: a reasoning reply was edited');
    if (json(after._answer_shape) !== json(before._answer_shape)) v.push('P3: a reasoning reply\'s shape was edited');
    if (json(after.suggested_actions) !== json(before.suggested_actions)) v.push('P3: a reasoning reply\'s chips were edited');
  }
  if (truth.explains && !truth.ran) {
    // A share sentence may remain on an explanation only as its WHOLE original words followed by the qualifier (the sweep's
    // partial flip separately requires removal whenever anything else is left).
    const whole = textBefore.endsWith(RUN_SHARE_QUALIFIER) ? textBefore : `${textBefore.trimEnd()}\n\n${RUN_SHARE_QUALIFIER}`;
    if (statesRunShare(textAfter) && textAfter !== whole) v.push('P4: an explanation states a share other than whole and qualified');
    if (chipLabels(after).some(statesRunShare)) v.push('P4: share text on an explanation\'s chip');
  }
  const sb = summaries(before);
  summaries(after).forEach((block, i) => {
    const s = (block as Rec).summary;
    if (statesRunShare(s)) v.push(`P5: blocks[${i}].summary states a share`);
    if (typeof s === 'string' && s.trim() === '' && typeof (sb[i] as Rec | undefined)?.summary === 'string'
      && ((sb[i] as Rec).summary as string).trim() !== '') v.push(`P5: blocks[${i}].summary was left empty`);
    if (json((block as Rec).win_probabilities) !== json((sb[i] as Rec | undefined)?.win_probabilities)) v.push(`P6: blocks[${i}].win_probabilities edited`);
  });
  return v;
}

/** The share-text flips: none, a partial reply (a share sentence beside one that must survive), an all-share reply. */
export const SHARE_TEXT = {
  none: 'Pricing at £59 depends most on the conversion rate. Check that figure first.',
  partial: 'In this model, ‘Raise to £59’ was supported by 62% of runs. Check the conversion rate before you commit.',
  all: 'In this model, ‘Raise to £59’ was supported by 62% of runs. ‘Hold at £49’ was supported by the next most runs (38%).',
} as const;
export type ShareFlip = keyof typeof SHARE_TEXT;
export const SHARE_FLIPS = Object.keys(SHARE_TEXT) as ShareFlip[];

/** A summary that leads with the lead ladder's share sentence, then a sentence that must survive. */
export const SHARED_SUMMARY = 'Raise to £59 gave the highest monthly recurring revenue in 62% of runs of this model. Check the conversion rate.';
export const CLEAN_SUMMARY = 'Check the conversion rate.';
