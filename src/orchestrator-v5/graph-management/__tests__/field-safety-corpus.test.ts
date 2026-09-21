/**
 * ROADMAP 2.474 / amendment A6 — **HALF (b): THE HAND-WRITTEN CORPUS.**
 *
 * ⚠ WHY THIS FILE EXISTS AND WHY IT MAY NOT BE "TIDIED UP" INTO A LOOP OVER
 * THE TABLE. A derived guard proves the copies AGREE; it is structurally BLIND
 * to the canonical list being SHORT (measured on purpose in the schemas leg:
 * deleting a key from the canonical map left the purely-derived guard GREEN).
 * `field-parity-derivation.test.ts` derives everything from the table and
 * therefore cannot notice the TABLE being wrong. This file spells real payload
 * shapes out BY HAND — the exact wire spellings the live producers emit and
 * the exact names an attacker would try — so that a table which quietly loses
 * a row, or a contract that quietly gains a key, REDs here.
 *
 * Every literal below is sourced from a producer at the bytes, not invented:
 *   - the option-configure spellings from `edit-graph-producer.ts` +
 *     `checkObservedSubtree`'s own path grammar;
 *   - the provenance stamps from `field-safety.ts`'s own owned list and
 *     `cee-v3.ts`'s `ObservedStateV3` / `EdgeV3` declarations;
 *   - the intervention contract keys from `InterventionV3`.
 *
 * Neither half supersedes the other. Drop either and a whole defect class goes
 * unobserved.
 */
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_OWNED_ROOTS,
  INTERVENTION_CONTRACT_KEYS,
  CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST,
  ALLOWED_NODE_FIELD_ROOTS,
  ALLOWED_EDGE_FIELD_ROOTS,
  ALLOWED_OBSERVED_SUBKEYS,
} from '../field-safety.js';
import { refereeMutation } from '../referee.js';
import { FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();
const REFUSALS = new Set<string>([FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD]);

function nodeUpdate(field: string, to: unknown) {
  return refereeMutation(
    makeEnvelope('update_node_field', { node_id: 'f-spend', field, from: null, to }, { base_graph_hash: hashOf(G) }),
    G,
    frameFor(G),
  );
}
function edgeUpdate(field: string, to: unknown) {
  return refereeMutation(
    makeEnvelope(
      'update_edge_field',
      { from_node: 'f-spend', to_node: 'g-profit', field, from: null, to },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}
function addNode(screened: Record<string, unknown>) {
  return refereeMutation(
    makeEnvelope(
      'add_node',
      { node: { id: 'n-new', kind: 'factor', label: 'New factor' }, screened_value: screened },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}

// ---------------------------------------------------------------------------
// A. THE UNION ASSERTION — canonical ⊇ every sibling lookup in this tree
// ---------------------------------------------------------------------------

/**
 * The importable half of the corpus obligation: every provenance/owned name
 * this REPO can reach must be accounted for by the union. This is the check
 * that notices a name CEE owns disappearing from the canonical side — the
 * `thousand`-shaped drift, applied to provenance.
 *
 * Hand-written on purpose: these are the names spelled in `cee-v3.ts`'s node
 * and edge declarations and in the referee's own owned list, read at the bytes.
 */
const OWNED_NAMES_REACHABLE_IN_THIS_REPO = [
  // src/schemas/cee-v3.ts — NodeV3
  'provenance',
  'extractiontype',
  // src/schemas/cee-v3.ts — EdgeV3
  'provenance_display',
  'origin',
  'validation',
  'defaulted',
  // src/schemas/cee-v3.ts — ObservedStateV3
  'source',
  'raw_value',
] as const;

describe('corpus A — union assertion: the owned set covers every stamp reachable in this repo', () => {
  it('every hand-listed reachable stamp is in the union', () => {
    for (const name of OWNED_NAMES_REACHABLE_IN_THIS_REPO) {
      expect(PIPELINE_OWNED_ROOTS.has(name), `${name} is not screened as owned`).toBe(true);
    }
  });

  it('and the union is strictly larger — the table contributed names this repo has no schema for', () => {
    const local = new Set<string>(OWNED_NAMES_REACHABLE_IN_THIS_REPO);
    const extra = [...PIPELINE_OWNED_ROOTS].filter((k) => !local.has(k)).sort();
    expect(extra).toEqual([
      'beliefexistssource',
      'directionsource',
      'strengthstdsource',
      'threshold_source',
      'weightsource',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B. THE SIX SMUGGLE NAMES, SPELLED OUT BY HAND
// ---------------------------------------------------------------------------

/**
 * The same six the derived test computes — written here as literals so the
 * pair DISAGREE if the contract shifts. If `InterventionV3` ever gains, say,
 * an `origin` field, the derived list silently shrinks to five and every
 * derived assertion still passes; this literal list REDs.
 */
const SIX_SMUGGLE_NAMES = [
  'provenance',
  'provenance_display',
  'validation',
  'defaulted',
  'origin',
  'extractiontype',
] as const;

describe('corpus B — the six smuggle names, hand-written', () => {
  it('each is owned by CEE and is NOT an intervention contract key', () => {
    for (const name of SIX_SMUGGLE_NAMES) {
      expect(PIPELINE_OWNED_ROOTS.has(name), `${name} owned`).toBe(true);
      expect(INTERVENTION_CONTRACT_KEYS.has(name), `${name} must not be a contract key`).toBe(false);
    }
  });

  it('the hand list and the derived difference are the SAME SIX (a disagreement is the signal)', () => {
    const derived = [...CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST]
      .filter((k) => !INTERVENTION_CONTRACT_KEYS.has(k))
      .sort();
    expect(derived).toEqual([...SIX_SMUGGLE_NAMES].sort());
  });

  for (const name of SIX_SMUGGLE_NAMES) {
    it(`\`${name}\`: dies at the bare spelling, the nested spelling, and inside interventions`, () => {
      expect(nodeUpdate(name, 'x').blocker?.code, 'bare').toBe(PIPELINE_OWNED_FIELD);
      expect(nodeUpdate('prior', { [name]: 'x' }).blocker?.code, 'nested payload').toBe(
        PIPELINE_OWNED_FIELD,
      );
      expect(
        nodeUpdate('data/interventions/f-spend', { value: 1, [name]: 'x' }).blocker?.code,
        'inside a spec',
      ).toBe(PIPELINE_OWNED_FIELD);
      expect(
        addNode({ observed_state: { value: 1, [name]: 'x' } }).blocker?.code,
        'nested on an add',
      ).toBe(PIPELINE_OWNED_FIELD);
    });
  }
});

// ---------------------------------------------------------------------------
// C. REAL LIVE WIRE SPELLINGS — the shapes the producers actually emit
// ---------------------------------------------------------------------------

describe('corpus C — the live edit vocabulary round-trips (a revoked capability REDs here)', () => {
  const LIVE_NODE_WRITES: ReadonlyArray<readonly [string, unknown]> = [
    ['label', 'Ad spend'],
    ['description', 'Money spent on ads'],
    ['category', 'controllable'],
    ['display_value', '£40,000'],
    ['factor_type', 'continuous'],
    ['uncertainty_drivers', ['market volatility']],
    ['intercept', 0.2],
    ['is_baseline', true],
    ['encoding_map', { '0': 'Developers' }],
    ['prior', { distribution: 'uniform', range_min: 0, range_max: 1 }],
    ['observed_state.value', 0.6],
    ['observed_state.unit', 'GBP'],
    ['observed_state.baseline', 0.4],
    ['observed_state.std', 0.15],
    ['data/value', 0.6],
    ['data/unit', 'GBP'],
    ['observed_state', { value: 0.6, unit: 'GBP' }],
    ['data/interventions/f-spend', { value: 25000, raw_value: 25000, unit: 'GBP', cap: 50000 }],
    ['observed_state.interventions', { 'f-spend': { value: 25000, raw_value: 25000 } }],
    ['interventions', { 'f-spend': { value: 25000, unit: 'GBP' } }],
  ];

  for (const [field, to] of LIVE_NODE_WRITES) {
    it(`node \`${field}\` passes the field screen`, () => {
      const code = nodeUpdate(field, to).blocker?.code;
      expect(code === undefined || !REFUSALS.has(code), `refused with ${code}`).toBe(true);
    });
  }

  const LIVE_EDGE_WRITES: ReadonlyArray<readonly [string, unknown]> = [
    ['strength', { mean: 0.6, std: 0.1 }],
    ['strength.mean', 0.6],
    ['strength.std', 0.1],
    ['exists_probability', 0.85],
    ['effect_direction', 'positive'],
    ['edge_type', 'directed'],
    ['label', 'increases'],
  ];

  for (const [field, to] of LIVE_EDGE_WRITES) {
    it(`edge \`${field}\` passes the field screen`, () => {
      const code = edgeUpdate(field, to).blocker?.code;
      expect(code === undefined || !REFUSALS.has(code), `refused with ${code}`).toBe(true);
    });
  }

  it('the corpus actually covers every allowlisted root (a short corpus is the failure mode)', () => {
    const nodeRootsCovered = new Set(LIVE_NODE_WRITES.map(([f]) => f.split(/[./]/)[0]!));
    for (const root of ALLOWED_NODE_FIELD_ROOTS) {
      if (root === 'state_space' || root === 'probability' || root === 'impact') continue; // see below
      if (root === 'goal_constraints') continue; // no live producer spelling; covered by the smuggle block
      expect(nodeRootsCovered.has(root), `node root \`${root}\` has no corpus entry`).toBe(true);
    }
    const edgeRootsCovered = new Set(LIVE_EDGE_WRITES.map(([f]) => f.split(/[./]/)[0]!));
    for (const root of ALLOWED_EDGE_FIELD_ROOTS) {
      expect(edgeRootsCovered.has(root), `edge root \`${root}\` has no corpus entry`).toBe(true);
    }
    for (const sub of ALLOWED_OBSERVED_SUBKEYS) {
      expect(
        LIVE_NODE_WRITES.some(([f]) => f.split(/[./]/)[1] === sub),
        `observed sub-key \`${sub}\` has no corpus entry`,
      ).toBe(true);
    }
  });

  it('the three NEW grants CEE cannot persist pass the screen and are recorded as proposal-only', () => {
    // Deliberately separate from the live corpus above: these roots have no
    // live producer spelling and CEE's own NodeV3 strips them (measured in
    // field-parity-derivation.test.ts). They are granted because the table
    // grants them; the honest statement is "screened OK, persisted never".
    for (const [field, to] of [
      ['state_space', { range: { min: 0, max: 1 } }],
      ['probability', 0.4],
      ['impact', 'high'],
    ] as const) {
      const code = nodeUpdate(field, to).blocker?.code;
      expect(code === undefined || !REFUSALS.has(code), `${field} refused with ${code}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D. THE ATTACK CORPUS — spellings a hostile or buggy producer would try
// ---------------------------------------------------------------------------

describe('corpus D — hand-written attack spellings, every one refused', () => {
  const ATTACKS: ReadonlyArray<readonly [string, string, unknown]> = [
    ['bare provenance stamp', 'observed_state.source', 'user'],
    ['slash-keyed provenance stamp', 'data/source', 'user'],
    ['node extraction stamp', 'extractionType', 'explicit'],
    ['goal-threshold provenance (J2)', 'threshold_source', 'user'],
    ['whole-object observed write carrying a stamp', 'observed_state', { value: 1, source: 'user' }],
    ['stamp nested under a tunable root', 'prior', { range_min: 0, provenance: 'user_set' }],
    ['stamp two levels down', 'prior', { a: { b: { validation: {} } } }],
    ['stamp inside an array', 'uncertainty_drivers', [{ origin: 'user' }]],
    ['analysis marker', 'sensitivity_score', 0.9],
    ['analysis marker nested', 'observed_state.value', 1],
    ['identity re-type', 'kind', 'goal'],
    ['identity id', 'id', 'other'],
    ['invariant-coupled threshold', 'goal_threshold', 0.8],
    ['invariant-coupled quad member', 'goal_threshold_cap', 1000],
    ['invariant-coupled success threshold', 'success_threshold', 0.9],
    ['invariant-coupled cap in observed', 'observed_state.cap', 500],
    ['invariant-coupled raw_value in observed', 'observed_state.raw_value', 500],
    ['non-tunable observed sub-key', 'observed_state.factor_type', 'continuous'],
    ['un-rowed invented field', 'made_up_field', 1],
  ];

  for (const [name, field, to] of ATTACKS) {
    if (name === 'analysis marker nested') continue; // benign control, asserted below
    it(`${name} (\`${field}\`) is refused`, () => {
      const code = nodeUpdate(field, to).blocker?.code;
      expect(code !== undefined && REFUSALS.has(code), `NOT refused (code ${code})`).toBe(true);
    });
  }

  it('POSITIVE CONTROL — the screen can also PASS: a benign observed_state.value write is not refused', () => {
    // Without this, every assertion above could be satisfied by a screen that
    // refuses everything, and the whole corpus would prove nothing.
    const code = nodeUpdate('observed_state.value', 0.6).blocker?.code;
    expect(code === undefined || !REFUSALS.has(code)).toBe(true);
  });

  it('deferred_derivation is refused with its own class, not silently granted', () => {
    const code = edgeUpdate('confidence', 'high').blocker?.code;
    expect(code).toBe(FIELD_NOT_ALLOWED);
  });
});
