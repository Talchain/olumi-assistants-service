/**
 * Unit tests for `isValueUpdatePhrasing` — the value-update negative
 * gate used by route-v2 to bypass the fragile edit_graph LLM JSON
 * dispatch path for clear value-update phrasings.
 *
 * Table-driven so future regressions (e.g. additional filler tokens,
 * new kind keywords) are easy to lock in. Each table row is a test
 * input plus its expected gate verdict (`true` = suppress edit_graph,
 * `false` = stay on the edit_graph route).
 *
 * Mirrors the integration tests in
 * tests/integration/orchestrator/route-v2-edit-graph.test.ts but at
 * the predicate boundary so failures point directly at the gate
 * module without HTTP / Fastify / mocks in the failure path.
 */
import { describe, it, expect } from 'vitest';

import { isValueUpdatePhrasing, __testOnly } from '../value-update-gate.js';

interface Case {
  readonly label: string;
  readonly message: string;
  readonly expect: boolean; // true = suppress (gate matches)
}

const SUPPRESS_CASES: ReadonlyArray<Case> = [
  // Clause A — set/update X to <numeric or fuzzy non-structural Y>
  { label: 'set numeric',                       message: 'set churn to 5%',                                                expect: true },
  { label: 'update categorical',                message: 'update existing team maturity to mid-weight developers',         expect: true },
  { label: 'update categorical with "to be"',   message: 'update the existing team maturity to be mid-weight developers',  expect: true },
  // Clause B — increase/decrease/etc X by Y
  { label: 'increase by numeric',               message: 'increase price by 10%',                                          expect: true },
  { label: 'decrease by fuzzy',                 message: 'decrease the cost by half',                                      expect: true },
  { label: 'lower by fuzzy',                    message: 'Lower the cost factor by a notch',                               expect: true },
  // Original failing user prompt with leading preamble
  {
    label: 'preamble + categorical update',
    message:
      'All of our developers are middleweight, so please update the existing team maturity to be mid-weight developers',
    expect: true,
  },
  // Clause C — goal-target phrasings (lane 20). The live staging leak
  // (scenario 55df6984…, turn fac8dc19…, 2026-07-07): "set a success
  // target OF …" carries no " to ", missed clause A, dispatched to
  // edit_graph, and the edit LLM wrote non-contract fields onto the
  // goal node under a false "Success target … set" receipt. Goal-target
  // registration is add_constraint's contract (the only writer of
  // goal_threshold_raw/_unit/_cap/goal_threshold), so these phrasings
  // must reach the TurnExecutor tool-use path.
  {
    label: 'goal target "of" (live leak, verbatim)',
    message:
      'Set a success target of a 15% cost reduction on the goal Reduce Operating Costs',
    expect: true,
  },
  {
    label: 'goal target "of" without goal name',
    message: 'Set a success target of a 15% cost reduction',
    expect: true,
  },
  {
    label: 'goal target "to" (lane-15 dead-end phrasing)',
    message: 'Set the success target to a 15% increase',
    expect: true,
  },
  { label: 'goal target raise',                 message: 'Raise the success target to 20%',                                expect: true },
  { label: 'goal target update at',             message: 'Update our success target at 90% retention',                     expect: true },
];

const NON_SUPPRESS_CASES: ReadonlyArray<Case> = [
  // A4 deterministic clarification — must reach edit_graph dispatcher
  { label: 'A4 add as a risk',                  message: 'Add team dynamics as a risk',                                    expect: false },
  // Structural intent with NO filler
  { label: 'structural include',                message: 'update the model to include market dynamics',                    expect: false },
  // Structural intent with adverbial fillers (filler-window guard)
  { label: 'structural "to also include"',      message: 'update the model to also include market dynamics',               expect: false },
  { label: 'structural "to better reflect"',    message: 'update the model to better reflect market dynamics',             expect: false },
  { label: 'structural "to just capture"',      message: 'update the model to just capture supply risk',                   expect: false },
  { label: 'structural "to actually incorporate"', message: 'update the model to actually incorporate market dynamics',    expect: false },
  { label: 'structural "to now contain"',       message: 'update the model to now contain churn factor',                   expect: false },
  // Kind change — must reach edit_graph dispatcher
  { label: 'kind change "to a factor"',         message: 'set goal to a factor',                                           expect: false },
  // Kind change with filler ("to be a factor", "to become an outcome") — kind-target filler-window guard
  { label: 'kind change "to be a factor"',      message: 'set goal to be a factor',                                        expect: false },
  { label: 'kind change "to be an outcome"',    message: 'update risk X to be an outcome',                                 expect: false },
  { label: 'kind change "to become a decision"', message: 'update the model to become a decision',                         expect: false },
  { label: 'kind change "to become an option"', message: 'update node X to become an option',                              expect: false },
  { label: 'kind change "to factor" no article', message: 'set X to factor',                                               expect: false },
  // Verbs deliberately excluded from the gate
  { label: 'verb "change" excluded',            message: 'change risk X to outcome',                                       expect: false },
  { label: 'verb "remove" excluded',            message: 'remove salary cost pressure',                                    expect: false },
  { label: 'verb "add" excluded',               message: 'add market competition as a factor',                             expect: false },
  // Edge-strength phrasing — `raise` without `by` is not a value-update
  { label: 'raise X (no by)',                   message: 'raise the strength of the market risk edge',                     expect: false },
  // Existing legacy regression-locks
  { label: 'increase budget to NUMERIC (legacy)', message: 'Increase the budget to 300k',                                  expect: false },
  { label: 'tweak (no by)',                     message: 'Tweak the probability on the regulatory edge slightly',          expect: false },
  // Trivial non-edits
  { label: 'meta question',                     message: 'What about team dynamics?',                                      expect: false },
  { label: 'plain greeting',                    message: 'Hello',                                                          expect: false },
  // Goal-target NON-edits (lane 20) — questions/descriptions about the
  // target carry no gate verb driving the noun, and must not be swept.
  { label: 'goal target question',              message: 'What is our success target?',                                    expect: false },
  { label: 'goal target explain',               message: 'Explain the success target',                                     expect: false },

  // Meta-noun guard — model-quality requests with "the model" / "the
  // graph" / "the diagram" as the verb's object are whole-graph
  // structural changes, never value updates.
  { label: 'meta-noun "the model" + quality',   message: 'update the model to be more realistic',                          expect: false },
  { label: 'meta-noun "the model" + quality',   message: 'update the model to be more complete',                           expect: false },
  { label: 'meta-noun "the model" + represent', message: 'update the model to better represent churn',                     expect: false },
  { label: 'meta-noun "the graph"',             message: 'update the graph to be more accurate',                           expect: false },
  { label: 'meta-noun "the diagram"',           message: 'update the diagram to be cleaner',                               expect: false },
  { label: 'meta-noun "model" no article',      message: 'update model to better reflect market dynamics',                 expect: false },

  // Plural kind targets — same kind-change semantics as singulars; must
  // remain on edit_graph.
  { label: 'plural kind "to be risks"',         message: 'set X to be risks',                                              expect: false },
  { label: 'plural kind "to become options"',   message: 'update nodes to become options',                                 expect: false },
  { label: 'plural kind "to be factors"',       message: 'set the goals to be factors',                                    expect: false },
];

describe('isValueUpdatePhrasing — table-driven gate behaviour', () => {
  describe('cases that MUST suppress edit_graph (route to D1 / Sonnet)', () => {
    for (const c of SUPPRESS_CASES) {
      it(`suppresses: ${c.label} — ${JSON.stringify(c.message)}`, () => {
        expect(isValueUpdatePhrasing(c.message)).toBe(true);
      });
    }
  });

  describe('cases that MUST keep edit_graph dispatch', () => {
    for (const c of NON_SUPPRESS_CASES) {
      it(`keeps:   ${c.label} — ${JSON.stringify(c.message)}`, () => {
        expect(isValueUpdatePhrasing(c.message)).toBe(false);
      });
    }
  });

  describe('predicate exhaustiveness', () => {
    it('returns false for empty string', () => {
      expect(isValueUpdatePhrasing('')).toBe(false);
    });
    it('returns false for whitespace-only', () => {
      expect(isValueUpdatePhrasing('   \n\t  ')).toBe(false);
    });
    it('is case-insensitive', () => {
      expect(isValueUpdatePhrasing('SET CHURN TO 5%')).toBe(true);
      expect(isValueUpdatePhrasing('Set Churn To 5%')).toBe(true);
    });
  });

  describe('__testOnly module-state immutability', () => {
    it('exposes frozen keyword arrays (cannot be mutated by tests)', () => {
      expect(Object.isFrozen(__testOnly)).toBe(true);
      expect(Object.isFrozen(__testOnly.STRUCTURAL_KEYWORDS)).toBe(true);
      expect(Object.isFrozen(__testOnly.KIND_KEYWORDS)).toBe(true);
      expect(Object.isFrozen(__testOnly.META_NOUNS)).toBe(true);
      expect(Object.isFrozen(__testOnly.VALUE_UPDATE_VERBS_TO)).toBe(true);
      expect(Object.isFrozen(__testOnly.VALUE_UPDATE_VERBS_BY)).toBe(true);
    });

    it('mutation attempts on frozen arrays throw or no-op', () => {
      expect(() => {
        // Cast away readonly to attempt the mutation that
        // Object.freeze must reject.
        (__testOnly.STRUCTURAL_KEYWORDS as unknown as string[]).push('hacked');
      }).toThrow();
      expect(__testOnly.STRUCTURAL_KEYWORDS).not.toContain('hacked');
    });
  });
});
