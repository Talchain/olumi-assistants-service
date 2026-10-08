import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, strictForTheDrafter } from '../runtime/build-model.js';

type ItemSchema = {
  properties: Record<string, unknown>;
  required: string[];
};
type CandidateSchema = { properties: { risks: { items: ItemSchema }; outcomes: { items: ItemSchema }; links: { items: ItemSchema } } };
const riskSchema = (strict = false): ItemSchema => {
  const schema = buildCandidateSchema();
  return ((strict ? strictForTheDrafter(schema) : schema) as CandidateSchema).properties.risks.items;
};
const occurrence = { p_low_pct: 5, p_high_pct: 18, horizon_months: 12, basis_text: 'Typical annual key-staff turnover in small software teams.' };
const risk = { label: 'Key developer departure', provenance: 'ai_proposed' };
const exactInstruction = "A RISK THAT EITHER HAPPENS OR DOES NOT (a discrete event, such as a key person leaving, a client cancelling or a release slipping) carries its likelihood ON THE RISK: give `occurrence` with a low and a high percentage over the goal's horizon in months (or the period you mean) and a one-line basis from a reference class, and size its impact on the link to what it threatens, in that quantity's own units. Never draw that likelihood as a separate factor such as '… probability'.";
const userFloor = 'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. ';

describe('discrete event drafter contract', () => {
  it('accepts occurrence on a risk and preserves legacy recordings without one', () => {
    const validate = new Ajv({ strict: false }).compile(riskSchema());
    expect(validate(risk), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...risk, occurrence }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...risk, occurrence: null }), JSON.stringify(validate.errors)).toBe(true);
  });

  it('strict output requires the occurrence key while null says this risk has no event likelihood', () => {
    const schema = riskSchema(true);
    expect(schema.required).toContain('occurrence');
    const validate = new Ajv({ strict: false }).compile(schema);
    const framed = { ...risk, unit: null, plausible_max: null };
    expect(validate({ ...framed, occurrence: null }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...framed, occurrence }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(framed)).toBe(false);
  });

  it('allows percentages only from 0 to 100 and requires the complete event estimate', () => {
    const validate = new Ajv({ strict: false }).compile(riskSchema());
    expect(validate({ ...risk, occurrence }), JSON.stringify(validate.errors)).toBe(true);
    for (const invalid of [
      { ...occurrence, p_low_pct: -1 },
      { ...occurrence, p_high_pct: 101 },
      { ...occurrence, horizon_months: 0 },
      { p_low_pct: 5, p_high_pct: 18, horizon_months: 12 },
      { ...occurrence, invented: true },
    ]) expect(validate({ ...risk, occurrence: invalid }), JSON.stringify(invalid)).toBe(false);
  });

  it('puts the agreed instruction directly after the unchanged user-risk floor, exactly once', () => {
    const at = BUILD_INSTRUCTIONS.indexOf(userFloor);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(BUILD_INSTRUCTIONS.slice(at + userFloor.length).startsWith(exactInstruction)).toBe(true);
    expect(BUILD_INSTRUCTIONS.split(exactInstruction)).toHaveLength(2);
  });

  it('restricts the occurrence carrier to discrete risks, leaving outcomes and P44 links alone', () => {
    const schema = buildCandidateSchema() as CandidateSchema;
    const carrier = schema.properties.risks.items.properties.occurrence as { description?: string } | undefined;
    expect(carrier?.description).toMatch(/discrete.*event/i);
    expect(schema.properties.outcomes.items.properties).not.toHaveProperty('occurrence');
    expect(schema.properties.links.items.properties).not.toHaveProperty('occurrence');
  });
});
