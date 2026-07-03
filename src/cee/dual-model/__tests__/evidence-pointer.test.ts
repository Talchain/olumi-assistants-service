/**
 * Adversarial matrix for the evidence-pointer structural validator, plus the
 * FINDING pin that the LIVE envelope accepts what this validator rejects.
 *
 * The accept-list is as deliberate as the reject-list: values like 'n/a',
 * single characters and any-script text are ACCEPTED because rejecting them
 * would encode semantic policy that belongs to the M2 prompt (no prompt-side
 * assumptions in code).
 */
import { describe, it, expect } from 'vitest';
import {
  isMeaningfulEvidencePointer,
  explainEvidencePointerRejection,
  type EvidencePointerRejection,
} from '../evidence-pointer.js';
import { ProposalEnvelope } from '../../dual-draft/proposals.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import { baseGraph, riskProposal } from './adversarial-fixtures.js';

const REJECTS: Array<[string, string, EvidencePointerRejection]> = [
  ['empty string', '', 'empty'],
  ['single space', ' ', 'whitespace_or_invisible_only'],
  ['tabs and newlines', '\t\n\r ', 'whitespace_or_invisible_only'],
  ['non-breaking space', '\u00A0', 'whitespace_or_invisible_only'],
  ['em space', '\u2003', 'whitespace_or_invisible_only'],
  ['ideographic space', '\u3000', 'whitespace_or_invisible_only'],
  ['zero-width space only', '\u200B', 'whitespace_or_invisible_only'],
  ['zero-width joiner + BOM', '\u200D\uFEFF', 'whitespace_or_invisible_only'],
  ['soft hyphen only', '\u00AD', 'whitespace_or_invisible_only'],
  ['bidi controls only', '\u202E\u202C', 'whitespace_or_invisible_only'],
  ['zero-width wrapped whitespace', '\u200B \u200D\t\uFEFF', 'whitespace_or_invisible_only'],
  ['single period', '.', 'no_substantive_character'],
  ['ellipsis dots', '...', 'no_substantive_character'],
  ['dashes', '---', 'no_substantive_character'],
  ['punctuation soup', '?!,;:', 'no_substantive_character'],
  ['em dash', '\u2014', 'no_substantive_character'],
  ['braces', '{}', 'no_substantive_character'],
  ['emoji only', '\u{1F44D}\u{1F44D}', 'no_substantive_character'],
  ['currency symbol only', '\u00A3', 'no_substantive_character'],
];

const ACCEPTS: Array<[string, string]> = [
  ["the semantic-denylist candidate 'n/a' (semantics are the prompt's job)", 'n/a'],
  ["the word 'none'", 'none'],
  ['a single letter', 'x'],
  ['a single digit', '3'],
  ['brief pilcrow reference', 'brief \u00B62'],
  ['Cyrillic pointer', 'бриф: упоминание о рисках'],
  ['CJK pointer', '简报：提到监管审批'],
  ['substantive char surviving zero-width wrapping', '\u200Ba\u200B'],
  ['punctuation-framed letter', ' .a. '],
  ['typical brief quote', 'brief: "regulatory approval required"'],
];

describe('explainEvidencePointerRejection — reject matrix', () => {
  for (const [label, value, cause] of REJECTS) {
    it(`rejects ${label} (${cause})`, () => {
      expect(explainEvidencePointerRejection(value)).toBe(cause);
    });
  }

  it('rejects non-string input defensively (zod owns the type upstream)', () => {
    expect(explainEvidencePointerRejection(42)).toBe('not_a_string');
    expect(explainEvidencePointerRejection(null)).toBe('not_a_string');
    expect(explainEvidencePointerRejection(undefined)).toBe('not_a_string');
  });
});

describe('explainEvidencePointerRejection — deliberate accepts', () => {
  for (const [label, value] of ACCEPTS) {
    it(`accepts ${label}`, () => {
      expect(explainEvidencePointerRejection(value)).toBeNull();
    });
  }
});

describe('isMeaningfulEvidencePointer ≡ (explain === null) — property over every case', () => {
  const ALL = [...REJECTS.map(([, v]) => v), ...ACCEPTS.map(([, v]) => v)];
  it('the boolean and the explainer never disagree', () => {
    for (const value of ALL) {
      expect(isMeaningfulEvidencePointer(value)).toBe(
        explainEvidencePointerRejection(value) === null,
      );
    }
  });

  it('concatenations of rejected inputs stay rejected (no accidental accumulation)', () => {
    const rejected = REJECTS.map(([, v]) => v).filter((v) => v.length > 0);
    const mix = rejected.join('');
    expect(isMeaningfulEvidencePointer(mix)).toBe(false);
  });
});

describe('FINDING: the LIVE envelope accepts pointers this validator rejects', () => {
  // The wiring that closes this gap is a separate, explicitly-approved
  // commit (it changes flag-ON MVP behaviour) + its own Codex re-review.
  const LIVE_GAP = [' ', '\t\n', '\u200B', '\u00A0\u00A0', '...'];

  for (const value of LIVE_GAP) {
    it(`FINDING: live ProposalEnvelope accepts ${JSON.stringify(value)} and the proposal APPLIES`, () => {
      expect(ProposalEnvelope.safeParse({
        type: 'added_risk',
        delta: { node: { id: 'risk_ws', kind: 'risk', label: 'Whitespace-pointer risk' } },
        evidence_pointer: value,
      }).success).toBe(true);
      expect(isMeaningfulEvidencePointer(value)).toBe(false);

      const out = mergeProposals(baseGraph(), [
        { ...riskProposal('risk_ws2', 'Whitespace-pointer risk two'), evidence_pointer: value },
      ]);
      expect(out.report.applied).toBe(1);
    });
  }
});
