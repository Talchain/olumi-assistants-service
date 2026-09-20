/**
 * Proposing a run.
 *
 * THE TWO THINGS THIS SPEC EXISTS TO PIN
 * ---------------------------------------
 * 1. A run cannot happen without a human yes. The tool is `kind: 'propose'`,
 *    it returns an operation and never an effect, and the loop throws if a
 *    non-propose tool ever stages one.
 * 2. Neither refusal is bare. "Not ready" carries the checker's own open
 *    questions; "already current" names the tool that answers without
 *    spending anything.
 *
 * FIXTURES GO THROUGH THE REAL AUTHORITY
 * ---------------------------------------
 * CLAUDE.md trap 16 — a fixture you wrote yourself is not evidence. Every
 * graph below is fed to the REAL `resolveRunAdmission`, and each test asserts
 * the verdict it depends on BEFORE depending on it (trap 13b: a discriminator
 * must pin its own precondition, or it can pass while discriminating nothing).
 * The injected-authority tests are marked as such and exist only to reach the
 * branch where the module under test, not the checker, is what is being
 * measured.
 *
 * The graph is generic on purpose — the repo is public.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAgentLoop } from '../agent-loop.js';
import {
  RUN_ANALYSIS_ALREADY_CURRENT,
  RUN_ANALYSIS_OPERATION_KIND,
  RUN_ANALYSIS_TOOL_NAME,
  RUN_ANALYSIS_UNSPECIFIED_BLOCKER,
  createRunAnalysisTool,
} from '../run-analysis-tool.js';
import {
  readinessQuestions,
  resolveRunAdmission,
  type ReadinessResult,
  type RunAdmission,
} from '../../tools/handlers/analysis-ready-core.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { AnalysisSnapshot } from '../read-tools.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Graphs, fed through the real authority
// ─────────────────────────────────────────────────────────────────────────────

const DECISION = { id: 'dec_1', kind: 'decision', label: 'Which way' };
const GOAL = { id: 'goal_1', kind: 'goal', label: 'Result', goal_threshold: 0.8 };
const FACTOR = { id: 'fac_1', kind: 'factor', label: 'Unit Cost' };

const edge = (from: string, to: string, mean: number, exists = 0.9) => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: exists,
  effect_direction: 'positive',
});

const option = (id: string, label: string, value?: number) => ({
  id,
  kind: 'option',
  label,
  ...(value === undefined ? {} : { interventions: { fac_1: value } }),
});

const EDGES = [
  edge('dec_1', 'opt_a', 1, 1),
  edge('dec_1', 'opt_b', 1, 1),
  edge('dec_1', 'opt_c', 1, 1),
  edge('opt_a', 'fac_1', 0.6),
  edge('opt_b', 'fac_1', 0.3),
  edge('opt_c', 'fac_1', 0.5),
  edge('fac_1', 'goal_1', 0.6, 1),
];

const graphWith = (values: readonly (number | undefined)[]): GraphStateIngress =>
  ({
    nodes: [
      DECISION,
      GOAL,
      FACTOR,
      option('opt_a', 'Alpha', values[0]),
      option('opt_b', 'Beta', values[1]),
      option('opt_c', 'Gamma', values[2]),
    ],
    edges: EDGES,
  }) as GraphStateIngress;

/** Every option valued — the run proceeds and nothing is held back. */
const GRAPH_COMPLETE = graphWith([0.7, 0.3, 0.5]);
/** ONE option unconfigured — the run proceeds by EXCLUDING it. */
const GRAPH_ONE_UNCONFIGURED = graphWith([0.7, 0.3, undefined]);
/** No option valued — three blockers, so the run is refused with questions. */
const GRAPH_FRESH_DRAFT = graphWith([undefined, undefined, undefined]);

const FRESH: AnalysisSnapshot = { enrichment: { option_comparison: [] }, freshness: 'fresh' };
const STALE: AnalysisSnapshot = { enrichment: { option_comparison: [] }, freshness: 'stale' };
const UNKNOWN: AnalysisSnapshot = { enrichment: { option_comparison: [] }, freshness: 'unknown' };
const NONE: AnalysisSnapshot = { enrichment: { option_comparison: [] }, freshness: 'none' };
const NO_VERDICT: AnalysisSnapshot = { enrichment: { option_comparison: [] }, freshness: null };
const NEVER_RUN: AnalysisSnapshot = { enrichment: null, freshness: 'none' };

function toolFor(
  graph: GraphStateIngress | null,
  analysis: AnalysisSnapshot | null,
  overrides: {
    resolveAdmission?: (g: unknown) => RunAdmission;
    readinessQuestionsFor?: (v: ReadinessResult) => readonly string[];
  } = {},
) {
  return createRunAnalysisTool({
    getGraph: () => graph,
    getAnalysis: () => analysis,
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nothing in this module may reach the network. Not once, not to check a
// shape. `fetch` is replaced with a throwing stub for every test in the file,
// so an engine call would surface as a failure rather than as a slow test.
// ─────────────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let fetchAttempts = 0;

beforeEach(() => {
  fetchAttempts = 0;
  const throwingFetch: typeof fetch = () => {
    fetchAttempts += 1;
    throw new Error('the network was reached');
  };
  globalThis.fetch = throwingFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  expect(fetchAttempts).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the fixtures reproduce the verdicts every test below depends on', () => {
  it('complete / one-unconfigured / fresh-draft give three DIFFERENT admissions', () => {
    const complete = resolveRunAdmission(GRAPH_COMPLETE);
    const partial = resolveRunAdmission(GRAPH_ONE_UNCONFIGURED);
    const draft = resolveRunAdmission(GRAPH_FRESH_DRAFT);

    expect(complete.willProceed).toBe(true);
    expect(complete.plan.will_scaffold_options).toBe(false);

    // The run proceeds AND holds an option back — the state in which
    // `blockedNextStep` and `strict.nextStep` legitimately disagree.
    expect(partial.willProceed).toBe(true);
    expect(partial.plan.will_scaffold_options).toBe(true);
    expect(partial.plan.option_count).toBe(1);
    expect(partial.blockedNextStep).toBeNull();
    expect(partial.strict.nextStep).not.toBeNull();

    expect(draft.willProceed).toBe(false);
    expect(readinessQuestions(draft.strict).length).toBeGreaterThan(1);

    // A probe returning the same answer for every input is reporting on
    // itself (trap 20). These three do not.
    expect(new Set([complete.willProceed, partial.willProceed, draft.willProceed]).size).toBe(2);
    expect(partial.plan.option_count).not.toBe(complete.plan.option_count);
  });
});

describe('it is a proposal, and the proposal is a run and nothing else', () => {
  it('is declared a propose tool, so the loop will not let it take effect', () => {
    expect(toolFor(GRAPH_COMPLETE, NEVER_RUN).kind).toBe('propose');
  });

  it('stages exactly one operation, of kind run_analysis, with no graph mutation in it', async () => {
    const out = await toolFor(GRAPH_COMPLETE, NEVER_RUN).execute({});
    expect(out.type).toBe('proposed');
    if (out.type !== 'proposed') return;
    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toEqual({ kind: RUN_ANALYSIS_OPERATION_KIND });
    // The whole operation. No node id, no value, nothing that could be
    // applied to the graph if the consent path ever handed it to a mutator.
    expect(Object.keys(out.operations[0] ?? {})).toEqual(['kind']);
  });

  it('the agent loop records it as PENDING and tells the model nothing has happened', async () => {
    const tool = toolFor(GRAPH_COMPLETE, NEVER_RUN);
    let seen = '';
    const result = await runAgentLoop(
      { system: '', messages: [{ role: 'user', content: 'run it' }], tools: [tool] },
      {
        chatWithTools: async ({ messages }) => {
          const last = messages[messages.length - 1];
          if (Array.isArray(last?.content)) {
            const block = (last.content as ToolResponseBlock[]).find(
              (b): b is Extract<ToolResponseBlock, { type: 'tool_result' }> =>
                b.type === 'tool_result',
            );
            seen = block?.content ?? '';
            return { content: [{ type: 'text', text: 'offered' }], stop_reason: 'end_turn' };
          }
          return {
            content: [{ type: 'tool_use', id: 't1', name: RUN_ANALYSIS_TOOL_NAME, input: {} }],
            stop_reason: 'tool_use',
          };
        },
      },
    );

    expect(result.proposed).toHaveLength(1);
    expect(result.accepted).toEqual([]);
    expect(seen).toContain('PROPOSED, NOT APPLIED');
    expect(seen).toContain('Nothing has changed in the model');
  });
});

describe('a model that cannot be analysed is refused with the checker\'s own questions', () => {
  it('returns every open question by name, not a count', async () => {
    const expected = readinessQuestions(resolveRunAdmission(GRAPH_FRESH_DRAFT).strict);
    expect(expected.length).toBe(3);

    const out = await toolFor(GRAPH_FRESH_DRAFT, NEVER_RUN).execute({});
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    for (const question of expected) expect(out.content).toContain(question);
    expect(out.content).toContain('CANNOT BE ANALYSED YET');
    // The 2026-08-20 defect in one assertion: the count without the prompts.
    expect(out.content).not.toMatch(/\b3 readiness issues\b/);
  });

  it('tells the model to put them to the user and not to fill the gaps in itself', async () => {
    const out = await toolFor(GRAPH_FRESH_DRAFT, NEVER_RUN).execute({});
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain('Put these to the user');
    expect(out.content).toContain('do not estimate a value');
  });

  it('with no model at all it refuses with the next move, and does not throw', async () => {
    const out = await toolFor(null, NEVER_RUN).execute({});
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    // Measured, not invented: this is what the authority says for a null graph.
    expect(out.content).toContain('Draft or save a model first');
  });

  it('a single-blocker verdict has no question list and still names a next move', async () => {
    // Injected: `blockedNextStep` set, `readinessQuestions` empty. Reached in
    // production by NO_GRAPH, SCHEMA_INVALID and any one-blocker refusal —
    // `repairProposal` is null below two blockers, so there are no prompts to
    // return and the sentence is all there is.
    const out = await toolFor(GRAPH_FRESH_DRAFT, NEVER_RUN, {
      resolveAdmission: () => ({
        ...resolveRunAdmission(GRAPH_FRESH_DRAFT),
        blockedNextStep: 'Give this model a goal, then run analysis.',
      }),
      readinessQuestionsFor: () => [],
    }).execute({});
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain('Give this model a goal, then run analysis.');
    expect(out.content).toContain('Put that to the user');
  });

  it('a blocked verdict with NO sentence at all still refuses with something actionable', async () => {
    // Should be unreachable — the authority derives `blockedNextStep` so a
    // refusal can never be silent. "Unreachable" is a claim about another
    // module, so the degradation is pinned rather than assumed.
    const out = await toolFor(GRAPH_FRESH_DRAFT, NEVER_RUN, {
      resolveAdmission: () => ({
        ...resolveRunAdmission(GRAPH_FRESH_DRAFT),
        blockedNextStep: null,
      }),
      readinessQuestionsFor: () => [],
    }).execute({});
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain(RUN_ANALYSIS_UNSPECIFIED_BLOCKER);
    expect(out.content).not.toMatch(/not ready\.?$/i);
  });
});

describe('an analysis that is already current is refused, and points at the free answer', () => {
  it('refuses rather than spending, and names read_results', async () => {
    const out = await toolFor(GRAPH_COMPLETE, FRESH).execute({});
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toBe(RUN_ANALYSIS_ALREADY_CURRENT);
    expect(out.content).toContain('read_results');
    expect(out.content).toContain('ALREADY CURRENT');
  });

  it('the two refusals are DIFFERENT answers to different questions', async () => {
    const notReady = await toolFor(GRAPH_FRESH_DRAFT, NEVER_RUN).execute({});
    const alreadyFresh = await toolFor(GRAPH_COMPLETE, FRESH).execute({});
    if (notReady.type !== 'refused' || alreadyFresh.type !== 'refused') {
      throw new Error('expected two refusals');
    }
    expect(notReady.content).not.toBe(alreadyFresh.content);
    expect(notReady.content).not.toContain('read_results');
    expect(alreadyFresh.content).not.toContain('CANNOT BE ANALYSED');
  });

  it('a model that cannot be analysed is answered as such EVEN WITH a current analysis', async () => {
    // Ordering, pinned. The bigger fact is that the model is unanalysable;
    // sending the user to read results computed against a model in this state
    // would be the wrong next move.
    const out = await toolFor(GRAPH_FRESH_DRAFT, FRESH).execute({});
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain('CANNOT BE ANALYSED YET');
    expect(out.content).not.toBe(RUN_ANALYSIS_ALREADY_CURRENT);
  });
});

describe('every other currency verdict proposes, and says WHY in its own terms', () => {
  it('no analysis ever run — the reason is that nothing has been computed', async () => {
    const out = await toolFor(GRAPH_COMPLETE, NEVER_RUN).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.summary).toContain('nothing has been computed for this model yet');
    expect(out.content).toContain('NO ANALYSIS HAS EVER BEEN RUN');
    expect(out.content).toContain('never computed');
  });

  it('stale — the model moved, and the old figures are still real measurements', async () => {
    const out = await toolFor(GRAPH_COMPLETE, STALE).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.summary).toContain('pre-date the latest changes');
    expect(out.content).toContain('THE MODEL HAS MOVED');
    expect(out.content).toContain('real measurements');
  });

  it('unknown — unverified, and explicitly NOT "out of date"', async () => {
    const out = await toolFor(GRAPH_COMPLETE, UNKNOWN).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).toContain('CURRENCY COULD NOT BE ESTABLISHED');
    expect(out.content).toContain('not that they are out of date');
  });

  it('none-with-a-payload — reported as the inconsistency it is', async () => {
    const out = await toolFor(GRAPH_COMPLETE, NONE).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).toContain('THE RECORD IS INCONSISTENT');
  });

  it('a caller that wired no verdict at all is treated as unverified, never as current', async () => {
    const out = await toolFor(GRAPH_COMPLETE, NO_VERDICT).execute({});
    expect(out.type).toBe('proposed');
    if (out.type !== 'proposed') return;
    expect(out.content).toContain('CURRENCY COULD NOT BE ESTABLISHED');
  });

  it('the four run reasons are four DIFFERENT sentences', async () => {
    const contents: string[] = [];
    for (const snapshot of [NEVER_RUN, STALE, UNKNOWN, NONE]) {
      const out = await toolFor(GRAPH_COMPLETE, snapshot).execute({});
      if (out.type !== 'proposed') throw new Error('expected a proposal');
      contents.push(out.content ?? '');
    }
    expect(new Set(contents).size).toBe(4);
  });
});

describe('what the user is told before they agree', () => {
  it('discloses that an unconfigured option will not be sent as they left it', async () => {
    const admission = resolveRunAdmission(GRAPH_ONE_UNCONFIGURED);
    expect(admission.plan.option_count).toBe(1);

    const out = await toolFor(GRAPH_ONE_UNCONFIGURED, NEVER_RUN).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).toContain('One option will not be sent exactly as the user left it');
    expect(out.content).toContain('before they agree');
  });

  it('⚠ does NOT render the strict next step while the run is going to proceed', async () => {
    // The manufactured-obligation defect. `strict.nextStep` here is a real
    // sentence about a real gap, and showing it would tell the user to fix
    // something before an analysis that is about to run regardless.
    const strictStep = resolveRunAdmission(GRAPH_ONE_UNCONFIGURED).strict.nextStep;
    expect(strictStep).not.toBeNull();

    const out = await toolFor(GRAPH_ONE_UNCONFIGURED, NEVER_RUN).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).not.toContain(strictStep ?? '');
    expect(out.content).not.toContain('needs a numeric value');
  });

  it('says nothing about exclusions when nothing is being excluded', async () => {
    const out = await toolFor(GRAPH_COMPLETE, NEVER_RUN).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).not.toContain('will not be sent exactly');
  });

  it('a degraded admission claiming an exclusion of ZERO options warns about nothing', async () => {
    // FOUND BY A SURVIVING MUTANT (the `n < 1` floor loosened to `n < 0`), and
    // the finding is a missing test rather than an equivalent mutant.
    //
    // The REAL producer cannot reach this pair: `computeScaffoldPlan` sets
    // `will_scaffold_options = touchedIds.length > 0` and `option_count =
    // touchedIds.length` from the same array, so `true` implies at least one.
    // But `resolveAdmission` is an injected dependency and `plan` is a plain
    // object, so a degraded or future admission can hand over exactly this —
    // and "⚠ 0 options will not be sent exactly as the user left them" is a
    // warning about nothing, which is how a user learns to ignore warnings.
    const real = resolveRunAdmission(GRAPH_COMPLETE);
    expect(real.plan.will_scaffold_options).toBe(false); // the precondition, pinned

    const out = await toolFor(GRAPH_COMPLETE, NEVER_RUN, {
      resolveAdmission: () => ({
        ...real,
        plan: { will_scaffold_options: true, option_count: 0, scaffolded_option_ids: [] },
      }),
    }).execute({});
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).not.toContain('will not be sent exactly');
    expect(out.content).not.toContain('0 options');
  });

  it('never narrates the run as started or done', async () => {
    for (const graph of [GRAPH_COMPLETE, GRAPH_ONE_UNCONFIGURED]) {
      for (const snapshot of [NEVER_RUN, STALE, UNKNOWN, NONE]) {
        const out = await toolFor(graph, snapshot).execute({});
        if (out.type !== 'proposed') throw new Error('expected a proposal');
        expect(out.content).toContain('only the user can turn it into a run');
        expect(out.summary).not.toMatch(/\b(running|started|computed it|done)\b/i);
      }
    }
  });
});

describe('the description is a prompt and carries the rules the model must not break', () => {
  it('says when NOT to reach for it, and that it costs something', () => {
    const d = toolFor(GRAPH_COMPLETE, NEVER_RUN).definition.description;
    expect(d).toContain('Do NOT reach for it to look at results that already exist');
    expect(d).toContain('read_results');
    expect(d).toContain('not free');
    expect(d).toContain('nothing runs until they agree');
    expect(d).toContain('put those questions to the user');
  });

  it('takes no parameters — a run has nothing to choose', () => {
    const schema = toolFor(GRAPH_COMPLETE, NEVER_RUN).definition.input_schema;
    expect(schema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });
});
