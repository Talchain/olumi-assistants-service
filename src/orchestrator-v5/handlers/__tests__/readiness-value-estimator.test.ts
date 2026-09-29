/**
 * Guards for the estimate producer that `readiness-value-batch` was missing.
 *
 * ⚠ WHAT THESE TESTS DO NOT CLAIM. They prove the PROMPT CONTRACT and the PARSE.
 * They say nothing about whether the model returns good numbers — every input
 * here is a fixture I wrote, and a fixture you wrote yourself is not evidence
 * about the wire. A claim about estimate QUALITY needs a live call and must be
 * labelled as one.
 *
 * The property that matters most is the one a careless producer would lose:
 * **a refusal must survive, and a refusal without a reason must not.**
 */

import { describe, it, expect } from 'vitest';
import {
  estimateValueBatch,
  buildValueEstimateUserContent,
  VALUE_ESTIMATE_SYSTEM_PROMPT,
  VALUE_ESTIMATE_OUTPUT_SCHEMA,
  type ValueEstimateRequest,
} from '../readiness-value-estimator.js';
import type { ValueBatchCell } from '../readiness-value-batch.js';

const cell = (option_id: string, factor_id: string): ValueBatchCell => ({
  issue_id: `semantic_${option_id}_${factor_id}`,
  option_id,
  factor_id,
  option_label: `Option ${option_id}`,
  factor_label: `Factor ${factor_id}`,
  prompt: `What should option ${option_id} set factor ${factor_id} to?`,
  obligation: undefined,
  provenance: undefined,
});

const req = (cells: ValueBatchCell[]): ValueEstimateRequest => ({
  cells,
  factors: [
    { factor_id: 'fac_a', label: 'Factor fac_a', current_value: 0.6, unit: undefined },
    { factor_id: 'fac_b', label: 'Factor fac_b', current_value: undefined, unit: '%' },
  ],
  brief: 'Should we open a second site next quarter?',
});

const replies = (content: string) => async () => ({ content });

describe('readiness value estimator — the refusal is a first-class answer', () => {
  it('KEEPS a decline: value null with declined_reason survives to the caller', async () => {
    const out = await estimateValueBatch(
      req([cell('opt_a', 'fac_a')]),
      replies(
        JSON.stringify({
          estimates: [
            {
              option_id: 'opt_a',
              factor_id: 'fac_a',
              value: null,
              declined_reason: 'Nothing in the brief bears on this factor.',
            },
          ],
        }),
      ),
    );
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.estimates).toHaveLength(1);
    expect(out.estimates[0].value).toBeNull();
    expect(out.estimates[0].declined_reason).toBe('Nothing in the brief bears on this factor.');
  });

  it('⭐ REJECTS a decline with NO reason — a silent blank is the defect this closes', async () => {
    // The DISCRIMINATING TWIN of the test above: the same shape, minus the
    // reason. Without this, a producer could return `value: null` on every cell
    // and the batch would present blanks the user cannot act on, which is worse
    // than the one-at-a-time loop it replaces.
    const out = await estimateValueBatch(
      req([cell('opt_a', 'fac_a')]),
      replies(JSON.stringify({ estimates: [{ option_id: 'opt_a', factor_id: 'fac_a', value: null }] })),
    );
    expect(out.status).toBe('off_contract');
    if (out.status !== 'off_contract') return;
    expect(out.detail).toContain('declined_reason');
  });

  it('REJECTS a value outside the model unit — the bound is a guarantee, not a request', async () => {
    // 85 (percent) rather than 0.85 (model unit) is the exact confusion the
    // system prompt restates the product's own coaching to prevent. The schema
    // is what makes it an error rather than a 100x overstatement downstream.
    const out = await estimateValueBatch(
      req([cell('opt_a', 'fac_a')]),
      replies(JSON.stringify({ estimates: [{ option_id: 'opt_a', factor_id: 'fac_a', value: 85 }] })),
    );
    expect(out.status).toBe('off_contract');
  });
});

describe('readiness value estimator — binding to the cells actually asked', () => {
  it('⭐ DISCRIMINATING PAIR: an asked cell is kept and an unasked cell is dropped, in one reply', async () => {
    // One assertion alone would not show the filter binds by IDENTITY: a filter
    // that dropped everything, or kept everything, would pass one half each.
    const out = await estimateValueBatch(
      req([cell('opt_a', 'fac_a')]),
      replies(
        JSON.stringify({
          estimates: [
            { option_id: 'opt_a', factor_id: 'fac_a', value: 0.85, confidence: 'medium' },
            { option_id: 'opt_GHOST', factor_id: 'fac_b', value: 0.4 },
          ],
        }),
      ),
    );
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    // KEPT, by identity — not by count, which a different row could satisfy.
    expect(out.estimates.map((e) => `${e.option_id}/${e.factor_id}`)).toEqual(['opt_a/fac_a']);
    // DROPPED — and named, so this fails loudly if the filter inverts.
    expect(out.estimates.some((e) => e.option_id === 'opt_GHOST')).toBe(false);
  });

  it('returns no_cells for an empty membership, without calling the model', async () => {
    let called = 0;
    const out = await estimateValueBatch({ ...req([]), cells: [] }, async () => {
      called += 1;
      return { content: '{}' };
    });
    expect(out.status).toBe('no_cells');
    // PRECONDITION PINNED: the saving is real, not incidental. A producer that
    // called the model and then discarded the answer would pass the line above.
    expect(called).toBe(0);
  });

  it('reports unparseable content rather than throwing', async () => {
    const out = await estimateValueBatch(req([cell('opt_a', 'fac_a')]), replies('I think maybe 0.8?'));
    expect(out.status).toBe('unparseable');
  });
});

describe('readiness value estimator — what the model is actually told', () => {
  it('⭐ the unit convention is the PRODUCT’S OWN WORDS, not a paraphrase', async () => {
    // Witnessed on deployed staging 18 Sep: "Just the percentage is enough — it
    // is the level the factor reaches, not how much it moves: 0% means zero,
    // 100% means its top." Two spellings of one convention is how this estate's
    // scale defects start, so the prompt restates it rather than re-authoring it.
    expect(VALUE_ESTIMATE_SYSTEM_PROMPT).toContain('the level the factor reaches, not how much it moves');
    expect(VALUE_ESTIMATE_SYSTEM_PROMPT).toContain('0 means zero, 1 means its top');
    // And the refusal is asked for BY NAME — a contract field nothing requests
    // is a field nothing returns.
    expect(VALUE_ESTIMATE_SYSTEM_PROMPT).toContain('declined_reason');
    expect(VALUE_ESTIMATE_SYSTEM_PROMPT).toContain('A refusal is a correct answer');
  });

  it('names every asked cell by id, and carries the factor’s current level', () => {
    const content = buildValueEstimateUserContent(req([cell('opt_a', 'fac_a'), cell('opt_b', 'fac_b')]));
    expect(content).toContain('option_id=opt_a');
    expect(content).toContain('factor_id=fac_a');
    expect(content).toContain('option_id=opt_b');
    expect(content).toContain('currently 0.6');
    // fac_b has no recorded level — say so rather than imply zero.
    expect(content).toContain('no current level recorded');
    // The user's framing travels, so the estimate is about THIS decision.
    expect(content).toContain('Should we open a second site next quarter?');
  });

  it('the Structured Outputs schema admits a null value and forbids unknown keys', () => {
    const props = (VALUE_ESTIMATE_OUTPUT_SCHEMA as any).properties.estimates.items;
    expect(props.additionalProperties).toBe(false);
    expect(props.properties.value.type).toEqual(['number', 'null']);
    expect(props.required).toContain('value');
    // `declined_reason` is deliberately NOT in `required`: it is conditional on
    // a null, which JSON Schema draft-07 cannot express here and the Zod refine
    // above enforces. Pinned so nobody "fixes" the asymmetry and makes every
    // answered cell carry a refusal reason.
    expect(props.required).not.toContain('declined_reason');
  });
});
