/**
 * A construction whose response was lost is RECOVERED, not refused and not rebuilt.
 *
 * ⛔ THE DEFECT, from the independent review of #1691 at 84dadabb: after a build
 * committed and its response was lost, a retry of `build_model_from_brief` read
 * the now-populated graph and answered `model_already_exists` BEFORE it sent the
 * derived operation id — so the registration replay arm was unreachable from the
 * Agent. The model and its version were saved; the Agent told the user they were
 * not. My first test for this compared ids from two fresh empty doubles and never
 * retried after a commit, so it could not see it.
 *
 * This is the witness the reviewer specified: the WHOLE Agent tool, twice, on ONE
 * stateful store. The store honours the registration route's contract through the
 * SAME identity functions the route uses, so it cannot drift from it.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { registrationRequestHash, registrationTurnId } from '../../graph-registration/registration-identity.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };
const BRIEF = 'Should we raise the Pro plan from £49 to £59?';

const candidate = (optionLabel: string) => ({
  goal: { metric: 'MRR', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [],
  options: [{ label: optionLabel, provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Monthly recurring revenue', provenance: 'inferred' }],
  links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
});

/** One stateful product: graph, versions and the durable (scenario, turn_id) key. */
function statefulStore(opts: { preloadNodes?: unknown[] } = {}) {
  let nodes: unknown[] = opts.preloadNodes ?? [];
  let edges: unknown[] = [];
  const versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[] = [];
  const committed = new Map<string, string>(); // turn_id -> request_hash
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      const turnId = registrationTurnId(SCENARIO, b.operation_id as string | undefined);
      const hash = registrationRequestHash(b.graph, typeof b.brief_text === 'string' ? b.brief_text : undefined);
      const priorHash = committed.get(turnId);
      if (priorHash !== undefined) {
        if (priorHash !== hash) return { status: 409, json: { details: { code: 'OPERATION_ID_REUSED' } } };
        const v = versions.find((x) => x.creation.source_turn_id === turnId)!;
        return { status: 200, json: { registered: true, replayed: true, model_version: { version_id: v.version_id, version_number: v.sequence } } };
      }
      const g = b.graph as { nodes: unknown[]; edges: unknown[] };
      nodes = g.nodes; edges = g.edges;
      const seq = versions.length + 1;
      const v = { version_id: `00000000-0000-4000-8000-00000000000${seq}`, sequence: seq, creation: { kind: seq === 1 ? 'initial' : 'committed_mutation', mutation_id: `m-${seq}`, source_turn_id: turnId } };
      versions.push(v);
      committed.set(turnId, hash);
      return { status: 200, json: { registered: true, model_version: { version_id: v.version_id, version_number: seq } } };
    }
    if (path.endsWith('/versions')) {
      return { status: 200, json: { versions: [...versions].reverse(), next_cursor: null } };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${versions.length}-${nodes.length}` } };
  };
  return { d, versions };
}

const build = (d: InternalDispatch, call: CallStructuredModel) =>
  dispatchTool('build_model_from_brief', JSON.stringify({ brief: BRIEF }), ctx, createAgentCapabilities(d, new ProposalStore(), call)) as Promise<Record<string, unknown>>;

describe('a lost construction response is recovered', () => {
  it('RED: the retry recovers the SAME version, writes no second one, and does NOT regenerate', async () => {
    const store = statefulStore();
    let generations = 0;
    const call: CallStructuredModel = async () => { generations += 1; return { text: JSON.stringify(candidate('Raise to £59')) }; };

    const first = await build(store.d, call);          // commits…
    expect(first.ok, JSON.stringify(first).slice(0, 200)).toBe(true);
    const firstVersion = (first.model_version as { version_id: string }).version_id;
    // …and its response is LOST. The retry starts from the populated store.
    const retry = await build(store.d, call);

    expect(retry.ok, JSON.stringify(retry).slice(0, 300)).toBe(true);
    expect(retry.replayed).toBe(true);
    expect(retry.mutated).toBe(false);
    // Bound by IDENTITY: the version the first call made.
    expect((retry.model_version as { version_id: string }).version_id).toBe(firstVersion);
    expect(store.versions).toHaveLength(1);
    // No second model generation: the lookup happens before the model is called.
    expect(generations).toBe(1);
    // And the recovered result still reports the model as it now stands.
    expect(retry.confirmed_entities).toBeGreaterThan(0);
  });

  it('CONTRAST: a populated graph with NO matching construction is still refused, and nothing is generated', async () => {
    const store = statefulStore({ preloadNodes: [{ id: 'x', kind: 'goal', label: 'An existing model' }] });
    let generations = 0;
    const call: CallStructuredModel = async () => { generations += 1; return { text: JSON.stringify(candidate('Raise to £59')) }; };
    const r = await build(store.d, call);
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('model_already_exists');
    expect(generations).toBe(0);
    expect(store.versions).toHaveLength(0);
  });
});

/**
 * ⛔ A FOREIGN VERSION MUST NEVER SATISFY THE CONSTRUCTION LOOKUP.
 *
 * Independent review of #1691 at 36308a81 (M17): replacing the identity match
 * in `findConstructionVersion` with "take the newest version" passed every
 * test, because the contrast above holds ZERO versions. Under that mutant a
 * model the user built by hand was reported as "already built from this brief
 * and saved as version 9" — the populated-model guard bypassed with a false
 * claim. The reviewer's discriminating test, verbatim in substance.
 */
describe('a populated scenario whose versions are NOT this construction', () => {
  it('CONTRAST: a populated scenario WITH an unrelated version is still refused', async () => {
    const versions = [{
      version_id: 'aaaaaaaa-0000-4000-8000-000000000009', sequence: 9,
      creation: { kind: 'committed_mutation', mutation_id: 'm-9', source_turn_id: 'SOME-OTHER-TURN' },
    }];
    const d: InternalDispatch = async (path) =>
      path.endsWith('/versions')
        ? { status: 200, json: { versions, next_cursor: null } }
        : { status: 200, json: { graph: { nodes: [{ id: 'x', kind: 'goal', label: 'Built by hand' }], edges: [] }, graph_hash: 'h9' } };
    let generations = 0;
    const call: CallStructuredModel = async () => { generations += 1; return { text: '{}' }; };
    const r = await build(d, call);
    expect(r.ok, 'a foreign version must never satisfy the construction lookup').toBe(false);
    expect(r.refusal).toBe('model_already_exists');
    expect(generations).toBe(0);
  });
});

describe('a concurrent build of the same construction', () => {
  it('RED: leaves ONE version and both calls report it — the loser recovers instead of refusing', async () => {
    const store = statefulStore();
    // Both calls must pass the empty-graph guard before either registers, and
    // generation is not deterministic, so they produce DIFFERENT bytes.
    let arrived = 0;
    let release!: () => void;
    const bothIn = new Promise<void>((r) => { release = r; });
    const labels = ['Raise to £59', 'Raise Pro price to £59'];
    const call: CallStructuredModel = async () => {
      const mine = labels[arrived];
      arrived += 1;
      if (arrived === 2) release();
      await bothIn;
      return { text: JSON.stringify(candidate(mine)) };
    };
    const [a, b] = await Promise.all([build(store.d, call), build(store.d, call)]);
    expect(store.versions).toHaveLength(1);
    const va = (a.model_version as { version_id: string }).version_id;
    const vb = (b.model_version as { version_id: string }).version_id;
    expect(a.ok && b.ok, JSON.stringify([a.refusal, b.refusal])).toBe(true);
    expect(vb).toBe(va);
    // Exactly one of them is the recovery.
    expect([a.replayed === true, b.replayed === true].filter(Boolean)).toHaveLength(1);
  });
});
