/**
 * Recovery Batch B × C merge (DL ruling B, 12 Oct): B's provenance reads are ROUTED through C's one authority
 * (`provenanceOf`, `cee/provenance/provenance-of.ts`), never listed in the shrink-only guard. PARITY: every row below is the
 * decision the reader made BEFORE routing (each row was run on 45784814, the pre-routing head, and passed there), so the same
 * table passing after routing proves the gate decision unchanged on these shapes, including the type-less `brief_extraction`
 * stamp (C: the person's by its stamp alone; gates read it as before).
 *
 * Three site groups: the canonical view's stated-range author (agent-capabilities `projectEntity`); the stated level range
 * and the point beside it (add-factor-transaction); the revised draft's later-human-material gate (draft-replacement G1).
 */
import { describe, expect, it } from 'vitest';
import { projectEntity } from '../runtime/agent-capabilities.js';
import { isStatedLevelRange, levelRangePointBasis, USER_TODAY_SOURCE } from '../../routing/add-factor-transaction.js';
import { humanMaterialAfterTheDraft } from '../runtime/draft-replacement.js';

type Rec = Record<string, unknown>;
const range = (source: string | undefined, extra: Rec = {}): Rec =>
  ({ low: 10, high: 30, meaning: 'min_max', ...(source === undefined ? {} : { source }), source_quote: 'between 10 and 30', ...extra });

describe('group 1 — the canonical view names a stated range\'s author exactly as before', () => {
  const author = (r: Rec) => (projectEntity({ id: 'f', kind: 'factor', label: 'F',
    observed_state: { value: 0.2, raw_value: 20, unit: 'x', source: USER_TODAY_SOURCE, range: r } } as never) as Rec).stated_range as Rec | undefined;
  it.each([
    ['the user\'s own range (L6 writer)', USER_TODAY_SOURCE, 'user'],
    ['a type-less brief stamp (a third party the brief quotes, Row5)', 'brief_extraction', 'third_party_unverified'],
    ['Olumi\'s inference', 'cee_inference', undefined],
    ['no author', undefined, undefined],
    ['an unknown stamp', 'something_else', undefined],
  ] as const)('%s', (_name, source, expected) => {
    expect(author(range(source))?.stated_by).toBe(expected);
  });
});

describe('group 2 — the stated level range and the point beside it, exactly as before', () => {
  const os = (source: string | undefined, extra: Rec = {}): Rec => ({ value: 0.2, raw_value: 20, unit: 'x', ...(source === undefined ? {} : { source }), ...extra });
  it.each([
    ['the user\'s own range around their figure', USER_TODAY_SOURCE, true],
    ['a type-less brief stamp', 'brief_extraction', false],
    ['Olumi\'s inference', 'cee_inference', false],
    ['no author', undefined, false],
  ] as const)('isStatedLevelRange: %s', (_name, source, expected) => {
    expect(isStatedLevelRange(range(source), os(USER_TODAY_SOURCE))).toBe(expected);
  });
  it.each([
    ['Olumi\'s figure at the midpoint of a brief\'s range', os('cee_inference'), 'midpoint'],
    ['Olumi\'s figure (inferred) at the midpoint', os('cee_inference', { extractionType: 'inferred' }), 'midpoint'],
    ['a human-written figure whose role is unverified', os('cee_inference', { user_material_unverified: true }), undefined],
    ['a type-less brief figure at the midpoint', os('brief_extraction'), undefined],
    ['the user\'s figure at the midpoint', os(USER_TODAY_SOURCE), undefined],
    // Independent check delta on 48ac90fa (CHECK-delta.md): routing made these "Olumi's midpoint"; they never were.
    ['the checker\'s counterexample: raw 20, source \'inferred\', a brief range 10–30', os('inferred'), undefined],
    ['a user-confirmed figure at the midpoint', os('user_confirmed'), undefined],
  ] as const)('levelRangePointBasis: %s', (_name, level, expected) => {
    expect(levelRangePointBasis({ ...level, range: range('brief_extraction') })).toBe(expected);
  });
});

describe('group 3 — the revised draft\'s later-human-material gate (G1) lists exactly as before', () => {
  const graphWith = (part: Rec): Rec => ({
    nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }, { id: 'f', kind: 'factor', label: 'Factor', ...(part.factor ?? {}) },
      { id: 'o', kind: 'option', label: 'Option', ...(part.option ?? {}) }],
    edges: part.edges ?? [],
  });
  it.each([
    ['a value the user overrode', { factor: { observed_state: { value: 0.4, source: 'user_override' } } }, ['your figure for ‘Factor’']],
    ['a value the user specified', { factor: { observed_state: { value: 0.4, source: 'user_specified' } } }, ['your figure for ‘Factor’']],
    ['a value with an unknown stamp', { factor: { observed_state: { value: 0.4, source: 'something_else' } } }, ['a value for ‘Factor’ whose author is not recorded']],
    ['a draft value (type-less brief stamp)', { factor: { observed_state: { value: 0.4, source: 'brief_extraction' } } }, []],
    ['a level the user specified', { option: { interventions: { f: { value: 0.5, source: 'user_specified' } } } }, ['your level for ‘Option’ on ‘Factor’']],
    ['a level with an unknown stamp', { option: { interventions: { f: { value: 0.5, source: 'something_else' } } } }, ['a level for ‘Option’ whose author is not recorded']],
    ['a draft level (type-less brief stamp)', { option: { interventions: { f: { value: 0.5, source: 'brief_extraction' } } } }, []],
    ['a link the user drew', { edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, provenance: { source: 'user_specified' } }] }, ['your link ‘Factor’ → ‘Goal’']],
    ['a link with an unknown stamp', { edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, provenance: { source: 'something_else' } }] }, ['a link ‘Factor’ → ‘Goal’ whose author is not recorded']],
    ['a draft link (type-less brief stamp)', { edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, provenance: { source: 'brief_extraction' } }] }, []],
  ] as const)('%s', (_name, part, expected) => {
    expect(humanMaterialAfterTheDraft(graphWith(part as Rec))).toEqual(expected);
  });
});
