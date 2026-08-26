/**
 * A REFUSAL THAT NAMES THE MODEL BUT NOT THE REPAIR IS STILL NOT ACTIONABLE.
 *
 * ## What was already true, and what was still missing
 *
 * The sibling change made the refusal name the model (`goal_node_id`,
 * `options`). That answers *"what is being refused?"*. It does not answer
 * *"what do I do about it?"* — for which the only thing crossing was
 * `nextStep`, which on a four-blocker draft reads **"Review all 4 readiness
 * issues together before analysis"**: a COUNT, offered where four fully
 * authored routes were already in hand.
 *
 * ## The sentences already exist — nothing is composed here
 *
 * `buildAnalysisReadyPayload` (the semantic projector) mints `blockers[]` at
 * the same moment as the identity, one row per option × factor:
 *
 *     { option_id, option_label, factor_id, factor_label,
 *       blocker_type: 'missing_value', suggested_action: 'add_value',
 *       message: 'Factor "Annual CRM Licence Cost" is currently 0.4.
 *                 What should option "Move to HubSpot" set it to?' }
 *
 * `projectCanonicalPayloadToWire` carries them verbatim onto
 * `analysis_ready.blockers`, and `buildAnalysisRefusalReadiness` then dropped
 * them. This restores the carry. **A second renderer of the same fact is the
 * mirror defect this module exists to prevent**, so these specs assert the
 * carried rows are the PRODUCER'S OWN, byte for byte — not merely
 * well-formed.
 *
 * ## What the drop cost downstream
 *
 * `compose/analysis-state-v1.ts:493` calls
 * `mapWireBlockers(input.readiness?.blockers)`, and `mapWireBlockers(undefined)`
 * returns `[]` — which is why `analysis_state.run_state.blockers` was empty.
 * `chip-click-dispatch.ts:709-714` already records that as ONE defect with the
 * missing identity, not two.
 *
 * ## The opposite-direction twins
 *
 * Carrying a repair route must never become manufacturing one. Pinned below:
 * the admitting case and the `ready` case stay bare (#1126's measured class);
 * a refusal whose producer has NO blockers emits **no `blockers` key at all**,
 * never an empty array standing in for "nothing specific to name".
 */

import { describe, it, expect } from 'vitest';

import {
  buildAnalysisRefusalReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../analysis-ready-helper.js';

const v3Edge = (id: string, from: string, to: string) => ({
  id, from, to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

/** Three options, none valued; two factors. Six option×factor edges → real pairs. */
const FRESH_DRAFT = {
  version: '1',
  nodes: [
    { id: 'dec_crm', kind: 'decision', label: 'CRM decision' },
    { id: 'goal_revenue', kind: 'goal', label: 'Annual recurring revenue', goal_threshold: 0.8 },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost', category: 'controllable', observed_state: { value: 0.4, cap: 1 } },
    { id: 'fac_ramp', kind: 'factor', label: 'Sales Ramp Time', category: 'controllable', observed_state: { value: 0.6, cap: 1 } },
    { id: 'opt_hubspot', kind: 'option', label: 'Move to HubSpot' },
    { id: 'opt_stay', kind: 'option', label: 'Stay as we are' },
    { id: 'opt_migrate', kind: 'option', label: 'Migrate to Salesforce' },
  ],
  edges: [
    v3Edge('e1', 'dec_crm', 'opt_hubspot'), v3Edge('e2', 'dec_crm', 'opt_stay'), v3Edge('e3', 'dec_crm', 'opt_migrate'),
    v3Edge('e4', 'opt_hubspot', 'fac_licence'), v3Edge('e5', 'opt_stay', 'fac_licence'), v3Edge('e6', 'opt_migrate', 'fac_licence'),
    v3Edge('e7', 'opt_hubspot', 'fac_ramp'),
    v3Edge('e8', 'fac_licence', 'goal_revenue'), v3Edge('e9', 'fac_ramp', 'goal_revenue'),
  ],
};

/**
 * THE PAIRS THE GRAPH ACTUALLY HAS — derived from its edges by hand, so the
 * assertion below is bound to the MODEL rather than to whatever the producer
 * happened to emit. A test that compared the carrier against the producer alone
 * would agree with the producer even if the producer were wrong.
 */
const EXPECTED_PAIRS = [
  'opt_hubspot::fac_licence',
  'opt_hubspot::fac_ramp',
  'opt_migrate::fac_licence',
  'opt_stay::fac_licence',
];

/** Every option valued: the run ADMITS (#1126 class B). */
const CONFIGURED = {
  ...FRESH_DRAFT,
  nodes: FRESH_DRAFT.nodes.map((n) =>
    (n as { kind?: string }).kind === 'option'
      ? { ...n, interventions: { fac_licence: 0.3, fac_ramp: 0.5 } }
      : n,
  ),
};

type Blocker = {
  option_id?: string;
  option_label?: string;
  factor_id: string;
  factor_label: string;
  blocker_type: string;
  message: string;
  suggested_action: string;
};

function pairsOf(blockers: readonly Blocker[] | undefined): string[] {
  return [...(blockers ?? [])].map((b) => `${b.option_id ?? ''}::${b.factor_id}`).sort();
}

describe('the analyse refusal carries the repair route its producer already wrote', () => {
  // ── RED — the carry ─────────────────────────────────────────────────────
  it('RED-1: a blocked refusal carries NON-EMPTY blockers naming the graph\'s actual unvalued option x factor pairs', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT);
    // Precondition pinned in-test: the producer HAS blockers, so a pass below
    // cannot come from the producer having none (CLAUDE.md trap 13b).
    expect((wire as { blockers?: Blocker[] } | undefined)?.blockers?.length).toBe(
      EXPECTED_PAIRS.length,
    );

    const carrier = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', wire) as {
      blockers?: Blocker[];
    };

    expect(carrier.blockers).toBeDefined();
    expect(carrier.blockers?.length).toBeGreaterThan(0);
    // Bound by IDENTITY to the graph's own pairs — never by count, and never by
    // "some blocker exists", which a completely different defect would satisfy.
    expect(pairsOf(carrier.blockers)).toEqual(EXPECTED_PAIRS);
  });

  it('RED-2: the carried rows are the PRODUCER\'S OWN sentences, byte for byte — nothing is composed here', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT);
    const producer = (wire as { blockers?: Blocker[] } | undefined)?.blockers;
    const carrier = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', wire) as {
      blockers?: Blocker[];
    };

    expect(JSON.stringify(carrier.blockers)).toBe(JSON.stringify(producer));
    // And they are genuinely actionable: each names its option, its factor and
    // an action. Asserted on the OBJECT, so a re-worded producer stays valid.
    for (const b of carrier.blockers ?? []) {
      expect(b.message).toContain(b.factor_label);
      expect(b.message).toContain(b.option_label ?? '');
      expect(b.suggested_action).toBe('add_value');
      expect(b.blocker_type).toBe('missing_value');
    }
  });

  it('RED-3: the identity carry is unchanged — blockers are additive, not a substitute', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT);
    const carrier = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', wire);
    expect(carrier.goal_node_id).toBe('goal_revenue');
    expect(carrier.options.length).toBe(3);
    expect(carrier.status).toBe('blocked');
    expect(carrier.blocked_reason).toBe('MISSING_OPTION_VALUE');
    expect(Object.keys(carrier).sort()).toEqual(
      ['blocked_reason', 'blockers', 'goal_node_id', 'options', 'status'],
    );
  });

  // ── TWINS — carrying must never become manufacturing ────────────────────
  it('TWIN-1: NO blockers to name ⇒ NO `blockers` key — an empty array is never substituted', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT) as Record<string, unknown>;
    // Same payload, producer's blockers removed: the one input that decides it.
    const withoutBlockers = { ...wire };
    delete withoutBlockers.blockers;
    const carrier = buildAnalysisRefusalReadiness(
      'MISSING_OPTION_VALUE',
      withoutBlockers as never,
    );
    expect('blockers' in carrier).toBe(false);
    // The identity still carries — this twin isolates blockers alone.
    expect(carrier.goal_node_id).toBe('goal_revenue');

    // And an EMPTY producer array is treated the same way: absent, not empty.
    const emptied = buildAnalysisRefusalReadiness(
      'MISSING_OPTION_VALUE',
      { ...wire, blockers: [] } as never,
    );
    expect('blockers' in emptied).toBe(false);
  });

  it('TWIN-2 (#1126 unchanged): an ADMITTING refusal stays bare — no identity AND no repair route', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(CONFIGURED);
    // Precondition: this payload really does admit, so the assertion is a
    // discrimination rather than a tautology.
    expect((wire as { may_run?: boolean } | undefined)?.may_run).toBe(true);

    const carrier = buildAnalysisRefusalReadiness('MIXED_SCALE_UNRESOLVED', wire);
    expect(carrier.goal_node_id).toBe('');
    expect(carrier.options).toEqual([]);
    expect('blockers' in carrier).toBe(false);
  });

  it('TWIN-3: the one-argument call is byte-identical to the previous behaviour', () => {
    const carrier = buildAnalysisRefusalReadiness('SCENARIO_READ_FAILED');
    expect(JSON.stringify(carrier)).toBe(
      JSON.stringify({ options: [], goal_node_id: '', status: 'blocked', blocked_reason: 'SCENARIO_READ_FAILED' }),
    );
  });
});
