/**
 * V5 Coaching State Spine — Stage 1: deterministic DecisionContext extractor.
 *
 * Proves the projection is deterministic, grounded in structured state only
 * (projection NOT inference), conservative on timelines, sanitised/capped, and
 * always schema-valid — entirely without a live server, Supabase, or LLM.
 */

import { describe, it, expect } from 'vitest';

import {
  DecisionContextSchema,
  EMPTY_DECISION_CONTEXT,
} from '@talchain/schemas/orchestrator';

import { deriveDecisionContext } from '../decision-context.js';

// Minimal VALID GraphV3 (nodes + edges). Option + goal labels are the
// structured entity/goal source; the factor label must NOT surface as an
// entity, and an id-shaped label must be dropped.
const GRAPH = {
  nodes: [
    {
      id: 'goal_1',
      kind: 'goal',
      label: 'Reach £10m ARR',
      goal_threshold_raw: 10,
      goal_threshold_unit: '£m',
    },
    { id: 'opt_hire', kind: 'option', label: 'Hire a senior engineer' },
    { id: 'opt_outsource', kind: 'option', label: 'Outsource to an agency' },
    { id: 'fac_capacity', kind: 'factor', label: 'Engineering capacity' },
  ],
  edges: [],
};

describe('deriveDecisionContext — empty / degraded / total', () => {
  it('returns EMPTY_DECISION_CONTEXT when both brief and graph are absent', () => {
    expect(deriveDecisionContext(null, null)).toEqual(EMPTY_DECISION_CONTEXT);
  });

  it('returns not_populated for a whitespace brief + null graph', () => {
    expect(deriveDecisionContext('   ', null).status).toBe('not_populated');
  });

  it('never throws on a malformed graph and yields no graph anchors', () => {
    expect(() => deriveDecisionContext('hello', { garbage: true })).not.toThrow();
    const dc = deriveDecisionContext('hello', { garbage: true });
    expect(dc.domain_anchors.named_entities).toEqual([]);
    expect(dc.goal_translation).toEqual({
      user_scale_metric: null,
      user_scale_target: null,
    });
  });

  it('always returns a schema-valid DecisionContext', () => {
    const samples = [
      deriveDecisionContext(null, null),
      deriveDecisionContext('£2m by Q3 2026', GRAPH),
      deriveDecisionContext('no anchors here', null),
      deriveDecisionContext(null, GRAPH),
    ];
    for (const dc of samples) {
      expect(DecisionContextSchema.safeParse(dc).success).toBe(true);
    }
  });
});

describe('monetary figures — currency-symbol projection only', () => {
  it('extracts currency amounts from the brief', () => {
    const dc = deriveDecisionContext('We can spend up to £2m, plus $500k for tooling.', null);
    expect(dc.domain_anchors.monetary_figures).toContain('£2m');
    expect(dc.domain_anchors.monetary_figures).toContain('$500k');
  });

  it('excludes non-currency quantities (counts, percentages)', () => {
    const dc = deriveDecisionContext('We have 3 options and forecast 20% growth.', null);
    expect(dc.domain_anchors.monetary_figures).toEqual([]);
  });

  it('returns [] when the brief is null even if a graph is present', () => {
    expect(deriveDecisionContext(null, GRAPH).domain_anchors.monetary_figures).toEqual([]);
  });

  it('de-duplicates and caps to a sensible maximum', () => {
    const brief = '£1 £1 £2 £3 £4 £5 £6 £7 £8 £9 £10 £11 £12';
    const figures = deriveDecisionContext(brief, null).domain_anchors.monetary_figures;
    expect(figures.length).toBeLessThanOrEqual(8);
    expect(figures.filter((f) => f === '£1')).toHaveLength(1);
  });
});

describe('timeline — conservative, explicit tokens only', () => {
  it('extracts an explicit quarter+year', () => {
    expect(deriveDecisionContext('Launch by Q3 2026.', null).domain_anchors.timeline).toMatch(/Q3\s*2026/i);
  });

  it('extracts an explicit duration', () => {
    expect(deriveDecisionContext('We must decide within 6 months.', null).domain_anchors.timeline).toMatch(/6\s*months/i);
  });

  it('does NOT read a money amount as a year ($2000 -> no timeline)', () => {
    expect(deriveDecisionContext('Budget is $2000 for this.', null).domain_anchors.timeline).toBeNull();
  });

  it('does NOT infer urgency/horizon from vague language', () => {
    for (const brief of ['This is urgent.', 'We need this soon.', 'A long-term, strategic bet.']) {
      expect(deriveDecisionContext(brief, null).domain_anchors.timeline).toBeNull();
    }
  });
});

describe('graph anchors — structured labels only', () => {
  it('derives named_entities from option + goal labels (not factors)', () => {
    const e = deriveDecisionContext(null, GRAPH).domain_anchors.named_entities;
    expect(e).toContain('Hire a senior engineer');
    expect(e).toContain('Outsource to an agency');
    expect(e).toContain('Reach £10m ARR');
    expect(e).not.toContain('Engineering capacity'); // factor label excluded
  });

  it('derives goal translation from the goal label + raw user-scale threshold', () => {
    const dc = deriveDecisionContext(null, GRAPH);
    expect(dc.goal_translation.user_scale_metric).toBe('Reach £10m ARR');
    expect(dc.goal_translation.user_scale_target).toBe('10 £m');
  });

  it('drops id-shaped labels from named_entities (no raw IDs)', () => {
    const graph = {
      nodes: [
        { id: 'opt_x', kind: 'option', label: 'opt_secret_id' },
        { id: 'opt_y', kind: 'option', label: 'Real Option' },
      ],
      edges: [],
    };
    const e = deriveDecisionContext(null, graph).domain_anchors.named_entities;
    expect(e).toContain('Real Option');
    expect(e).not.toContain('opt_secret_id');
  });
});

describe('status transitions', () => {
  it('not_populated when nothing is grounded', () => {
    expect(deriveDecisionContext('just some prose', null).status).toBe('not_populated');
  });

  it('partial when some but not all anchor classes are grounded', () => {
    // Graph (entities + goal) but no monetary figure.
    expect(deriveDecisionContext(null, GRAPH).status).toBe('partial');
    // Money only, no graph.
    expect(deriveDecisionContext('We can spend £2m.', null).status).toBe('partial');
  });

  it('populated when money + entities + goal are all grounded', () => {
    expect(deriveDecisionContext('We can spend £2m.', GRAPH).status).toBe('populated');
  });
});

describe('projection not inference + determinism', () => {
  it('never sets anchors from sentiment/stakes/reversibility language', () => {
    const dc = deriveDecisionContext(
      'This is a high-stakes, irreversible decision we must make under pressure.',
      null,
    );
    expect(dc).toEqual(EMPTY_DECISION_CONTEXT);
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const a = deriveDecisionContext('Spend £2m by Q3 2026', GRAPH);
    const b = deriveDecisionContext('Spend £2m by Q3 2026', GRAPH);
    expect(a).toEqual(b);
  });
});
