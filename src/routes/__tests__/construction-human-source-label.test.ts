/** TL6208664188: source figures are not automatically the goal's target. Offline native registration. */
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../orchestrator-v5/drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { buildModelFromBrief } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';

import { provenanceOf } from '../../cee/provenance/provenance-of.js';

type Rec = Record<string, any>;
const SID = '00000000-0000-4000-8000-000000000052';
const closed: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closed.splice(0)) await close(); });
/** The minimal scripted model from the closed #3270 test; no draw is claimed as served evidence. */
function draft(brief: string, metric: string, value: number | null, unit: string, kind: string | null = 'event_by_date'): CandidateModel {
  return {
    decision_question: brief,
    goal: { kind, deliverable: null, metric, operator: '>=', target_stated: value !== null, value,
      unit: value === null ? '%' : unit, provenance: 'explicit', frame: 'level', horizon_months: null,
      baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null },
    constraints: [], identities: [], unknowns: [],
    options: [
      { label: 'Carry on', provenance: 'inferred', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Expand outreach', provenance: 'inferred', changes: [], interventions: [
        { factor_label: 'Effort', value: 1, value_kind: 'absolute', unit: 'index', provenance: 'inferred' }] },
    ],
    factors: [{ label: 'Effort', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'index', provenance: 'inferred', plausible_max: 1 }],
    risks: [], outcomes: [],
    links: [{ from: 'Effort', to: metric, direction: 'positive', provenance: 'inferred' }],
  } as CandidateModel;
}
async function construct(brief: string, drafts: CandidateModel[]) {
  let stored: Rec | null = null;
  const writes: Rec[] = [];
  let writtenBrief: unknown;
  storeRef.value = {
    append: vi.fn(async (w: Rec) => { stored = structuredClone(w.graph); writes.push(w); return { id: w.turn_id }; }),
    loadGraph: async () => stored,
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify();
  await registerRoute(app); await app.ready(); closed.push(() => app.close());
  const dispatch = async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) {
      writtenBrief = body.brief_text;
      const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body });
      return { status: r.statusCode, json: r.json() };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: stored ?? { nodes: [], edges: [] }, graph_hash: 's2' } };
  };
  let calls = 0;
  const call = async () => ({ text: JSON.stringify(drafts[Math.min(calls++, drafts.length - 1)]), status: 'completed' as const });
  const result = await buildModelFromBrief(SID, brief, dispatch as never, call) as Rec;
  return { result, graph: stored as Rec | null, writes, calls, writtenBrief };
}
const HUMAN = "Let's assume 60 and possibly more if I needed to.";
const BRIEF = 'We need to secure angel funding of at least £250,000. Explore ways to secure funding.\n' + HUMAN;
const sourceDraft = (human: boolean) => {
  const c = draft(BRIEF, 'Funding secured', 250000, 'GBP', null) as unknown as Rec;
  c.factors = [{ label: 'Weekly founder hours available', role: 'external', baseline_known: true, baseline_value: 60, unit: 'hours/week', provenance: human ? 'explicit' : 'inferred', plausible_max: 100 }];
  c.options = [{ label: 'Carry on', provenance: 'inferred', is_status_quo: true, changes: [], interventions: [] }, { label: 'Expand outreach', provenance: 'inferred', changes: [], interventions: [{ factor_label: 'Weekly founder hours available', value: 80, value_kind: 'absolute', unit: 'hours/week', provenance: 'inferred' }] }];
  c.links = [{ from: 'Weekly founder hours available', to: 'Funding secured', direction: 'positive', provenance: 'inferred' }];
  c.statements = human ? [{ subject: { kind: 'factor', label: 'Weekly founder hours available' }, field: 'level', form: 'point', quote: HUMAN, value: 60, low: null, high: null, unit: 'hours/week', qualifier: 'possibly more if I needed to', conditions: 'Planning assumption, not a fixed ceiling or measured current working time.' }] : [];
  return c as unknown as CandidateModel;
};
// DL-3 16 Oct (#3279 BUDDY-B B1): the admission stamp behind this row put a false brief source on other figures; it moved to
// Lane A's admission-authorship PR, which re-enables this row with its own fix.
it.skip('native build → admission → register retains the 60-hour human source separately from its unverified current-level binding', async () => {
  const out = await construct(BRIEF, [sourceDraft(true)]);
  expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true }); expect(out.writes).toHaveLength(1);
  const node = out.graph!.nodes.find((n: Rec) => n.kind === 'factor');
  expect(node.observed_state).toMatchObject({ raw_value: 60, source: 'brief_extraction', user_material_unverified: true });
  expect(provenanceOf({ value: node.observed_state })).toMatchObject({ origin: 'human', role: 'unverified' });
  expect(node.user_statements[0].statements[0]).toMatchObject({ speaker: 'user', source: HUMAN, qualifier: 'possibly more if I needed to', conditions: 'Planning assumption, not a fixed ceiling or measured current working time.' });
});
it('a genuine generated 60-hour estimate retains Olumi source even though the same literal appears elsewhere', async () => {
  const out = await construct(BRIEF, [sourceDraft(false)]);
  expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
  const node = out.graph!.nodes.find((n: Rec) => n.kind === 'factor');
  expect(node.observed_state).toMatchObject({ raw_value: 60, source: 'cee_inference' });
  expect(node.observed_state.user_material_unverified).not.toBe(true);
  expect(provenanceOf({ value: node.observed_state })).toMatchObject({ origin: 'ai' });
});
it('an invented quotation receives no human source marker', async () => {
  const c = sourceDraft(true) as unknown as Rec; c.statements[0].quote = 'I work exactly 60 hours each week.';
  const out = await construct(BRIEF, [c as unknown as CandidateModel]);
  expect(out.result, JSON.stringify(out.result)).toMatchObject({ ok: true, mutated: true });
  expect(out.graph!.nodes.find((n: Rec) => n.kind === 'factor').observed_state.source).toBe('cee_inference');
});
