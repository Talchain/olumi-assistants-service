/**
 * ⭐ #2623 (B) AT THE COMMIT DOOR (Codex r1 on #2631; DL 0df0e1 ruling, cut 5). One end-to-end answer through a level-less
 * mediator writes the user's link AND the gauge (M → child = ±1, `sized_by_identity: {op:'gauge'}`). The writer has done
 * that since #2623, but the one-link door's scope guard admitted only the declared link, so the approval card the dry run
 * offered was refused on Approve (`link_scope_mismatch`). The door now admits exactly the gauge child edge
 * `mediatorReadings` names for the declared link's target, and only when it reads back as an intact stored gauge.
 */
import { describe, expect, it } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { mediatorReadings } from '../../agent-lane/mediator-reading.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../dispatch.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../link-effect-unit-reading.js';
import { executeOptionInterventionBatch, linkStrengthsPostimageIsScoped } from '../option-intervention-edit.js';

type Rec = Record<string, any>;
const SCENARIO = '0c6dcb3d-de66-4b46-8860-4b7dce0bb107';
const GOAL = { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£/month', source: 'user_override' } };
const placeholder = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
  effect_direction: mean < 0 ? 'negative' : 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
/** no-dead-end-mediator's (B) graph, as the store HOLDS it: price → strain (no unit, no level, no sized parent) → MRR. */
function stored(): Rec {
  return assignEntityRefs(projectGraphForPersistence({
    goal_node_id: 'mrr',
    nodes: [
      structuredClone(GOAL),
      { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
      { id: 'strain', kind: 'factor', label: 'Support capacity strain' },
      { id: 'o-raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.59, raw_value: 59 } } },
    ],
    edges: [placeholder('price', 'strain', 0.4), placeholder('strain', 'mrr', -0.3)],
  }), { nodes: [], edges: [] }).graph as Rec;
}
const E2E = { amount: -1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£' } as const;
const SAID = 'Every £1 on the price loses us about £1,200 a month of MRR through support strain.';
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'gauge-door', user_text });

/** The real proposer, card, approval and commit door over a serialized SessionStore (link-effect-size-by-chat's world). */
function world(initial: Rec) {
  let graphJson = JSON.stringify(initial);
  const graph = () => JSON.parse(graphJson) as Rec;
  const proposals = new ProposalStore();
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async (write) => {
      const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `gauge-row-${rows.length + 1}`;
      rows.push({ id, write: s });
      if (s.graph !== undefined) graphJson = JSON.stringify(s.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((row) => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-06T00:00:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'gauge-real-commit', requestHash: `gauge:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.link_effect !== undefined ? { linkEffect: input.link_effect } : {}),
      ...(input.link_effects !== undefined ? { linkEffects: input.link_effects } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false,
      committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    return { status: 200, json: { graph: read, graph_hash: computeAnalysisAffectingGraphHash(read as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }), proposals, commits, graph };
}
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);

describe('#2623 (B) at the one-link commit door: the gauge child edge is admitted, by identity, and nothing else', () => {
  it('CHAIN (RED on 231affbe): propose → card → Approve → REAL door → stored → read-back; the gauge is stored intact', async () => {
    const w = world(stored());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(SAID), { from_label: 'Pro plan price', to_label: 'Support capacity strain', ...E2E,
      quote: SAID }) as Rec;
    expect(r.ok, JSON.stringify(r)).toBe(true); // the card IS offered
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }))[0]!;
    const out = await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.commits.map((c) => c.link_effect !== undefined)).toEqual([true]);
    const g = w.graph();
    expect(edge(g, 'price', 'strain').provenance.magnitude).toBe('user_stated');
    expect(edge(g, 'strain', 'mrr').strength.mean).toBe(-1);
    expect(edge(g, 'strain', 'mrr').provenance.sized_by_identity).toEqual({ op: 'gauge' });
    expect(mediatorReadings(g).get('strain')).toMatchObject({ via: 'gauge', child: 'mrr', stored: true });
  });

  /** The real writer's postimage of the (B) answer, on `base`, with its approved link (as the door re-runs it). */
  function written(base: Rec) {
    const prepared = prepareLinkEffectUnitReadings(base, 'price', 'strain', E2E, SAID);
    const p = { persistedGraph: base, from: 'price', to: 'strain', effect: E2E, quote: SAID, unit_readings: prepared.unit_readings,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(base as never)!, edge_token: linkEffectEdgeToken(base, 'price', 'strain')! } };
    const r = applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p) });
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    return { after: projectGraphForPersistence(r.mutatedGraph) as Rec, links: [{ from: 'price', to: 'strain', unit_readings: prepared.unit_readings }] };
  }
  /** (B) plus an unrelated sized quantity into the goal, so a second edge exists that `mediatorReadings` does not name. */
  function withChurn(): Rec {
    const g = stored();
    g.nodes.push({ id: 'churn', ref: 'F9', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: '%' } });
    g.edges.push(placeholder('churn', 'mrr', -0.5));
    return g;
  }

  it('CONTROL: the real writer postimage (declared link + the named gauge) is in scope', () => {
    const before = withChurn();
    const { after, links } = written(before);
    expect(linkStrengthsPostimageIsScoped(before, after, links)).toBe(true);
  });
  it('NOT-NAMED: a gauge-shaped write on an edge mediatorReadings does not name for the target → out of scope', () => {
    const before = withChurn();
    const { after, links } = written(before);
    const other = edge(after, 'churn', 'mrr');
    other.strength = { ...other.strength, mean: -1 };
    other.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', sized_by_identity: { op: 'gauge' } };
    expect(linkStrengthsPostimageIsScoped(before, after, links)).toBe(false);
  });
  it('NOT-INTACT: the named child edge changed but is not the intact gauge (|mean| ≠ 1) → out of scope', () => {
    const before = withChurn();
    const { after, links } = written(before);
    edge(after, 'strain', 'mrr').strength.mean = -0.5;
    expect(linkStrengthsPostimageIsScoped(before, after, links)).toBe(false);
  });
  it('ALREADY-STORED: a gauge the store already holds is never re-written through this door (a sign flip → out of scope)', () => {
    const { after: first } = written(withChurn());
    const before = first; // the gauge is now the stored one
    expect(mediatorReadings(before).get('strain')).toMatchObject({ via: 'gauge', stored: true });
    const after = structuredClone(before);
    const g = edge(after, 'strain', 'mrr');
    g.strength = { ...g.strength, mean: 1 };
    g.effect_direction = 'positive';
    expect(linkStrengthsPostimageIsScoped(before, after, [{ from: 'price', to: 'strain' }])).toBe(false);
  });
});

