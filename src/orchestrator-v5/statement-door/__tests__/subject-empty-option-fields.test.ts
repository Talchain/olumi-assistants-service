import { describe, expect, it } from 'vitest';
import { resolveSubject } from '../subject.js';

// Independent synthetic graphs; no saved scenario or user words are used.
const fixtures = [
  { prefix: 'orchard', riskLabel: 'Frost damage', factorLabel: 'Fruit yield', optionLabel: 'Install covers' },
  { prefix: 'archive', riskLabel: 'Water ingress', factorLabel: 'Collection condition', optionLabel: 'Repair roof' },
];

describe.each(fixtures)('resolveSubject: absent optional identities ($prefix)', ({ prefix, riskLabel, factorLabel, optionLabel }) => {
  const riskId = `${prefix}_risk`, factorId = `${prefix}_factor`, optionId = `${prefix}_option`;
  const graph = {
    nodes: [
      { id: riskId, kind: 'risk', label: riskLabel },
      { id: factorId, kind: 'factor', label: factorLabel },
      { id: optionId, kind: 'option', label: optionLabel },
    ],
    edges: [{ from: riskId, to: factorId }],
  };
  const risk = { kind: 'risk', id: riskId, field: 'occurrence' };
  const expectedRisk = { kind: 'resolved', label: riskLabel, subject: risk };

  it('T1 row 1: empty option id and label are absent for a risk', () => {
    const result = resolveSubject(graph, { ...risk, option_id: '', option_label: '' });
    expect(result).toEqual(expectedRisk);
    if (result.kind !== 'resolved') throw new Error('Expected a resolved risk');
    expect(result.subject.id).toBe(riskId);
    expect(result.subject.kind).toBe('risk');
    expect(result.subject).not.toHaveProperty('option_id');
  });

  it('T1 row 2: null option id and label are absent for a risk', () => {
    const result = resolveSubject(graph, { ...risk, option_id: null, option_label: null });
    expect(result).toEqual(expectedRisk);
    if (result.kind !== 'resolved') throw new Error('Expected a resolved risk');
    expect(result.subject).not.toHaveProperty('option_id');
  });

  it('whitespace-only option identities are absent', () => {
    expect(resolveSubject(graph, { ...risk, option_id: ' \t ', option_label: '\n ' })).toEqual(expectedRisk);
  });

  it('omitted and undefined option identities remain absent', () => {
    expect(resolveSubject(graph, risk)).toEqual(expectedRisk);
    expect(resolveSubject(graph, { ...risk, option_id: undefined, option_label: undefined })).toEqual(expectedRisk);
  });

  it('T1 row 3: non-empty unknown option labels and ids stay not_found', () => {
    expect(resolveSubject(graph, { ...risk, option_label: 'Unlisted alternative' })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(graph, { ...risk, option_id: 'missing_option', option_label: optionLabel })).toEqual({ kind: 'unresolved', reason: 'not_found' });
  });

  it('a numeric option_id stays not_found instead of resolving the factor alone', () => {
    expect(resolveSubject(graph, { kind: 'factor', id: factorId, field: 'level', option_id: 5 }))
      .toEqual({ kind: 'unresolved', reason: 'not_found' });
  });

  it('an object option_label stays not_found instead of resolving the factor alone', () => {
    expect(resolveSubject(graph, { kind: 'factor', id: factorId, field: 'level', option_label: { label: optionLabel } }))
      .toEqual({ kind: 'unresolved', reason: 'not_found' });
  });

  it('T1 row 4: a real option id stays attached to its subject', () => {
    expect(resolveSubject(graph, { ...risk, option_id: optionId, option_label: '' })).toEqual({
      ...expectedRisk, subject: { ...risk, option_id: optionId },
    });
  });

  it('T1 row 5: an empty option id resolves a link exactly as omission does', () => {
    const link = { kind: 'link', id: riskId, to_id: factorId, field: 'effect' };
    const omitted = resolveSubject(graph, link);
    expect(omitted).toEqual({ kind: 'resolved', label: `${riskLabel} → ${factorLabel}`, subject: link });
    expect(resolveSubject(graph, { ...link, option_id: '' })).toEqual(omitted);
  });

  it('duplicate matching option labels stay ambiguous', () => {
    const duplicate = { ...graph, nodes: [...graph.nodes, { id: `${prefix}_other_option`, kind: 'option', label: optionLabel }] };
    expect(resolveSubject(duplicate, { ...risk, option_id: '', option_label: optionLabel })).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
  });

  it('unknown fields and kinds keep their own reasons even with empty option fields', () => {
    expect(resolveSubject(graph, { ...risk, option_id: '', field: 'unknown' })).toEqual({ kind: 'unresolved', reason: 'unknown_field' });
    expect(resolveSubject(graph, { ...risk, option_id: '', kind: 'unknown' })).toEqual({ kind: 'unresolved', reason: 'unknown_kind' });
  });

  it('an identity from another entity kind cannot supply an option binding', () => {
    expect(resolveSubject(graph, { ...risk, option_id: factorId, option_label: optionLabel })).toEqual({ kind: 'unresolved', reason: 'not_found' });
    expect(resolveSubject(graph, { ...risk, option_id: '', option_label: riskLabel })).toEqual({ kind: 'unresolved', reason: 'not_found' });
  });
});
