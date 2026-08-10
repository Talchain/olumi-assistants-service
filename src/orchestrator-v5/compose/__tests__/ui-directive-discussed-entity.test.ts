/**
 * §2.1 ROW 7 — THE DISCUSSED-ENTITY TAIL. "The workspace follows the
 * conversation."
 *
 * The six shipped rows are each keyed to a handler SIDE EFFECT (an applied
 * mutation, a completed analysis, a flip query, an answered explain). So the
 * assistant can point at what it just CHANGED or COMPUTED, and never at what it
 * is merely TALKING ABOUT. Row 7 closes that: when this turn's composed cards
 * name a graph entity and no side-effect row fired, bring THAT entity into view.
 *
 * ENTITY RESOLUTION ROUTE (the design decision): the directive reuses the
 * entity reference the composed card ALREADY carries (`target_refs[0]`) —
 * a `TargetRef` CEE resolved against the graph node lookup and which has
 * already passed the block's own strict parse. NO prose is parsed here, NO
 * second resolution is performed, and the target therefore CANNOT disagree with
 * the card the user is reading (one derivation, two read points — the same rule
 * ROADMAP 2.211 applies to `selectLens`).
 *
 * Row 7 is a strict TAIL: it is reached only when the N=1 latch is still unset,
 * so it can never displace a side-effect gesture.
 *
 * Positive control (trap-13): every absence assertion below is preceded by
 * proving the emitter CAN see a presence on the same fixture family.
 * Identity binding (trap-19): every target assertion names the id AND the
 * label, never a value predicate another node could satisfy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';

import { composeToolCallResponse } from '../../compose.js';
import { setTestSink } from '../../../utils/telemetry.js';

/**
 * ⚠ WHY ATTRIBUTION IS TELEMETRY-BASED AND NOT BYTE-BASED.
 * Row 2 (lens focus) emits `focus @ <factor>` — BYTE-IDENTICAL to what row 7
 * emits. So an assertion on the block alone CANNOT tell which row authored it,
 * and the first draft of this file proved it the hard way: the row-7 test
 * PASSED at pristine because the fixture accidentally fired the
 * `evpi_evidence_priority` lens and row 2 produced the very bytes row 7 was
 * supposed to produce. The emit telemetry carries the authoring row's
 * `fact_type` tag, so it is the only available discriminator.
 */
const DISCUSSED_ENTITY_TAG = 'discussed_entity';

let sink: Array<{ event: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data: data as Record<string, unknown> }));
});
afterEach(() => setTestSink(null));

function emittedBy(tag: string) {
  return sink.filter(
    (e) => e.event === 'v5.ui_directive.emitted' && e.data.fact_type === tag,
  );
}

function suppressions() {
  return sink.filter((e) => e.event === 'v5.ui_directive.suppressed');
}

const BASE_INPUT = {
  answerKind: 'functional' as const,
  orientation: 'Here is what the analysis says.',
  confirmation: '',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

const GRAPH_HASH = 'gh_discussed_0001';

/**
 * Two factors, two options, one edge. `fac_margin` is the entity the evidence
 * card will discuss; `fac_team` exists so an assertion that binds to
 * `fac_margin` cannot pass on a different factor (the discriminating sibling).
 */
const GRAPH = {
  nodes: [
    { id: 'goal_g', label: 'Launch success', kind: 'goal' },
    { id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' },
    { id: 'fac_team', label: 'Team ramp time', kind: 'factor' },
    { id: 'fac_churn', label: 'Customer churn rate', kind: 'factor' },
    { id: 'opt_x', label: 'Hire locally', kind: 'option' },
    { id: 'opt_y', label: 'Outsource delivery', kind: 'option' },
  ],
  edges: [
    { id: 'edge_mg', from: 'fac_margin', to: 'goal_g', label: 'Gross margin floor → Launch success' },
  ],
};

/**
 * A `decision_review.evidence_enhancements` entry produces an EvidenceBlock
 * whose `target_refs` is resolved STRUCTURALLY (factor id → lookup), not from
 * prose — so this fixture pins row 7 against a structurally-derived ref.
 */
function evidenceEnhancementFor(factorId: string): Record<string, unknown> {
  return {
    evidence_enhancements: {
      [factorId]: {
        specific_action: 'Benchmark against three comparable launches',
        rationale: 'The current estimate rests on a single internal forecast.',
        decision_hygiene: 'A tighter band here changes which option leads.',
        evidence_type: 'benchmark',
      },
    },
  };
}

/**
 * A run_analysis fact. `leadingOptionId: null` drives the ladder to row 3's
 * `no_recommendation` suppression, which is what leaves the N=1 latch unset and
 * lets row 7 be reached. Factor influences are deliberately BALANCED so no lens
 * fires and row 2 cannot claim the turn.
 */
function analysisFact(
  overrides: {
    leadingOptionId?: string | null;
    mayNameLeadingOption?: boolean;
    evidenceFactorId?: string | null;
  } = {},
): HandlerFact {
  const evidenceFactorId =
    overrides.evidenceFactorId === undefined ? 'fac_margin' : overrides.evidenceFactorId;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-discussed',
      leading_option_id:
        overrides.leadingOptionId === undefined ? null : overrides.leadingOptionId,
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'strong',
        __cee_claim_safety: {
          may_name_leading_option: overrides.mayNameLeadingOption ?? true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        // Three balanced factors, all HIGH confidence — no single one exceeds
        // the dominance share and nothing looks shaky, so NO lens fires. This
        // exact shape is the repo's proven no-lens fixture
        // (ui-directive-focus.test.ts::healthyFact). ⚠ The confidences are
        // load-bearing: an earlier draft of this fixture used 0.2 on
        // fac_margin, which FIRED A LENS and made row 2 emit
        // `focus @ fac_margin` — byte-identical to what row 7 emits, so the
        // row-7 assertion passed at pristine while measuring row 2. The
        // no-lens precondition is pinned explicitly below.
        factor_sensitivity: [
          { factor_id: 'fac_margin', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_team', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_churn', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.51 }, { win_probability: 0.49 }],
        ...(evidenceFactorId === null ? {} : { decision_review: evidenceEnhancementFor(evidenceFactorId) }),
      },
    },
  } as unknown as HandlerFact;
}

function compose(fact: HandlerFact) {
  return composeToolCallResponse({
    ...BASE_INPUT,
    handlerFacts: [fact],
    persistedGraph: GRAPH,
    persistedGraphHash: GRAPH_HASH,
  });
}

function directives(env: ReturnType<typeof composeToolCallResponse>) {
  return env.blocks.filter((b) => b.type === 'ui_directive') as ReadonlyArray<
    Extract<(typeof env.blocks)[number], { type: 'ui_directive' }>
  >;
}

function blocksWithRefs(env: ReturnType<typeof composeToolCallResponse>) {
  return env.blocks.filter(
    (b) => Array.isArray((b as { target_refs?: unknown }).target_refs) &&
      ((b as { target_refs: unknown[] }).target_refs.length > 0),
  );
}

describe('row 7 — the workspace follows the conversation', () => {
  it('PRECONDITION PIN: the six side-effect rows all decline this turn, so row 7 is the only possible author', () => {
    // Pins the precondition IN-TEST rather than assuming it (trap 13b's third
    // face): if a future change makes a side-effect row claim this fixture, the
    // row-7 assertions below must fail LOUDLY instead of silently measuring the
    // other row's gesture.
    const env = compose(analysisFact());
    expect(emittedBy('run_analysis')).toHaveLength(0);
    expect(directives(env)).toHaveLength(1);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
  });

  it('POSITIVE CONTROL: the suppressed-ladder fixture really does compose a card that names fac_margin', () => {
    // Without this, every row-7 assertion below could pass or fail for reasons
    // that have nothing to do with the directive ladder.
    const env = compose(analysisFact());
    const withRefs = blocksWithRefs(env);
    expect(withRefs.length).toBeGreaterThan(0);
    const allRefs = withRefs.flatMap(
      (b) => (b as unknown as { target_refs: Array<{ id: string; label: string }> }).target_refs,
    );
    expect(allRefs).toContainEqual({
      id: 'fac_margin',
      label: 'Gross margin floor',
      kind: 'factor',
    });
  });

  it('emits focus @ the entity the card discusses when no side-effect row fired', () => {
    const env = compose(analysisFact());
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      type: 'ui_directive',
      verb: 'focus',
      // Bound by IDENTITY (id + label), not by a value predicate fac_team
      // or fac_churn could also satisfy.
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
    expect(UiDirectiveBlockSchema.safeParse(ds[0]).success).toBe(true);
    // Attribution — these bytes were authored by row 7, not by row 2.
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
  });

  it('stamps source=ladder so a capture can tell a deterministic gesture from an LLM-proposed one', () => {
    const env = compose(analysisFact());
    expect(directives(env)[0]).toMatchObject({ source: 'ladder' });
  });

  it('N=1 — a side-effect gesture still wins; row 7 never displaces it', () => {
    // Same fixture, but a real leading option: row 3's highlight fires and the
    // latch closes BEFORE row 7 is reached.
    const env = compose(analysisFact({ leadingOptionId: 'opt_x' }));
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    // The side-effect row authored it, and row 7 emitted NOTHING — the latch
    // held. This is the no-double-emit guarantee, asserted by authorship rather
    // than by count alone (a count of 1 is also consistent with row 7 having
    // displaced the side-effect row, which is the failure this pins).
    expect(emittedBy('run_analysis')).toHaveLength(1);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(0);
  });

  it('the withheld-claim gate still bites — row 7 never points at an option the turn may not name', () => {
    // Withheld verdict AND the only discussable entity is an OPTION.
    const env = compose(
      analysisFact({
        leadingOptionId: 'opt_x',
        mayNameLeadingOption: false,
        evidenceFactorId: null,
      }),
    );
    const ds = directives(env);
    for (const d of ds) {
      for (const t of d.targets) {
        expect(t.kind).not.toBe('option');
      }
    }
  });

  it('suppresses rather than pointing at nothing when no card names an entity — with a closed reason tag', () => {
    const env = compose(analysisFact({ evidenceFactorId: null }));
    expect(directives(env)).toHaveLength(0);
    // A directive that silently does not fire is the broken-alarm class. The
    // drop must be observable and reason-tagged.
    const dropped = suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].data.reason).toBe('no_discussed_entity');
  });
});
