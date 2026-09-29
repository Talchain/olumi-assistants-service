/**
 * Every structural message is said to the user verbatim (chat unblock answer,
 * UI Run gate), so none may use the graph vocabulary the UI's jargon guard
 * refuses. A refused message withholds the WHOLE blocker list on the UI and the
 * gate falls back to a line that names no remedy.
 *
 * ⚠ A HAND-KEPT MIRROR of the consumer's list (trap 12). Source: DGAI
 * `src/canvas/components/pre-analysis-v3/signals/ceeTextGuard.ts` (`edge`,
 * `edges`, plus the canonical glossary it reuses for `node`/`nodes`/`graph`), read
 * at DGAI staging `226cf1e2ead2a0bb5828e98f4e6b6a43cf1891b5`. If that list changes, change this one.
 *
 * SCOPE: `VIOLATION_COPY` only — both projections reach the user (CURRENT via
 * `analysis-ready-helper` → readiness issue `message` → the chat's unblock answer,
 * `/graph-readiness` `blocker_reason`, the UI gate; PREVIEW via `edit-graph`). The
 * per-violation `detail` strings carry internal ids and go only to the edit repair
 * loop and telemetry (`edit-graph.ts` `referentialErrors`/`failure_message`;
 * CODE-READ at CEE `6fe197f8`), so they are out of scope.
 */
import { describe, it, expect } from 'vitest';
import { VIOLATION_COPY } from '../../../src/orchestrator/graph-structure-validator.js';

// Mirrors DGAI `src/components/results/utils/glossaryCheck.ts` ANALYSIS_HERO_BANNED_TERMS
// and `ceeTextGuard.ts` CEE_EXTRA_TERMS verbatim, built the same way: a single word
// is word-boundary wrapped, a phrase matches literally, case-insensitive.
const ANALYSIS_HERO_BANNED_TERMS = [
  'recommend', 'recommended', 'recommendation', 'winner', 'winning', 'best choice',
  'wins', 'win rate', 'chance of winning', 'probability of success',
  'recommendation stability', 'robustness score', 'confidence score',
  'elasticity', 'factor sensitivity', 'sensitivity score', 'beta coefficient',
  'exists probability', 'belief exists', 'epistemic uncertainty',
  'strength mean', 'b coefficient', 'regression weight',
  'EVPI', 'expected value of perfect information', 'VOI', 'voi ranking',
  'fragile edge', 'switch probability', 'marginal switch probability',
  'stochastic', 'random sampling',
  'graph', 'DAG', 'SCM', 'structural causal model', 'nodes and edges',
  'blocked', 'cannot run', 'fix issues', 'fix issue', 'required actions', 'validation errors',
  'you have a bias', 'bias detected', 'you are exhibiting',
  'prior range', 'posterior', 'variance',
  'headline_type', 'observed state', 'observed_state', 'canonical_state',
  'exists_probability', 'voi', 'attribution_stability', 'rank_flip_rate',
  'model_critiques', 'strength_mean', 'strength_std', 'intervention',
  'bootstrap', 'perturbation', 'ISL', 'PLoT', 'CEE',
] as const;
const CEE_EXTRA_TERMS = ['node', 'nodes', 'edge', 'edges', 'graphs', 'decision graph', 'value of information'] as const;
const REFUSED = new RegExp(
  `(?:${[...ANALYSIS_HERO_BANNED_TERMS, ...CEE_EXTRA_TERMS]
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .map((t) => (/^[a-z][a-z_]*$/i.test(t) ? `\\b${t}\\b` : t))
    .join('|')})`,
  'i',
);

describe('structural violation copy is in the user\'s words', () => {
  const rows = Object.entries(VIOLATION_COPY).flatMap(([code, copy]) => [
    [code, 'preview', copy.preview] as const,
    [code, 'current', copy.current] as const,
  ]);

  it('CONTROL: the probe sees the vocabulary it refuses', () => {
    expect(REFUSED.test('Add at least one factor edge.')).toBe(true);
    expect(REFUSED.test('The model has no goal node.')).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it.each(rows)('%s (%s) says no graph vocabulary', (_code, _voice, text) => {
    expect(text).not.toMatch(REFUSED);
  });

  it('the option-without-factors message still names its remedy', () => {
    expect(VIOLATION_COPY.OPTION_NO_FACTOR_EDGES.current).toBe(
      'An option has no factor connections and cannot be analysed. Connect it to at least one factor.',
    );
  });
});
