/**
 * ⭐⭐ THE SECOND FUTILE REMEDY — a repair step the product PROVED cannot work.
 *
 * ── THE DEFECT, MEASURED ON A REAL SESSION ────────────────────────────────
 * Paul's 19 Sep session (scenario `34678f42`, build `c5e1060`, 9 turns). The
 * brief stated a limit on net revenue retention. The product replied, verbatim:
 *
 *   "One limit on your model could not be checked: "Keep revenue retention rate
 *    at or above 110%". From your brief: "revenue retention rate above 110%".
 *    We could not line it up with anything this analysis measures, so it was
 *    not part of the comparison. **Tell me the limit you meant in your own
 *    words and I will record it; this one stays on the model. Then run the
 *    analysis again.**"
 *
 * He did exactly that. Measured on the following turn: `graph_hash`
 * **UNCHANGED**, **ZERO** `graph_patch` blocks, win probabilities
 * **BYTE-IDENTICAL**, and the same warning repeated.
 *
 * ── WHY IT IS IMPOSSIBLE, NOT MERELY BROKEN ───────────────────────────────
 * The limit's target is a DERIVED node — the goal, with 5 incoming edges. PLoT
 * resolves a constraint's sample frame in `resolveConstraintSampleFrameAnchor`
 * and returns `null` for any node with a directed incoming edge, BEFORE it ever
 * reads `observed_state`. So no restatement of the LIMIT, in any words, with
 * any number, can anchor that target. PLoT now says so itself, in the sibling
 * sentence shipped as plot-lite-service #364 (merged 18 Sep):
 *
 *   "Setting a current value ... would not change that — it is calculated from
 *    its inputs, so it has no measured starting point of its own to anchor to."
 *
 * This file is that fix's CEE twin. It changes NOTHING about the withholding:
 * `may_name_leading_option` is asserted unchanged in every arm below, because
 * the withholding is correct and the estate has un-fixed trust-spine board #1
 * once already by relaxing it (release blocker r1225-constraint-regression).
 * Only the REPAIR SENTENCE moves, and only where the target is PROVED
 * unanchorable.
 *
 * ⚠ WHAT THIS FILE PROVES. It EXECUTES the real `run_analysis` handler against
 * a mock PLoT envelope and a mock scenario reader, and reads the RENDERED
 * summary off the persisted fact — the bytes a user sees, not a field. Status
 * ladder rung TESTED. Not a wire witness and not a journey witness.
 *
 * ⭐ THE OPPOSITE-DIRECTION TWIN IS LOAD-BEARING (CLAUDE.md trap 22b). Closing
 * this gap by suppressing the advice everywhere would be the failure mode, not
 * the fix: on a ROOT target a restatement genuinely can land — that is the
 * inverted-operator case `UNEVALUATED_REPAIR_STEP`'s own docstring was written
 * for ("churn could rise above 3%" minted as a floor). Arm B asserts the old
 * advice SURVIVES there, is GREEN at pristine, and must stay green. Arm C
 * asserts both in ONE run, which is the only form that proves the
 * discrimination is per-NODE rather than per-request.
 *
 * ⛔ SUPERSEDED IN ONE RESPECT, 25 Sep 2026 (independent review #69
 * 5831708206, adopted by AI Quality 5831722994). Arm B's envelope reaches
 * `unevaluated` by rule 3 with `codes: []`, and on that shape the inputs cannot
 * tell a root target that restating would repair from one it would not (the
 * agent-lane frame refusal arrives identically, #69 5831686178). The agreed rule
 * fails closed: NO row gets the restate-and-rerun promise unless a producer
 * proves it lands, accepting the lost advice. So Arm B no longer asserts the
 * advice survives. What still discriminates per NODE, and is still asserted in
 * Arms B–D, is the CAUSE: only a PROVED-derived target is told it is "worked
 * out from other parts"; the root target gets the neutral unknown-cause arm.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const happyFixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-unanchored-constraint-remedy';

/**
 * ⭐ THE SENTENCE UNDER TEST, quoted from the 19 Sep session rather than
 * re-typed from the source, so this file pins what the USER received.
 */
const FUTILE_REMEDY = 'Tell me the limit you meant in your own words and I will record it';
/**
 * The sibling voice's ask, which this arm first reused. A served probe (25 Sep, `e39f6e0`, #63
 * 5825511095) showed it cannot land here: the limit already sits on the derived target the user
 * would name, and the re-run stayed unchecked in both standard journeys. So this arm must NOT say it.
 */
const REPOINT_ASK = 'Tell me which part of your model it applies to and I will record it there';
/**
 * The honest verdict (RC ruling #63 5825683899): this limit cannot be checked in this model yet, for a
 * reason in the user's terms. Nothing the user can say from here changes that, so nothing is asked.
 */
const CANNOT_CHECK = 'Olumi cannot yet test a limit on a quantity like that, so it cannot be checked in this model yet';
/**
 * Every invitation measured or proved a dead end on this arm: "which part" (served, 2/2), "a starting
 * level / its value today" (PLoT never reads a level on a non-root; served, the saved level did not
 * help), "run again", and the delta frame (cannot be recorded yet; RC: post-PoC).
 */
const INVITATION = /which part|starting level|value today|run the analysis again|tell me|what the options add/i;
/**
 * 25 Sep 2026 — the UNKNOWN-CAUSE arm (independent review #69 5831708206):
 * what an unproved `codes: []` row now gets, singular and plural. It asserts no
 * cause and promises no repair.
 */
const UNKNOWN_CAUSE_ARM =
  'This model could not check it yet, so it was not part of the comparison. It stays on the model.';
const UNKNOWN_CAUSE_ARM_PLURAL =
  'This model could not check them yet, so they were not part of the comparison. They stay on the model.';

/** The limit, at the label and the brief span the session actually carried. */
const CONSTRAINT_ID = 'constraint_goal_nrr_min';
const CONSTRAINT_LABEL = 'Keep revenue retention rate at or above 110%';
const SOURCE_QUOTE = 'revenue retention rate above 110%';
const BRIEF_TEXT =
  'We are at £3M ARR across 200 customers and want to keep our revenue retention rate above 110% ' +
  'while holding churn under 4% with 20 engineers and 18 months of runway.';

/** ARM A — the DERIVED target: the goal node, fed by other nodes. */
const DERIVED_GOAL_ID = 'goal_nrr';
/** ARM B — the ROOT target: carries a value and nothing feeds it. */
const ROOT_TARGET_ID = 'fac_nrr_today';

function goalConstraint(nodeId: string) {
  return {
    constraint_id: CONSTRAINT_ID,
    node_id: nodeId,
    operator: '>=',
    value: 110,
    label: CONSTRAINT_LABEL,
    unit: '%',
    provenance: 'explicit',
    source_quote: SOURCE_QUOTE,
  };
}

/**
 * ARM A. The goal carries no `observed_state` and is fed by FIVE nodes, the
 * shape the session exported. Every feeding node is a kind PLoT keeps (factor /
 * outcome / risk); an `option` or `decision` edge is stripped before the engine
 * and cannot un-root anything, which is why none is used here.
 */
const DERIVED_TARGET_GRAPH = {
  nodes: [
    { id: DERIVED_GOAL_ID, kind: 'goal', label: 'Net Revenue Retention' },
    { id: 'fac_expansion', kind: 'factor', label: 'Expansion Revenue', observed_state: 0.4 },
    { id: 'fac_churn', kind: 'factor', label: 'Churn Rate', observed_state: 0.04 },
    { id: 'fac_pricing', kind: 'factor', label: 'Pricing Uplift', observed_state: 0.1 },
    { id: 'out_retention', kind: 'outcome', label: 'Retained Revenue' },
    { id: 'risk_downgrade', kind: 'risk', label: 'Downgrade Risk' },
  ],
  edges: [
    { from: 'fac_expansion', to: DERIVED_GOAL_ID },
    { from: 'fac_churn', to: DERIVED_GOAL_ID },
    { from: 'fac_pricing', to: DERIVED_GOAL_ID },
    { from: 'out_retention', to: DERIVED_GOAL_ID },
    { from: 'risk_downgrade', to: DERIVED_GOAL_ID },
  ],
  goal_constraints: [goalConstraint(DERIVED_GOAL_ID)],
};

/**
 * ARM B (CONTROL). Same limit, same producer refusal, but the target is a ROOT
 * factor carrying a measured level. PLoT's anchor resolution reaches its
 * `root_observed_level` limb here, so a restatement is NOT provably inert and
 * the existing advice must survive untouched.
 */
const ROOT_TARGET_GRAPH = {
  nodes: [
    { id: DERIVED_GOAL_ID, kind: 'goal', label: 'Net Revenue Retention' },
    { id: ROOT_TARGET_ID, kind: 'factor', label: 'Revenue Retention Today', observed_state: 1.05 },
  ],
  edges: [{ from: ROOT_TARGET_ID, to: DERIVED_GOAL_ID }],
  goal_constraints: [goalConstraint(ROOT_TARGET_ID)],
};

/** A second limit, on the ROOT factor, for the mixed-set arm. */
const SECOND_CONSTRAINT_ID = 'constraint_root_nrr_min';
const SECOND_CONSTRAINT_LABEL = 'Keep churn under 4%';

/**
 * ARM D. One limit on the DERIVED goal and one on the ROOT factor, both
 * unscored, so the unevaluated voice names both in a single sentence.
 */
const MIXED_TARGET_GRAPH = {
  nodes: [
    { id: DERIVED_GOAL_ID, kind: 'goal', label: 'Net Revenue Retention' },
    { id: ROOT_TARGET_ID, kind: 'factor', label: 'Revenue Retention Today', observed_state: 1.05 },
  ],
  edges: [{ from: ROOT_TARGET_ID, to: DERIVED_GOAL_ID }],
  goal_constraints: [
    goalConstraint(DERIVED_GOAL_ID),
    {
      ...goalConstraint(ROOT_TARGET_ID),
      constraint_id: SECOND_CONSTRAINT_ID,
      label: SECOND_CONSTRAINT_LABEL,
    },
  ],
};

function makeScenarioSnapshot(graph: Record<string, unknown>): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_pricing: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_pricing: 0.9 } },
    ],
    goal_node_id: DERIVED_GOAL_ID,
    rawPersistedGraph: graph,
    briefText: BRIEF_TEXT,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function makeScenarioReader(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return vi.fn<ScenarioReader>(() => Promise.resolve(snapshot));
}

function makePlotClient(response: Record<string, unknown>): PLoTClient {
  const run = vi.fn<
    (
      payload: Record<string, unknown>,
      requestId: string,
      opts?: PLoTClientRunOpts,
    ) => Promise<V2RunResponseEnvelope>
  >(() => Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope));
  const validatePatch = vi.fn().mockResolvedValue({});
  return { run, validatePatch } as unknown as PLoTClient;
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: DERIVED_GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: BRIEF_TEXT,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as unknown as HandlerInvocation;
}

/**
 * The 19 Sep envelope shape: the engine warns `CONSTRAINT_NOT_CONVERTIBLE` —
 * a code CEE's not-decision-grade set does NOT contain — and scores no
 * constraint at all. That reaches `unevaluated` by precedence rule 3, which is
 * the route the session took, not the rule-1 code route already pinned by
 * `run-analysis-derived-constraint-target.test.ts`.
 */
function notConvertibleEnvelope(): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>),
    inference_warnings: [
      {
        code: 'CONSTRAINT_NOT_CONVERTIBLE',
        message:
          "A 'level' frame requires constraint target node to carry observed_state.baseline to " +
          "convert the level into the samples' frame, but it carries no observed_state at all.",
        severity: 'warning',
      },
    ],
  };
}

async function runSummary(graph: Record<string, unknown>): Promise<{
  summary: string;
  constraint_verdict_state: unknown;
  may_name_leading_option: unknown;
}> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(notConvertibleEnvelope()),
    scenarioReader: makeScenarioReader(makeScenarioSnapshot(graph)),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const verdict = fact.result.constraint_verdict as
    | { may_name_leading_option?: unknown; constraint_verdict_state?: unknown }
    | undefined;
  if (verdict === undefined) throw new Error('no constraint_verdict on the fact');
  return {
    summary: fact.result.summary,
    constraint_verdict_state: verdict.constraint_verdict_state,
    may_name_leading_option: verdict.may_name_leading_option,
  };
}

describe('a limit on an UNANCHORABLE target is not told to restate itself', () => {
  it('PRECONDITION: both arms reach the same verdict state, so the arms differ only by TARGET', async () => {
    // ⭐ PINS ITS OWN PRECONDITION (CLAUDE.md trap 13b). Without this, an arm
    // that silently stopped reaching `unevaluated` would pass its absence
    // assertion by disclosing nothing at all.
    const derived = await runSummary(DERIVED_TARGET_GRAPH);
    const root = await runSummary(ROOT_TARGET_GRAPH);

    expect(derived.constraint_verdict_state).toBe('unevaluated');
    expect(root.constraint_verdict_state).toBe('unevaluated');
    // The limit IS disclosed in both arms, by the label the user ratified.
    expect(derived.summary).toContain(CONSTRAINT_LABEL);
    expect(root.summary).toContain(CONSTRAINT_LABEL);
  });

  it('ARM A: a DERIVED target is not handed the restate-the-limit remedy', async () => {
    const v = await runSummary(DERIVED_TARGET_GRAPH);

    expect(v.summary).not.toContain(FUTILE_REMEDY);
  });

  it('ARM A: it is told WHY, and that it cannot be checked yet — and it is invited to do nothing that cannot land', async () => {
    const v = await runSummary(DERIVED_TARGET_GRAPH);

    // The cause, in the product's own register: the target is computed.
    expect(v.summary).toContain('worked out from other parts');
    // The verdict, plainly: it cannot be checked in this model yet.
    expect(v.summary).toContain(CANNOT_CHECK);
    // And it invites nothing: every ask here was measured or proved a dead end.
    expect(v.summary).not.toMatch(INVITATION);
    expect(v.summary).not.toContain(REPOINT_ASK);
    // And the residual is still disclosed: the bad row is not silently removed.
    expect(v.summary).toContain('this one stays on the model');
  });

  it('ARM A: the WITHHOLDING is unchanged — this fix moves copy, never the verdict', async () => {
    const v = await runSummary(DERIVED_TARGET_GRAPH);

    // Bound by identity to the persisted contract field. r1225 un-fixed
    // trust-spine board #1 by relaxing exactly this; nothing here may.
    expect(v.may_name_leading_option).toBe(false);
    expect(v.summary).not.toContain('scored highest against your goal in');
  });

  it('ARM B (OPPOSITE-DIRECTION TWIN): a ROOT target is NOT given the derived-target cause', async () => {
    // Was "KEEPS the restate-the-limit remedy" until 25 Sep 2026. The agreed
    // fail-closed rule (#69 5831708206) drops that promise for every `codes: []`
    // row, root target included, because nothing proves it lands here either.
    // The twin still guards the per-NODE discrimination: the unanchored CAUSE
    // is spoken only on proof, so a root target must not receive it.
    const v = await runSummary(ROOT_TARGET_GRAPH);

    expect(v.summary).not.toContain('worked out from other parts');
    expect(v.summary).toContain(UNKNOWN_CAUSE_ARM);
    expect(v.summary).not.toContain(FUTILE_REMEDY);
    expect(v.may_name_leading_option).toBe(false);
  });

  it('ARM D (MIXED SET): one derived limit beside one repairable limit keeps the CONSERVATIVE sentence', async () => {
    // ⚠ REACHABLE, not hypothetical: the 19 Sep brief stated six limits and the
    // unevaluated voice names up to three of them in ONE sentence. "restating
    // the limit cannot give it one" would be FALSE of the root-target sibling,
    // and this disclosure speaks about every limit it names at once. So the
    // unanchored arm is taken only when the claim holds for the WHOLE set.
    const v = await runSummary(MIXED_TARGET_GRAPH);

    expect(v.constraint_verdict_state).toBe('unevaluated');
    // Both limits are named, so the sentence is about both.
    expect(v.summary).toContain(CONSTRAINT_LABEL);
    expect(v.summary).toContain(SECOND_CONSTRAINT_LABEL);
    // ...and therefore the claim that no restatement can help must NOT be made.
    expect(v.summary).not.toContain('worked out from other parts');
    // 25 Sep 2026: the conservative sentence is the unknown-cause arm, which
    // promises nothing (#69 5831708206).
    expect(v.summary).toContain(UNKNOWN_CAUSE_ARM_PLURAL);
    expect(v.summary).not.toContain(FUTILE_REMEDY);
  });

  it('ARM C: both arms in ONE run — the discrimination is per-NODE, not per-request', async () => {
    const derived = await runSummary(DERIVED_TARGET_GRAPH);
    const root = await runSummary(ROOT_TARGET_GRAPH);

    expect(derived.summary).not.toContain(FUTILE_REMEDY);
    expect(root.summary).not.toContain(FUTILE_REMEDY);
    // Per-NODE, bound to each arm's own sentence (25 Sep 2026).
    expect(derived.summary).toContain(CANNOT_CHECK);
    expect(derived.summary).not.toContain(UNKNOWN_CAUSE_ARM);
    expect(root.summary).toContain(UNKNOWN_CAUSE_ARM);
    expect(root.summary).not.toContain(CANNOT_CHECK);
    // The two summaries must genuinely differ; identical output for different
    // inputs is evidence about the harness, not the product (trap 20).
    expect(derived.summary).not.toBe(root.summary);
  });
});
