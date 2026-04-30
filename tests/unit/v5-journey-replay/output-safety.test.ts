import { describe, expect, it } from 'vitest';

import {
  ENTITY_ID_RE,
  INTERNAL_TERM_RE_LENIENT,
  INTERNAL_TERM_RE_STRICT,
  scanForEntityIds,
  scanInternalTerms,
} from '../../../tools/v5-journey-replay/output-safety.js';

/**
 * Pinning test: the harness's ENTITY_ID_RE is a HAND-MIRRORED copy of
 * `ENTITY_ID_LEAK_RE` from `src/orchestrator/shared/entity-id-pattern.ts`.
 * If the canonical regex changes (new prefix added, separator widened,
 * etc.), this test fires until someone consciously updates the harness
 * mirror. Keep both in lockstep.
 *
 * The canonical source pattern at the time of writing is:
 *   /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+\b/i
 */
describe('ENTITY_ID_RE — canonical-mirror pinning', () => {
  const CANONICAL_PREFIXES = [
    'fac',
    'opt',
    'goal',
    'dec',
    'out',
    'risk',
    'con',
    'factor',
    'option',
    'decision',
    'outcome',
    'constraint',
  ] as const;

  it.each(CANONICAL_PREFIXES.map((p) => [p]))(
    'matches %s_<id>',
    (prefix) => {
      expect(`${prefix}_test_001`.match(ENTITY_ID_RE)?.[0]).toBe(`${prefix}_test_001`);
    },
  );

  it('matches each prefix with the colon separator', () => {
    for (const p of CANONICAL_PREFIXES) {
      expect(`${p}:test`.match(ENTITY_ID_RE)).not.toBeNull();
    }
  });

  it('matches each prefix with the dash separator', () => {
    for (const p of CANONICAL_PREFIXES) {
      expect(`${p}-test`.match(ENTITY_ID_RE)).not.toBeNull();
    }
  });

  it('source pattern has not drifted from the canonical mirror', () => {
    // Spot-check a few specific shapes against the literal regex source.
    // If the pattern source string changes intentionally, update this
    // assertion at the same time as updating ENTITY_ID_RE in
    // output-safety.ts.
    expect(ENTITY_ID_RE.source).toBe(
      '\\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+\\b',
    );
    expect(ENTITY_ID_RE.flags).toBe('i');
  });
});

describe('ENTITY_ID_RE', () => {
  it('matches the canonical short prefixes', () => {
    expect('fac_churn_rate'.match(ENTITY_ID_RE)?.[0]).toBe('fac_churn_rate');
    expect('opt_hire_local'.match(ENTITY_ID_RE)?.[0]).toBe('opt_hire_local');
    expect('dec_root'.match(ENTITY_ID_RE)?.[0]).toBe('dec_root');
    expect('goal_revenue'.match(ENTITY_ID_RE)?.[0]).toBe('goal_revenue');
    expect('out_q3_revenue'.match(ENTITY_ID_RE)?.[0]).toBe('out_q3_revenue');
    expect('risk_attrition'.match(ENTITY_ID_RE)?.[0]).toBe('risk_attrition');
    expect('con_budget_cap'.match(ENTITY_ID_RE)?.[0]).toBe('con_budget_cap');
  });

  it('matches the full-word prefixes', () => {
    expect('factor_churn'.match(ENTITY_ID_RE)?.[0]).toBe('factor_churn');
    expect('option_hire'.match(ENTITY_ID_RE)?.[0]).toBe('option_hire');
    expect('decision_root'.match(ENTITY_ID_RE)?.[0]).toBe('decision_root');
    expect('outcome_q3'.match(ENTITY_ID_RE)?.[0]).toBe('outcome_q3');
    expect('constraint_budget'.match(ENTITY_ID_RE)?.[0]).toBe('constraint_budget');
  });

  it('matches all separator forms', () => {
    expect('fac_churn'.match(ENTITY_ID_RE)).not.toBeNull();
    expect('fac:churn'.match(ENTITY_ID_RE)).not.toBeNull();
    expect('fac-churn'.match(ENTITY_ID_RE)).not.toBeNull();
  });

  it('does not match unrelated words that share a prefix', () => {
    expect('factory worker'.match(ENTITY_ID_RE)).toBeNull();
    expect('outcome '.match(ENTITY_ID_RE)).toBeNull();
    expect('option '.match(ENTITY_ID_RE)).toBeNull();
  });
});

describe('scanForEntityIds — path-aware tree walk', () => {
  it('flags a leak in assistant_text', () => {
    const matches = scanForEntityIds({ assistant_text: 'fac_churn is leading' });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe('$.assistant_text');
    expect(matches[0]?.match).toBe('fac_churn');
  });

  it('flags a leak in coaching.summary', () => {
    const matches = scanForEntityIds({
      coaching: { summary: 'Strengthen fac_revenue evidence' },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe('$.coaching.summary');
  });

  it('flags a leak in suggested_actions[].label and message', () => {
    const matches = scanForEntityIds({
      suggested_actions: [
        { id: 'fac_safe_id_field', label: 'Compare fac_churn options', message: 'click me' },
      ],
    });
    // The id is excluded; the label is scanned.
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe('$.suggested_actions[0].label');
  });

  it('does NOT flag entity ids in excluded structural fields', () => {
    const body = {
      suggested_actions: [{ id: 'opt_hire_local', label: 'OK', message: 'OK' }],
      blocks: [{ referenced_option_ids: ['opt_hire_local'] }],
      coaching: { bias_signals: [{ target: 'fac_churn', detail: 'safe' }] },
    };
    const matches = scanForEntityIds(body);
    expect(matches).toHaveLength(0);
  });

  it('skips fields whose names end in _id (scenario_id, request_id, turn_id, journey_id, ...)', () => {
    const body = {
      scenario_id: 'opt_should_be_excluded',
      request_id: 'fac_should_be_excluded',
      turn_id: 'dec_should_be_excluded',
      journey_id: 'risk_should_be_excluded',
      goal_node_id: 'goal_should_be_excluded',
    };
    const matches = scanForEntityIds(body);
    expect(matches).toHaveLength(0);
  });

  it('STILL flags entity ids in user-facing text siblings of excluded id fields', () => {
    // The exclusion is field-name-scoped, NOT parent-object-scoped. A
    // sibling text field (label / message / summary / narrative) at the
    // same depth as an excluded *_id must still be scanned. This proves
    // the broad suffix rule does not let leaks slip through by sitting
    // next to a structural id.
    const body = {
      suggested_actions: [
        {
          id: 'opt_safe_excluded',
          scenario_id: 'opt_also_safe',
          label: 'Compare opt_hire vs opt_offshore',
          message: 'Click to see fac_runway',
        },
      ],
      blocks: [
        { referenced_option_ids: ['opt_a'], narrative: 'Option A is led by fac_revenue' },
      ],
    };
    const matches = scanForEntityIds(body);
    const matchPaths = matches.map((m) => m.path);
    expect(matchPaths).toContain('$.suggested_actions[0].label');
    expect(matchPaths).toContain('$.suggested_actions[0].message');
    expect(matchPaths).toContain('$.blocks[0].narrative');
    // And the excluded fields must NOT be in the match list:
    expect(matchPaths).not.toContain('$.suggested_actions[0].id');
    expect(matchPaths).not.toContain('$.suggested_actions[0].scenario_id');
    expect(matchPaths).not.toContain('$.blocks[0].referenced_option_ids');
  });

  it('flags multiple leaks across multiple paths', () => {
    const matches = scanForEntityIds({
      assistant_text: 'fac_churn beats opt_hire',
      coaching: { summary: 'Watch dec_root' },
    });
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('handles null / undefined / empty body gracefully', () => {
    expect(scanForEntityIds(null)).toEqual([]);
    expect(scanForEntityIds(undefined)).toEqual([]);
    expect(scanForEntityIds({})).toEqual([]);
    expect(scanForEntityIds([])).toEqual([]);
  });

  it('walks deeply nested objects', () => {
    const matches = scanForEntityIds({
      blocks: [{ enrichment: { decision_review: { summary: 'fac_churn' } } }],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toContain('blocks[0].enrichment.decision_review.summary');
  });
});

describe('INTERNAL_TERM_RE_STRICT', () => {
  it('flags unambiguous internal-leak phrases', () => {
    expect('The analysis service encountered an error'.match(INTERNAL_TERM_RE_STRICT)).not.toBeNull();
    expect('Zod parse failed'.match(INTERNAL_TERM_RE_STRICT)).not.toBeNull();
    expect('the executor crashed'.match(INTERNAL_TERM_RE_STRICT)).not.toBeNull();
    expect('AI service is unavailable'.match(INTERNAL_TERM_RE_STRICT)).not.toBeNull();
  });

  it('does NOT flag normal decision content', () => {
    expect('The analysis took longer than expected'.match(INTERNAL_TERM_RE_STRICT)).toBeNull();
    expect('There is an error margin'.match(INTERNAL_TERM_RE_STRICT)).toBeNull();
    expect('The implementation may fail'.match(INTERNAL_TERM_RE_STRICT)).toBeNull();
  });
});

describe('INTERNAL_TERM_RE_LENIENT', () => {
  it('flags soft phrases', () => {
    expect('handler invoked'.match(INTERNAL_TERM_RE_LENIENT)).not.toBeNull();
    expect('the winner is'.match(INTERNAL_TERM_RE_LENIENT)).not.toBeNull();
    expect('we recommended option A'.match(INTERNAL_TERM_RE_LENIENT)).not.toBeNull();
  });

  it('does not flag bare error / failed (those are too common)', () => {
    expect('encountered an error condition'.match(INTERNAL_TERM_RE_LENIENT)).toBeNull();
    expect('something failed'.match(INTERNAL_TERM_RE_LENIENT)).toBeNull();
  });
});

describe('scanInternalTerms', () => {
  it('strict mode flags only on user-facing fields', () => {
    const matches = scanInternalTerms(
      { assistant_text: 'The analysis service encountered an error' },
      'strict',
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.mode).toBe('strict');
  });

  it('lenient mode reports softer phrases', () => {
    const matches = scanInternalTerms(
      { assistant_text: 'The handler picked option A' },
      'lenient',
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.match.toLowerCase()).toBe('handler');
  });

  it('skips structural fields even when strict matches would fire', () => {
    const matches = scanInternalTerms(
      { suggested_actions: [{ id: 'handler', label: 'OK', message: 'OK' }] },
      'lenient',
    );
    // 'handler' on suggested_actions[].id is structural — not flagged.
    expect(matches).toEqual([]);
  });
});
