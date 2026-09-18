/**
 * ⭐⭐ A LIKELIHOOD HAS A DESTINATION — and the point is that this is MEASURABLE.
 *
 * v20.1 told the model to leave `value` OUT when a risk's only number was a
 * likelihood. That instruction could never be evaluated: measured on the live
 * corpus, **135 of 28,055 risk nodes carry any value at all**, so a correct
 * suppression and a model that simply had no number are THE SAME OBSERVATION,
 * against a baseline dominating the signal 200:1. No corpus and no rewording
 * fixes that — it is the shape of the ask, not the wording.
 *
 * Routing fixes it twice: models route more reliably than they withhold, and a
 * routed value is a POSITIVE signal you can count over banked draws — a
 * population count, not a model run.
 *
 * ⚠ These tests assert the GRAMMAR AND THE INSTRUCTION, which is all that can
 * be asserted offline. Whether the model actually routes is a question about
 * the model and is rowed for when the testing pause lifts. A green file here is
 * NOT evidence that routing works — it is evidence that routing is POSSIBLE,
 * which it previously was not.
 */

import { describe, expect, it } from 'vitest';

import { DRAFT_RECORDS_INSTRUCTION } from '../instruction.js';
import {
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  SERIALIZED_BYTES_BUDGET,
  buildDraftClaimItemSchema,
  buildDraftRecordsSchema,
  countOptionalParams,
  draftClaimSchemaKeys,
} from '../grammar.js';

function claimProps(): Record<string, unknown> {
  const schema = buildDraftClaimItemSchema() as { properties?: Record<string, unknown> };
  const props = schema.properties ?? {};
  expect(Object.keys(props).length, 'claim schema has no properties — this probe is blind').toBeGreaterThan(0);
  return props;
}

describe('a likelihood has somewhere to go', () => {
  it('the grammar declares `likelihood` on a claim', () => {
    const props = claimProps();
    expect(props.likelihood).toEqual({ type: 'number' });
    // POSITIVE CONTROL on the same probe: a field that was always there. Without
    // it, a broken walk would read every field as absent and the assertion above
    // would be the only thing failing, which reads as a missing field rather
    // than a blind test.
    expect(props.value).toEqual({ type: 'number' });
  });

  it('`likelihood` and `value` are DIFFERENT fields, never merged', () => {
    // The trap-21 split this whole change exists for. If a later tidy-up folds
    // them, a probability starts being read downstream as a magnitude and a
    // user's limit gets checked against a chance.
    const props = claimProps();
    expect(Object.keys(props)).toContain('likelihood');
    expect(Object.keys(props)).toContain('value');
    expect(props.likelihood).not.toBe(props.value);
  });

  it('the instruction ROUTES rather than asking for silence', () => {
    // The distinction that makes the ask measurable. "leave it out" is
    // unobservable against a 99.5%-empty baseline; "put it here" is countable.
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('likelihood');
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('Put the number somewhere');
  });

  it('the exemplars are CUE-FREE, so a lexical shortcut cannot satisfy them', () => {
    // v20.1's three negative exemplars all contained the word "chance", so the
    // cheapest generalisation available to a model was the KEYWORD rather than
    // the test. A likelihood in a real brief is usually written without one.
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('Vendor slippage: 30%');
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('Contract loss: 4%');
    // …and the case that defeats a lexical AND a unit rule: a measure-word and
    // a risk-word together, on a risk node, at the same unit as the chances.
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('Churn risk: 4%');
    // The inverse class — a genuine measure wearing probability clothes.
    expect(DRAFT_RECORDS_INSTRUCTION).toContain('Win rate 25%');
  });

  it('⚠ THE GRAMMAR BUDGET STILL HOLDS — a field is not free', () => {
    // Anthropic's structured-outputs compiler enforces these, so a field added
    // without checking does not fail a test, it fails EVERY DRAFT AT RUNTIME.
    // The repo's own limits, read rather than restated.
    const schema = buildDraftRecordsSchema();
    expect(countOptionalParams(schema)).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    expect(Buffer.byteLength(JSON.stringify(schema), 'utf8')).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
    // …and the key is genuinely in the claim's key list, not just the object.
    expect(draftClaimSchemaKeys()).toContain('likelihood');
  });
});
