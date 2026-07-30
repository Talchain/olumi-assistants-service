/**
 * decision_review — PRODUCTION ASSEMBLY GROUNDING.
 *
 * The single most important property of this pack: the user message a candidate
 * prompt is evaluated against is built by the RUNTIME's own
 * `buildDecisionReviewUserMessage`, not by a copy of it.
 *
 * `tools/graph-evaluator`'s decision-review adapter is the counter-example this
 * exists to avoid becoming: it builds `JSON.stringify(fixture.input)` plus a
 * hardcoded `<SCIENCE_CLAIMS>` block, so it has no section tags at all and
 * cannot see truncation disclosure, scaffold disclosure, or flip thresholds —
 * three input surfaces the runtime added after that adapter was written. Its
 * scores measure the twin.
 *
 * These tests assert the grounding is REAL rather than claimed: the assembled
 * message must carry the runtime's tags, the runtime's caps, and the runtime's
 * conditional branches.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDecisionReviewUserMessage,
  DECISION_REVIEW_MAX_GRAPH_NODES,
  DECISION_REVIEW_MAX_BRIEF_CHARS,
} from '../../../src/cee/decision-review/invoke.js';
import type { ReviewInputForGrounding } from '../../../src/cee/decision-review/shape-check.js';
import {
  assembleDecisionReviewUserMessage,
  computeMargin,
  sectionsPresent,
} from '../src/decision-review/assemble.js';
import { loadDecisionReviewFixtures } from '../src/decision-review/run.js';
import type { DecisionReviewEvalInput } from '../src/decision-review/types.js';

const fixtures = loadDecisionReviewFixtures();

describe('the eval calls the PRODUCTION assembler', () => {
  it('produces byte-identical output to a direct runtime call', () => {
    // The strongest available proof that no copy has crept in: if
    // `assembleDecisionReviewUserMessage` ever grew its own formatting, this
    // diverges immediately.
    for (const f of fixtures) {
      const viaEval = assembleDecisionReviewUserMessage(f.input).userMessage;
      const viaRuntime = buildDecisionReviewUserMessage(f.input, computeMargin(f.input));
      expect(viaEval, `${f.id}: eval assembly diverged from the runtime`).toBe(viaRuntime);
    }
  });

  it('emits the runtime section tags', () => {
    const msg = assembleDecisionReviewUserMessage(fixtures[0].input).userMessage;
    for (const tag of ['<BRIEF>', '<GRAPH>', '<ISL_RESULTS>', '<DETERMINISTIC_COACHING>', '<DECISION_CONTEXT>']) {
      expect(msg).toContain(tag);
    }
  });
});

describe('the conditional branches are actually reached by the pack', () => {
  it('a scaffolded run emits <SCAFFOLDED_OPTIONS>; a normal run does not', () => {
    const scaffolded = fixtures.find((f) => typeof f.input.scaffold_disclosure === 'string');
    const plain = fixtures.find((f) => f.input.scaffold_disclosure === undefined);
    expect(scaffolded, 'no fixture carries scaffold_disclosure').toBeDefined();
    expect(plain, 'every fixture carries scaffold_disclosure — the absent branch is never exercised').toBeDefined();
    expect(sectionsPresent(assembleDecisionReviewUserMessage(scaffolded!.input).userMessage)).toContain(
      'SCAFFOLDED_OPTIONS',
    );
    expect(sectionsPresent(assembleDecisionReviewUserMessage(plain!.input).userMessage)).not.toContain(
      'SCAFFOLDED_OPTIONS',
    );
  });

  it('a run without flip data assembles the "Not available" branch', () => {
    const without = fixtures.find((f) => f.input.flip_threshold_data === undefined);
    expect(without, 'every fixture carries flip_threshold_data — the absent branch is never exercised').toBeDefined();
    const msg = assembleDecisionReviewUserMessage(without!.input).userMessage;
    expect(msg).toContain('<FLIP_THRESHOLD_DATA>');
    expect(msg).toContain('Not available');
  });

  it('a single-option run assembles the null runner-up line', () => {
    const single = fixtures.find((f) => f.input.runner_up === null);
    expect(single, 'no single-option fixture in the pack').toBeDefined();
    expect(assembleDecisionReviewUserMessage(single!.input).userMessage).toContain(
      'runner_up: null (single-option decision)',
    );
    expect(computeMargin(single!.input)).toBeNull();
  });
});

describe('margin is computed, never carried', () => {
  it('matches the runtime identity for every fixture', () => {
    for (const f of fixtures) {
      const expected =
        f.input.runner_up === null
          ? null
          : f.input.winner.win_probability - f.input.runner_up.win_probability;
      expect(computeMargin(f.input), f.id).toBe(expected);
    }
  });

  it('no fixture carries a hand-written margin that could disagree', () => {
    // The revived March pack DID: 01-clear-winner recorded margin 0.15 next to a
    // 0.72 / 0.28 winner-runner_up pair (0.44). A fixture-carried margin is a
    // second copy of a derivable value, and nothing was checking it.
    for (const f of fixtures) {
      expect(
        (f.input as unknown as Record<string, unknown>).margin,
        `${f.id} carries a hand-written margin`,
      ).toBeUndefined();
    }
  });
});

describe('the runtime caps still apply through the eval', () => {
  it('a graph over the node cap is truncated WITH disclosure', () => {
    // Proves the eval inherits the runtime's structural ceiling rather than
    // feeding an unbounded payload a real call would never see.
    const base = fixtures[0].input;
    const huge: DecisionReviewEvalInput = {
      ...base,
      graph: {
        ...base.graph,
        nodes: Array.from({ length: DECISION_REVIEW_MAX_GRAPH_NODES + 5 }, (_, i) => ({
          id: `fac_synthetic_${i}`,
          kind: 'factor',
          label: `Synthetic Factor ${i}`,
        })),
      },
    };
    const msg = assembleDecisionReviewUserMessage(huge).userMessage;
    expect(msg).toContain('[TRUNCATED:');
    expect(msg).toContain('additional graph.nodes entries omitted');
  });

  it('an over-long brief is truncated WITH disclosure', () => {
    const base = fixtures[0].input;
    const long: DecisionReviewEvalInput = {
      ...base,
      brief: 'x'.repeat(DECISION_REVIEW_MAX_BRIEF_CHARS + 100),
    };
    expect(assembleDecisionReviewUserMessage(long).userMessage).toContain('brief truncated at');
  });
});

describe('fixture inputs satisfy BOTH production contracts', () => {
  it('type-level: an eval input is a valid grounding input', () => {
    // Compile-time assertion. A fixture shape that drifts from either
    // production contract fails to typecheck rather than quietly scoring
    // against a shape the runtime never sees.
    for (const f of fixtures) {
      const grounding: ReviewInputForGrounding = f.input;
      expect(grounding.winner).toBeDefined();
    }
  });

  it('every fixture graph carries an id corpus for the entity-grounding rule', () => {
    // The runtime SKIPS entity grounding when the corpus is empty — so a
    // fixture with id-less graph entities would make that dimension pass
    // vacuously. The March pack's graph EDGES had no ids at all.
    for (const f of fixtures) {
      const nodes = Array.isArray(f.input.graph.nodes) ? f.input.graph.nodes : [];
      const edges = Array.isArray(f.input.graph.edges) ? f.input.graph.edges : [];
      const ids = [...nodes, ...edges].filter(
        (e) => typeof (e as Record<string, unknown>)?.id === 'string',
      );
      expect(ids.length, `${f.id}: graph has no id corpus`).toBeGreaterThan(0);
      expect(
        edges.every((e) => typeof (e as Record<string, unknown>)?.id === 'string'),
        `${f.id}: graph edges lack ids (the March pack's defect)`,
      ).toBe(true);
    }
  });
});
