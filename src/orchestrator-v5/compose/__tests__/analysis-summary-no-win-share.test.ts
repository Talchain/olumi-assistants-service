/**
 * ⭐ RECOVERY BATCH E (DL, 12 Oct; ruling A and Paul's #87: a win share is never the headline). Score run 4 (Batch B
 * served witness, CEE a770ce49), capacity step 3: `blocks[0].summary` = "Add one specialist gave the highest weekly
 * support capacity in 88% of runs of this model because Existing team support capacity is the strongest driver. …". 88%
 * is `win_probability` 0.88225; the goal chance on that turn is 36%. The block's summary drops the lead ladder's sentence
 * on every branch and keeps everything after it byte for byte, adding no word.
 *
 * Rows: the served turn's block (permitted branch) and the same fact withheld; every lead case the headline grammar
 * admits, each followed by a real tail; the anchored read where a label holds a full stop; Olumi's legacy-figures
 * sentence kept; contrasts (a locked template, a summary with no lead, an empty summary) unchanged.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../compose.js';
import {
  NOT_ROBUST_SENTENCE,
  RUN_ANALYSIS_LOCKED_TEMPLATES,
  summaryWithoutLeadSentence,
} from '../../coaching/analysis-result-headline.js';

type Rec = Record<string, any>;
const SERVED: Rec = JSON.parse(readFileSync(new URL('./fixtures/run4-capacity-turn3-analysis-result.json', import.meta.url), 'utf8'));
const LEAD = 'Add one specialist gave the highest weekly support capacity in 88% of runs of this model because Existing team support capacity is the strongest driver.';
const REST = '\'Keep current staffing\' was analysed as no change — the factors it compares against were held at the values your model records today. I supplied 6 of the values behind this, because your brief did not state them. They are mine rather than yours. Changing any of them changes what this model implies.';

const factOf = (mayName: boolean): RunAnalysisHandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SERVED._provenance.scenario_id, leading_option_id: SERVED.block.leading_option_id,
    summary: SERVED.block.summary, win_probabilities: SERVED.block.win_probabilities,
    graph_hash_at_run: SERVED.block.computed_against_hash, computed_at: '2026-10-12T17:40:00.000Z',
    constraint_verdict: { may_name_leading_option: mayName, constraint_verdict_state: 'evaluated_feasible' },
    enrichment: structuredClone(SERVED.block.enrichment),
  },
} as unknown as RunAnalysisHandlerFact);

describe('run 4 capacity step 3: the analysis summary never carries the win share', () => {
  it('precondition: the served summary is the lead sentence, then the rest', () => {
    expect(SERVED.block.summary).toBe(`${LEAD} ${REST}`);
    expect(SERVED.block.win_probabilities['Add one specialist']).toBe(0.88225);
  });

  it('the served Run, leader permitted: the summary is the rest, byte for byte; the leader id is unchanged', () => {
    const block = buildAnalysisResultBlock(factOf(true));
    expect(block.leading_option_id).toBe('add_one_specialist');
    expect(block.summary).toBe(REST);
    expect(block.summary).not.toMatch(/% of runs/);
  });

  it('the same Run withheld: still no share of runs', () => {
    const block = buildAnalysisResultBlock(factOf(false));
    expect(block.leading_option_id).toBeNull();
    expect(block.summary).not.toMatch(/of runs of this model/);
  });
});

describe('every lead the headline grammar admits is dropped; its tail is kept', () => {
  const TAIL = NOT_ROBUST_SENTENCE;
  it.each([
    ['A', 'Raise to £59 was supported by 72% of runs of this model, but treat this as provisional: the result is sensitive to ‘Price’.'],
    ['C', 'Raise to £59 was supported by the most runs of this model, but treat this as provisional: the result is not highly stable.'],
    ['B', LEAD],
    ['B, number-free', 'Raise to £59 was supported by the most runs of this model because Price is the strongest driver.'],
    ['B, lowest', 'Cut hours gave the lowest monthly cost in 64% of runs of this model because Hours is the strongest driver.'],
    ['D', 'Raise to £59 was supported by 72% of runs of this model.'],
    ['D, with the follow-up nudge', 'Raise to £59 was supported by 72% of runs of this model. Run the follow-up checks before treating this as final.'],
    ['NT, close', 'Raise to £59 was supported by 55% of runs of this model, but the options are close.'],
    ['NT, tied', 'Raise to £59 was supported by only fractionally more runs of this model, so the options are effectively tied.'],
    ['NT, override', 'Raise to £59 was supported by 61% of runs of this model, but the analysis treats this as a close call.'],
    ['LT', 'In this model, Hold at £49 was supported by marginally more runs than Raise to £59 (52% against 48%), so the two are close. Change a figure you’re unsure about to see what separates them.'],
    ['E', 'Raise to £59 was supported by the most runs of this model.'],
  ])('%s', (_case, lead) => {
    expect(summaryWithoutLeadSentence(`${lead}${TAIL}`)).toBe(TAIL.trimStart());
    expect(summaryWithoutLeadSentence(lead)).toBe('');
  });

  it('a label with a full stop: the lead is the case that leaves only tails, not the first full stop', () => {
    const lead = 'Raise to £59 was supported by 72% of runs of this model, but treat this as provisional: the result is sensitive to ‘Price v2.1’.';
    expect(summaryWithoutLeadSentence(`${lead}${TAIL}`)).toBe(TAIL.trimStart());
  });

  it('Olumi\'s legacy-figures sentence inside the probability case is kept', () => {
    const legacy = ' Olumi supplied the figures for the link from ‘Price’ to ‘Revenue’. Set your own to see how much it matters.';
    const summary = `Raise to £59 was supported by 72% of runs of this model.${legacy} Run the follow-up checks before treating this as final.${TAIL}`;
    expect(summaryWithoutLeadSentence(summary)).toBe(`${legacy}${TAIL}`.trimStart());
  });

  it('a sentence the grammar does not know follows the lead: the lead is still dropped, the sentence kept', () => {
    const other = ' Olumi read your goal as weekly tickets handled.';
    expect(summaryWithoutLeadSentence(`${LEAD}${other}`)).toBe(other.trimStart());
  });
});

describe('contrasts: nothing else changes', () => {
  it.each([
    ['a locked template', [...RUN_ANALYSIS_LOCKED_TEMPLATES][0]!],
    ['a locked template with a tail', `${[...RUN_ANALYSIS_LOCKED_TEMPLATES][0]!}${NOT_ROBUST_SENTENCE}`],
    ['a summary with no lead', REST],
    ['the empty summary', ''],
  ])('%s', (_name, summary) => {
    expect(summaryWithoutLeadSentence(summary)).toBe(summary);
  });
});
