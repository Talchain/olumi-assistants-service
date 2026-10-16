/** Real route -> capability -> loop -> serialized provider request. Only storage and provider transport are doubled.
 * The saved construction replay reaches the SAME post-build projection as a new construction, without a second build/Run.
 * The link fixture is the saved G2 4de96a0a pair (01-02-range.json), not an invented provenance expectation.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capture, array, object, type Obj } from './provider-harness.js';
import { constructionOperationId } from '../../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../../orchestrator-v5/graph-registration/registration-identity.js';

const fx = JSON.parse(readFileSync(new URL('../../../orchestrator-v5/agent-lane/__tests__/fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as Obj;
const savedLink = JSON.parse(readFileSync(new URL('./fixtures/capacity-link-4de96a0a.json', import.meta.url), 'utf8')) as Obj;
const brief = String(fx.brief);
const rows = [
  { name: 'user', stamp: { source: 'brief_extraction', magnitude: 'user_stated' }, whose: 'yours', sizing: 'user' },
  { name: 'olumi', stamp: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, whose: 'olumi', sizing: 'olumi_estimate' },
  { name: 'accepted-olumi', stamp: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } }, whose: 'olumi_accepted', sizing: 'olumi_accepted' },
  { name: 'unknown', stamp: { source: 'unrecognised' }, whose: 'unknown', sizing: 'unmarked' },
  { name: 'third-party', stamp: { source: 'unverified_brief', source_quote: 'The supplier says each additional specialist resolves about 20 tickets per week, between 10 and 30.' }, whose: 'unknown', sizing: 'unmarked' },
] as const;

describe('bound link facts in the actual build continuation request', () => {
  it.each(rows)('$name keeps the figure, range, quote, directed pair and its own author', async row => {
    const graph = structuredClone(object(fx.stored_graph));
    const edge = { ...structuredClone(savedLink), provenance: {
      natural_effect: structuredClone(object(savedLink.provenance).natural_effect),
      source_quote: object(savedLink.provenance).source_quote, ...row.stamp } };
    // Same figure, another directed link, another author. It must never inherit this link's origin by number matching.
    const other = { ...structuredClone(savedLink), from: 'existing_team_capacity', to: 'additional_specialist_capacity',
      provenance: { ...object(savedLink.provenance), source: 'cee_hypothesis', magnitude: 'olumi_estimate',
        source_quote: 'Olumi estimates another 20 tickets per week for this separate relationship.' } };
    graph.edges = [...array(graph.edges).filter(e => object(e).from !== savedLink.from), edge, other];
    const w = await capture('ordinary-converse', 'run2', {
      evidenceLabel: `build-link-origin-${row.name}`, expectedCalls: 2,
      payload: { message: brief },
      storage: { readExistingScenario: async () => ({ userId: null, graph, briefText: brief, revision: 1 }) },
      readSnapshot: async () => ({ graph, graph_hash: 'saved-capacity', brief_text: brief,
        analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } } }),
      storageRoutes: async app => {
        app.post('/assist/v1/scenarios/:scenario/versions', async req => {
          const scenario = String(object(req.params).scenario);
          return { versions: [{ version_id: 'a4a4a4a4-0000-4a4a-8a4a-a4a4a4a4a4a4', sequence: 1,
            creation: { kind: 'construction', source_turn_id: registrationTurnId(scenario, constructionOperationId(scenario, brief)) } }] };
        });
      },
      providerReply: (_body, index) => ({ status: 'completed', output: index === 1
        ? [{ type: 'function_call', name: 'build_model_from_brief', call_id: 'bound-link-build', arguments: JSON.stringify({ brief }) }]
        : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Offline continuation.' }] }] }),
    });
    const outputs = array(w.calls[1]!.body.input).map(object).filter(i => i.type === 'function_call_output' && i.call_id === 'bound-link-build');
    expect(outputs).toHaveLength(1);
    const built = object(JSON.parse(String(outputs[0]!.output)));
    expect(built).toMatchObject({ ok: true, replayed: true, mutated: false });
    const links = array(built.links).map(object);
    const bound = links.find(l => l.from === savedLink.from && l.to === savedLink.to);
    expect(bound).toMatchObject({ sizing: row.sizing, natural_effect: {
      amount: 20, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'specialists',
      stated_range: { low: 10, high: 30, end: 'centre', text: 'between 10 and 30' },
      whose: row.whose, source_quote: object(edge.provenance).source_quote,
    } });
    expect(links.find(l => l.from === other.from && l.to === other.to)).toMatchObject({
      natural_effect: { amount: 20, whose: 'olumi', source_quote: object(other.provenance).source_quote },
    });
  }, 60_000);
});
