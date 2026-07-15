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

  // Clause D — constraint phrasings (add_constraint dead-letter fix).
  // PR #464 shipped an honest refusal for value-edits on non-factor nodes
  // whose closing sentence promises "ask me to add a constraint on it" and
  // renders a `chip_prompt_refuse_constraint` chip replaying
  // "Add a constraint on <label>." That text hit EDIT_GRAPH_POSITIVE_REGEX
  // via `add`, was NOT caught by any clause here (`add` is excluded from
  // clauses A/B as structural), dispatched to the V4 edit_graph LLM — which
  // has NO constraint operation — and no-opped into the
  // buildEditClarifyFallbackParts clarifier. Live-proven: 3 probes, 0 blocks,
  // exit_path edit_graph, no constraint EVER added, INCLUDING a fully
  // specified probe (so under-specification was never the cause).
  // `add_constraint` is registered (registry.ts) and the router tool-schema
  // teaches it, so these phrasings MUST reach the TurnExecutor tool-use path.
  {
    label: 'constraint — the refusal chip verbatim (under-specified)',
    message: 'Add a constraint on Key Talent Attrition.',
    expect: true,
  },
  {
    label: 'constraint — fully specified (live probe 2, verbatim)',
    message: 'Add a constraint on Key Talent Attrition of at most 0.5.',
    expect: true,
  },
  {
    label: 'constraint on a factor (live probe 3, verbatim)',
    message: 'Add a constraint on Office Rent Cost of at most 0.5.',
    expect: true,
  },
  { label: 'constraint — bare add',             message: 'Add a constraint',                                               expect: true },
  { label: 'constraint — plural',               message: 'Add constraints on Office Rent Cost',                            expect: true },
  { label: 'constraint — "put a constraint"',   message: 'Put a constraint on the cost factor',                            expect: true },
  { label: 'constraint — "apply a constraint"', message: 'Apply a constraint to Key Talent Attrition below 0.5',           expect: true },
  { label: 'constraint — "place a constraint"', message: 'Place a hard constraint on headcount',                           expect: true },
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

  // Clause D negatives — the constraint clause must stay NARROW.
  // The clause requires a constraint-INTENT verb driving the noun within a
  // tight window. Removal is NOT add_constraint's contract (the handler
  // only adds), so `remove`/`delete` MUST stay on the edit_graph route —
  // routing them to TurnExecutor would trade one dead end for another.
  { label: 'constraint removal stays on edit_graph',   message: 'Remove the constraint on Office Rent Cost',               expect: false },
  { label: 'constraint deletion stays on edit_graph',  message: 'Delete the constraint on churn',                          expect: false },
  // `set` is EXCLUDED from clause D and this row is the lock.
  // Suppressing edit_graph sends the message to TurnExecutor, whose first
  // stop is the deterministic value-update pre-route. That module's
  // EDIT_VERB_PATTERN contains `set` but NOT `add` (measured), and the
  // module has no notion of "constraint"/"at most" — so a suppressed
  // "Set a constraint on churn of at most 5%" would satisfy its
  // verb + quantity + factor-candidate predicates and silently set
  // churn's VALUE to 5% instead of registering a 5% CEILING. A wrong
  // mutation is strictly worse than the dead end clause D fixes. Keeping
  // this false leaves the phrasing exactly where it is today.
  // Re-admitting `set` REQUIRES teaching the deterministic pre-route to
  // stand down on constraint phrasings first — if you flip this row,
  // that work is your precondition, not an afterthought.
  { label: '"set a constraint" excluded (deterministic pre-route collision)', message: 'Set a constraint on churn of at most 5%', expect: false },
  // Questions / descriptions about constraints carry no constraint-intent
  // verb driving the noun and must not be swept into the gate.
  { label: 'constraint question',               message: 'What constraints do I have?',                                    expect: false },
  { label: 'constraint explain',                message: 'Explain the constraint on churn',                                expect: false },
  { label: 'constraint describe',               message: 'Describe the constraints in my model',                           expect: false },
  // Distant co-occurrence — the noun is not the verb's object. The tight
  // token window keeps these out (mirrors clause C's rationale).
  {
    label: 'constraint distant co-occurrence',
    message: 'Update the model and then tell me how you would describe the constraint',
    expect: false,
  },
  // Structural `add` requests WITHOUT the constraint noun must be
  // untouched — these are add_node territory and are pinned by
  // route-v2-edit-lifecycle test #5.
  { label: 'add risk (structural, unchanged)',  message: 'Add a risk for coordination overhead',                           expect: false },
  { label: 'add factor (structural, unchanged)', message: 'add market competition as a factor',                            expect: false },
  // Structural `add_node` requests that merely CONTAIN "constraint" as
  // part of the new node's NAME. Clause D requires the constraint noun to
  // be the verb's DIRECT OBJECT precisely so these are not stolen from
  // edit_graph: a first-draft clause D using clause C's looser
  // `(?:\s+\S+){0,4}?` token window matched BOTH of these (measured), which
  // would have silently broken structural add_node for any node whose label
  // ends in "constraint". Locked here so a future widening fails loudly.
  { label: 'add factor NAMED "...constraint"',  message: 'Add a factor for budget constraint',                             expect: false },
  { label: 'add risk NAMED "...constraint"',    message: 'Add a risk called supply constraint',                            expect: false },
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
