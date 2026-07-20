/**
 * F-2 (POSTDEPLOY-PROBES-573-2026-07-20) — trailing clauses garble into bogus
 * bolded "targets" in clarify copy.
 *
 * LIVE EVIDENCE (deployed build 53b817b): the propose copy presented
 *   "**CRM Platform Cost to 0.55.**"          (P4_T12_configure.json)
 *   "**Set CRM Platform Cost to 0.55.**"      (P5_T12b_configure_option.json)
 *   "**Set its effect on CRM Feature Depth to 0.7.**"  (P6_T12c_under_option.json)
 *   "**Not anything on the option.**"         (P9b_A6_redirect_to_factor.json)
 * to the user as entities the system had understood. They are raw message
 * clauses, not graph entities.
 *
 * Root cause: `buildProposedChanges` splits on `/\band\b|,/` and handed
 * `inferElementLabel` only the RESOLVED target's label as its candidate set —
 * never the graph's label set — so no clause after the first could ever match
 * and the fallback echoed the clause text, which the copy builder bolded.
 *
 * RULE PINNED HERE: a bolded target is a graph entity or it is nothing.
 * Derive it from the graph's own labels; never echo clause text.
 */
import { describe, it, expect } from 'vitest';

import {
  resolveClauseLabel,
  messageCarriesValueOrDirection,
  proposeCopyAsksForValueOrDirection,
} from '../../../../src/orchestrator/tools/propose-handoff.js';

/** Mirrors the live probe scenario's graph labels (P0 draft, DB-verified). */
const CRM_LABELS = [
  'CRM Platform Selection',
  'Cloud-Native CRM',
  'On-Prem Suite',
  'CRM Feature Depth',
  'CRM Platform Cost',
  'Maximise 3-Year ROI',
] as const;

describe('F-2 — the captured garbles resolve to real entities or to nothing', () => {
  it('P4 trailing clause resolves to the FACTOR it names, not to its own text', () => {
    expect(resolveClauseLabel('CRM Platform Cost to 0.55.', CRM_LABELS)).toBe('CRM Platform Cost');
  });

  it('P5 trailing clause resolves to the factor', () => {
    expect(resolveClauseLabel('set CRM Platform Cost to 0.55.', CRM_LABELS)).toBe(
      'CRM Platform Cost',
    );
  });

  it('P6 trailing clause resolves to the factor', () => {
    expect(resolveClauseLabel('set its effect on CRM Feature Depth to 0.7.', CRM_LABELS)).toBe(
      'CRM Feature Depth',
    );
  });

  it('P9b trailing clause names NO entity — it must resolve to nothing', () => {
    // "not anything on the option." is a negation, not a target. Bolding it
    // told the user the system had understood an entity by that name.
    expect(resolveClauseLabel('not anything on the option.', CRM_LABELS)).toBeNull();
  });

  it('a clause naming nothing in the graph resolves to nothing', () => {
    expect(resolveClauseLabel('tidy up whatever else looks off.', CRM_LABELS)).toBeNull();
  });

  it('longest match wins so a prefix label cannot shadow the specific one', () => {
    const labels = ['CRM', 'CRM Platform Cost'];
    expect(resolveClauseLabel('set CRM Platform Cost to 0.55.', labels)).toBe('CRM Platform Cost');
  });

  it('punctuation and possessives do not defeat the match', () => {
    expect(
      resolveClauseLabel("set the CRM Platform Cost factor's value to 0.55", CRM_LABELS),
    ).toBe('CRM Platform Cost');
  });

  it('empty and malformed inputs resolve to nothing rather than throwing', () => {
    expect(resolveClauseLabel('', CRM_LABELS)).toBeNull();
    expect(resolveClauseLabel('   ', CRM_LABELS)).toBeNull();
    expect(resolveClauseLabel('anything', [])).toBeNull();
    expect(resolveClauseLabel('anything', [undefined as unknown as string, ''])).toBeNull();
  });
});

describe('F-1 predicate — specifics present in the captured probe messages', () => {
  const CARRY = [
    'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.',
    'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7.',
    'Under the Cloud-Native CRM option, set its effect on CRM Feature Depth to 0.7.',
    'Set CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55 for the Cloud-Native CRM option.',
    "Set CRM Platform Cost to 0.55 - the configuration of Cloud-Native CRM shouldn't change.",
    'Configure nothing on Cloud-Native CRM; just set CRM Platform Cost to 0.55.',
    'Set CRM Platform Cost to 45000 pounds.',
    'CRM Feature Depth, target value 0.7.',
  ];
  it.each(CARRY)('carries a value or direction: %s', (message) => {
    expect(messageCarriesValueOrDirection(message)).toBe(true);
  });

  it('the qualitative no-digit form counts as a specific', () => {
    expect(
      messageCarriesValueOrDirection("Set the Cloud-Native CRM option's effect on CRM Feature Depth to high."),
    ).toBe(true);
  });

  it('a direction with a magnitude word counts as a specific', () => {
    expect(messageCarriesValueOrDirection('Halve CRM Platform Cost.')).toBe(true);
    expect(messageCarriesValueOrDirection('Lower CRM Platform Cost by a third.')).toBe(true);
  });

  const VAGUE = [
    'Configure the Cloud-Native CRM option.',
    'Make sure the effects on both options are captured.',
    'The options make no difference to the effect here.',
    '',
  ];
  it.each(VAGUE)('carries no value or direction: %s', (message) => {
    expect(messageCarriesValueOrDirection(message)).toBe(false);
  });
});

describe('F-1 anti-drift pin — the predicate matches what the copy asks for', () => {
  // trap-12: this predicate is only correct while the copy asks for a VALUE
  // or a DIRECTION. These are the live strings from edit-graph.ts; if the copy
  // is reworded to ask for something else, this fails loudly rather than
  // leaving the gate silently measuring the wrong thing.
  const LIVE_COPY = [
    'Tell me the specific value or direction (e.g. "set to N" or "lower by N") and I\'ll make it.',
    "Tell me which option parameter to change and its target value and I'll make it.",
    "Reply with the exact changes you'd like and I'll make them one at a time.",
  ];
  it.each(LIVE_COPY)('asks for a value or direction: %s', (copy) => {
    expect(proposeCopyAsksForValueOrDirection(copy)).toBe(true);
  });
});
