/**
 * ⛔ OLUMI'S OWN ESTIMATE MUST SAY SO ON THE CANVAS.
 *
 * Served UI b017e3c2 · CEE 9417228: on the first pass the canvas marked Olumi's
 * estimates "no source". The OpenAI-lane constructor (`estimatedObservedState`)
 * wrote `{ value, raw_value, unit?, source: 'cee_inference' }` with NO
 * `extractionType`; the UI's source mark (`valueSourceMark.tsx:124-147`) says
 * "Olumi estimate" only on `extractionType: 'inferred'` — the stamp the
 * conventional CEE builders write for a value the brief did not state
 * (`prompts/defaults-v19.ts:154`). The UI cannot tell Olumi's value from a
 * person's durably (UI #2000, withdrawn), so the producer stamps it.
 *
 * What must NOT change:
 *  · a value the user STATED in the brief never carries `inferred`;
 *  · a value a person later SETS withdraws the marker — the real
 *    `factor_value_edit` → `set_factor_value` chain already clears it
 *    (`set-factor-value.ts`), so Olumi's stamp can never outlive its number;
 *  · the capless shape and `cee_inference` source (#1838) are unchanged.
 *
 * Every assertion names the node by id, on the admitted graph and on the REAL
 * registration payload parsed with CEE's own `GraphV3`.
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

/**
 * The SERVED node (CEE 9417228, OpenAI lane): an estimated baseline, framed and
 * stamped `cee_inference`, carrying no `extractionType` — the shape the canvas
 * rendered as "no source".
 */
const SERVED_ESTIMATE_NODE = {
  id: 'engineering_headcount',
  kind: 'factor',
  label: 'Engineering headcount',
  scale_frame: 50,
  observed_state: { value: 12 / 50, raw_value: 12, unit: 'FTE', source: 'cee_inference' },
} as const;

type Factor = CandidateModel['factors'][number];
const factor = (label: string, over: Partial<Factor> = {}): Factor => ({
  label, role: 'controllable', baseline_known: false, baseline_value: null, unit: 'FTE', provenance: 'inferred', plausible_max: 50, ...over,
});

/** Hiring-shaped: one estimated baseline (the served node's), one the user stated, one with none. */
function candidate(): CandidateModel {
  return {
    goal: { metric: 'Delivery velocity', operator: '>=', value: 30, unit: 'points', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire Two Developers', provenance: 'explicit', changes: ['Engineering headcount'], interventions: [] },
      { label: 'Hire a Tech Lead', provenance: 'explicit', changes: ['Stated tech leads', 'Unknown contractors'], interventions: [] },
    ],
    factors: [
      factor('Engineering headcount', { baseline_value: 12 }),
      factor('Stated tech leads', { baseline_known: true, baseline_value: 2, provenance: 'explicit', plausible_max: 10 }),
      factor('Unknown contractors'),
    ],
    risks: [], outcomes: [],
    links: ['Engineering headcount', 'Stated tech leads', 'Unknown contractors'].map((from) => ({
      from, to: 'Delivery velocity', direction: 'positive' as const, provenance: 'inferred',
    })),
  } as CandidateModel;
}

type Node = Record<string, unknown> & { id: string; observed_state?: Record<string, unknown> };
const byId = (g: { nodes: readonly unknown[] }, id: string): Node => {
  const n = (g.nodes as Node[]).find((x) => x.id === id);
  expect(n, `node ${id}`).toBeDefined();
  return n!;
};

/** The real registration path, parsed as CEE parses it. */
async function registered(): Promise<{ nodes: unknown[] }> {
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify({ ...candidate(), unknowns: [] }) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('88888888-8888-4888-8888-888888888888', 'Should I hire a tech lead or two developers?', d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return GraphV3.parse(graph) as unknown as { nodes: unknown[] };
}

describe('an AI estimate is marked as Olumi’s on the canvas (extractionType: inferred)', () => {
  it('fixture: the served node is exactly what the producer used to write, minus the marker', () => {
    expect(SERVED_ESTIMATE_NODE.observed_state).not.toHaveProperty('extractionType');
    expect(SERVED_ESTIMATE_NODE.observed_state.source).toBe('cee_inference');
  });

  it('RED: the served node, admitted now, carries extractionType "inferred" — and nothing else changed', () => {
    const n = byId(admitCandidateModel(candidate()), SERVED_ESTIMATE_NODE.id);
    expect(n.observed_state).toStrictEqual({ ...SERVED_ESTIMATE_NODE.observed_state, extractionType: 'inferred' });
    expect(n.scale_frame).toBe(SERVED_ESTIMATE_NODE.scale_frame);
    expect(n.observed_state).not.toHaveProperty('cap');
  });

  it('RED (round trip): the marker survives /graph/register and CEE’s GraphV3 parse', async () => {
    const n = byId(await registered(), SERVED_ESTIMATE_NODE.id);
    expect(n.observed_state).toMatchObject({ source: 'cee_inference', extractionType: 'inferred', raw_value: 12 });
  });

  it('CONTROL: a baseline the user STATED never carries "inferred"', async () => {
    for (const g of [admitCandidateModel(candidate()), await registered()]) {
      const os = byId(g, 'stated_tech_leads').observed_state ?? {};
      expect(os.source).toBe('brief_extraction');
      expect(os.extractionType).not.toBe('inferred');
      expect(byId(g, 'stated_tech_leads').extractionType).not.toBe('inferred');
    }
  });

  it('CONTROL: no estimate, no observed_state — nothing is stamped on an absent value', () => {
    expect(byId(admitCandidateModel(candidate()), 'unknown_contractors')).not.toHaveProperty('observed_state');
  });

  it('CONTROL: a value a person SETS over Olumi’s estimate withdraws the marker (real factor_value_edit chain)', async () => {
    const persisted = await registered();
    const event = { kind: 'factor_value_edit', target_id: SERVED_ESTIMATE_NODE.id, value: 20, field: 'value' } as
      Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>;
    const result = await applyFactorValueEdit({
      payload: {
        kind: 'system_event', scenario_id: '88888888-8888-4888-8888-888888888888',
        turn_id: '99999999-9999-4999-8999-999999999999', stage: 'analyse', event,
      } as unknown as SystemEventTurnPayload,
      event,
      requestId: 'req-estimate-then-user',
      persistedGraph: persisted as unknown as Record<string, unknown>,
      priorFacts: [],
    });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    for (const g of [result.mutatedGraph, result.graph] as { nodes: unknown[] }[]) {
      const n = byId(g, SERVED_ESTIMATE_NODE.id);
      expect(n.observed_state?.source).toBe('user_override');
      expect('extractionType' in (n.observed_state ?? {})).toBe(false);
      expect(n.extractionType).not.toBe('inferred');
    }
  });
});
