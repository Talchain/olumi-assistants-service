/**
 * ⭐⭐ WHAT THE WORD BUDGET IS ACTUALLY SPENT ON — DERIVED, NEVER MIRRORED.
 *
 * `assembleSectionedNarrative` checks `countWords(text) <= MAX_WORDS` against
 * the CONTENT it assembles, and only then splices the fixed footers in. So the
 * string a guard must measure is NOT `result.text`: that string carries the
 * variance note (and, when the draft dropped one of the user's figures, the
 * dropped-figure notice) which are deliberately OUTSIDE the budget.
 *
 * Two ways to get this wrong, both of which produce a guard that agrees with
 * itself instead of with the assembler:
 *
 *   · measure `result.text` — you count ~19 words the ladder never charged,
 *     so a guard "proving" the reply fits reports a number the producer would
 *     not recognise, and a margin assertion reads ~19 words tighter than it is;
 *   · count the wrong UNIT — characters against a budget denominated in words.
 *
 * Everything here is therefore imported from the producer: its budget, its
 * counting function, and its footer text. Nothing in this file restates a
 * constant, so nothing in it can drift from the thing it measures.
 */
import {
  MAX_WORDS,
  MODEL_VARIANCE_NOTE,
  countWords,
} from '../../post-draft-narrative.js';

export { MAX_WORDS, MODEL_VARIANCE_NOTE, countWords };

/**
 * The opening words of the dropped-figure notice — the SECOND fixed footer.
 *
 * ⚠ It is a template built inline in `brief-audit-answer.ts`
 * (`composeDroppedFigureNotice`), not an exported constant, so this prefix is
 * the one mirrored string in this file. It is used ONLY to DETECT the footer
 * so a caller can pin its absence; no assertion rests on its wording. A guard
 * that wants an exact priced count on a draft that DOES carry it should pass
 * the notice it supplied through `extraFooters` rather than lean on this.
 */
export const DROPPED_FIGURE_NOTICE_PREFIX =
  'Figures from your brief I could not find in the model';

/** The `\n\n`-separated blocks of a rendered narrative. */
export function blocksOf(text: string): string[] {
  return text.split('\n\n');
}

/**
 * The blocks the ladder PRICED — the rendered narrative with the fixed footers
 * removed. `extraFooters` takes any footer whose text the caller supplied
 * (today: the dropped-figure notice).
 */
export function pricedBlocks(
  text: string,
  extraFooters: readonly string[] = [],
): string[] {
  const footers = new Set<string>([MODEL_VARIANCE_NOTE, ...extraFooters]);
  return blocksOf(text).filter((b) => !footers.has(b));
}

/** The priced content as one string, joined exactly as `tryAssemble` joins it. */
export function pricedContent(
  text: string,
  extraFooters: readonly string[] = [],
): string {
  return pricedBlocks(text, extraFooters).join('\n\n');
}

/**
 * The number the ladder compared against `MAX_WORDS`, using the producer's own
 * counting function.
 */
export function pricedWordCount(
  text: string,
  extraFooters: readonly string[] = [],
): number {
  return countWords(pricedContent(text, extraFooters));
}

/** True when the draft carried the second fixed footer. */
export function carriesDroppedFigureNotice(text: string): boolean {
  return blocksOf(text).some((b) => b.startsWith(DROPPED_FIGURE_NOTICE_PREFIX));
}

/**
 * ⭐ WHICH RUNG THE LADDER LANDED ON, read from what SURVIVED rather than from
 * a number the assembler does not publish.
 *
 * The ladder sheds in a fixed order — extra check bullet, then the completeness
 * advisory, then the weighing block down to its direction clarifications, then
 * the weighing block entirely, then the option inventory — so the census of
 * surviving sections IS the rung. Comparing censuses answers "did this change
 * move the ladder?", which is the question a budget regression turns on; a raw
 * word count answers only "how full was it", and at every rung but the terminal
 * one the answer to that is tautologically "within budget", because the
 * assembler checked exactly that before returning.
 */
export interface RungCensus {
  readonly blocks: number;
  readonly hasOptions: boolean;
  readonly hasWeighing: boolean;
  readonly hasCompleteness: boolean;
  readonly extraChecks: number;
}

export const OPTIONS_HEADINGS = [
  'Options compared',
  'Options on the canvas',
  'The model so far includes one route:',
] as const;
export const WEIGHING_HEADING = 'What the model is weighing';

export function rungCensus(
  result: { text: string; telemetry: { brief_completeness_surfaced: boolean; additional_checks_surfaced: number } },
  extraFooters: readonly string[] = [],
): RungCensus {
  const blocks = pricedBlocks(result.text, extraFooters);
  return {
    blocks: blocks.length,
    hasOptions: blocks.some((b) => OPTIONS_HEADINGS.some((h) => b.startsWith(h))),
    hasWeighing: blocks.some((b) => b.startsWith(WEIGHING_HEADING)),
    hasCompleteness: result.telemetry.brief_completeness_surfaced,
    extraChecks: result.telemetry.additional_checks_surfaced,
  };
}
