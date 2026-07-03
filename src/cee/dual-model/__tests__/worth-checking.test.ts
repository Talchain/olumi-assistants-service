/**
 * Worth-checking composer tests: determinism, priority/cap/omitted
 * arithmetic, exact templates, whole-section fail-closed suppression, and
 * the parity pin keeping the LOCAL leak-token copy byte-equal to
 * chip-safety.ts (the src import is forbidden by the cee↛orchestrator-v5
 * layering rule; TEST scope may import both to compare).
 */
import { describe, it, expect } from 'vitest';
import {
  composeWorthChecking,
  WORTH_CHECKING_MAX_ITEMS,
  WORTH_CHECKING_LINE_MAX_CHARS,
  WORTH_CHECKING_LEAK_TOKENS,
  type WorthCheckingArtifactInput,
} from '../worth-checking.js';
import { CHIP_EGRESS_FORBIDDEN_TOKENS } from '../../../orchestrator-v5/compose/chip-safety.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import { baseGraph } from './adversarial-fixtures.js';

function gap(question: string): WorthCheckingArtifactInput {
  return { type: 'added_evidence_gap', question };
}

const MIXED: readonly WorthCheckingArtifactInput[] = [
  { type: 'uncertainty_flag', question: 'Price elasticity is a guess' },
  { type: 'added_option', question: 'Consider an additional option: "Partner with a distributor"' },
  { type: 'added_evidence_gap', question: 'What is the churn baseline?' },
  { type: 'clarification_proposal', question: 'Which market does this target?' },
];

describe('parity pin — local leak-token copy vs chip-safety SSOT', () => {
  it('WORTH_CHECKING_LEAK_TOKENS === CHIP_EGRESS_FORBIDDEN_TOKENS exactly', () => {
    expect([...WORTH_CHECKING_LEAK_TOKENS]).toEqual([...CHIP_EGRESS_FORBIDDEN_TOKENS]);
  });
});

describe('composition — priority, templates, caps', () => {
  it('renders in priority order with exact templates', () => {
    const section = composeWorthChecking(MIXED, { maxItems: 8 });
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Worth checking');
    expect(section!.items.map((i) => i.text)).toEqual([
      'A question that could sharpen this: Which market does this target?',
      'Worth checking: What is the churn baseline?',
      'Flagged as uncertain: Price elasticity is a guess',
      'An option was suggested but not evaluated: "Partner with a distributor"',
    ]);
    expect(section!.omitted_count).toBe(0);
  });

  it('never claims evaluation: the option template asserts NOT evaluated, and an unwrapped question falls back raw', () => {
    const section = composeWorthChecking([{ type: 'added_option', question: 'A franchise model' }]);
    expect(section!.items[0].text).toBe('An option was suggested but not evaluated: "A franchise model"');
  });

  it('default cap is 3; the remainder counts as omitted', () => {
    const section = composeWorthChecking(MIXED);
    expect(section!.items).toHaveLength(WORTH_CHECKING_MAX_ITEMS);
    expect(section!.omitted_count).toBe(1);
  });

  it('maxItems clamps to [1, 8]', () => {
    expect(composeWorthChecking(MIXED, { maxItems: 0 })!.items).toHaveLength(1);
    expect(composeWorthChecking(MIXED, { maxItems: 99 })!.items).toHaveLength(4);
  });

  it('is deterministic: same input → deep-equal sections', () => {
    expect(composeWorthChecking(MIXED)).toEqual(composeWorthChecking(MIXED));
  });

  it('stable order within a priority class follows input order', () => {
    const section = composeWorthChecking([gap('First gap?'), gap('Second gap?')]);
    expect(section!.items.map((i) => i.text)).toEqual([
      'Worth checking: First gap?',
      'Worth checking: Second gap?',
    ]);
  });
});

describe('omission (not suppression) paths', () => {
  it('whitespace-only questions are omitted, not section-nulling', () => {
    const section = composeWorthChecking([gap('   '), gap('Real question?')]);
    expect(section!.items).toHaveLength(1);
    expect(section!.omitted_count).toBe(1);
  });

  it('unknown artifact types are omitted', () => {
    const section = composeWorthChecking([
      { type: 'mystery', question: 'X?' },
      gap('Real question?'),
    ]);
    expect(section!.items).toHaveLength(1);
    expect(section!.omitted_count).toBe(1);
  });

  it('over-length lines are omitted', () => {
    const long = 'w'.repeat(WORTH_CHECKING_LINE_MAX_CHARS + 1);
    const section = composeWorthChecking([gap(long), gap('Short?')]);
    expect(section!.items.map((i) => i.text)).toEqual(['Worth checking: Short?']);
    expect(section!.omitted_count).toBe(1);
  });

  it('case-insensitive duplicates keep the first occurrence', () => {
    const section = composeWorthChecking([gap('Churn baseline?'), gap('CHURN BASELINE?')]);
    expect(section!.items).toHaveLength(1);
    expect(section!.omitted_count).toBe(1);
  });

  it('empty input and all-omitted input return null (nothing to surface)', () => {
    expect(composeWorthChecking([])).toBeNull();
    expect(composeWorthChecking([gap('  '), { type: 'mystery', question: 'X?' }])).toBeNull();
  });
});

describe('fail-closed suppression — ONE violating line nulls the WHOLE section', () => {
  const SAFE = gap('What is the churn baseline?');

  it.each([
    ['G14 claim (EVPI)', 'the EVPI is decisive here'],
    ['quantified probability', 'there is a 12% probability of failure'],
    ['percentage alone (stricter than G14)', 'about 40% of customers churn'],
    ['probability language (stricter than G14)', 'the probability of churn is unknown'],
    ['analysed language', 'we analysed the churn data'],
    ['recommendation language', 'the recommended path is unclear'],
    ['optimality language', 'the optimal price is unknown'],
    ['best-option language', 'is this the best option available?'],
    ['chip leak token (handler id)', 'should run_analysis cover churn?'],
    ['chip leak token (graph_hash)', 'the graph_hash changed since'],
    ['raw JSON opener', 'payload was {"proposals": []}'],
  ])('%s → whole section null despite a safe sibling', (_label, hostile) => {
    expect(composeWorthChecking([SAFE, gap(hostile)])).toBeNull();
  });

  it('a violating line beyond the cap still nulls the section (checked before capping)', () => {
    const section = composeWorthChecking(
      [gap('Q1?'), gap('Q2?'), gap('Q3?'), gap('the EVPI is decisive')],
      { maxItems: 3 },
    );
    expect(section).toBeNull();
  });
});

describe('end-to-end from a real merge outcome', () => {
  it('DeferArtifacts from mergeProposals feed the composer structurally', () => {
    const out = mergeProposals(baseGraph(), [
      { type: 'added_evidence_gap', delta: { question: 'Churn baseline?' }, evidence_pointer: 'e' },
      {
        type: 'added_option',
        delta: { node: { id: 'opt_p', kind: 'option', label: 'Partner route' } },
        evidence_pointer: 'e',
      },
    ]);
    const section = composeWorthChecking(out.artifacts);
    expect(section!.items.map((i) => i.text)).toEqual([
      'Worth checking: Churn baseline?',
      'An option was suggested but not evaluated: "Partner route"',
    ]);
  });
});
