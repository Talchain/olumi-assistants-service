/**
 * AN OPTION'S LINK TO A FACTOR SAYS WHOSE LEVEL IT CARRIES (DL #70 5845493088, revised 5845538501: SOURCE ONLY).
 *
 * An Olumi level on an added option (`source: 'cee_hypothesis'`, #1975's rule) was written with an option → factor
 * edge stamped `user_specified`: the link told every reader of edge provenance that the user had set it. The edge
 * now follows its level: an Olumi level's link is `cee_hypothesis`, a user level's link is `user_specified` (today's
 * bytes). It stays a TOPOLOGY edge — `STRUCTURAL_EDGE_DEFAULTS`, and never `defaulted`, which every reader takes to
 * mean "a causal strength this system chose" (the coaching nudge `edge_strength_defaulted`, the Agent's canonical
 * state, admissibility's projection count).
 *
 * The graph is Paul's served pricing graph (DL browser bf-20260926T101424Z, turn 1). The levels are this spec's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildAddOptionTransaction, buildAddOptionsTransaction, structuralEdgeValue } from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-same-levels-option.bf-101424.json', import.meta.url), 'utf8'),
) as { graph: Json; _provenance: { decision_id: string } };
const GRAPH = SERVED.graph;
const DECISION = SERVED._provenance.decision_id;
const PRICE = 'pro_plan_price';
const AI = 'ai_feature_release_value';

function built(interventions: Json[], label = 'Raise Pro to £57'): Json {
  const r = buildAddOptionTransaction({ parent_decision_id: DECISION, label, interventions }, GRAPH as never);
  if (!r.matched) throw new Error(`not built: ${r.reason}`);
  return r.proposal as Json;
}
const edgeTo = (proposal: Json, to: string): Json =>
  proposal.operations.find((o: Json) => o.op === 'add_edge' && o.value.from === proposal.optionId && o.value.to === to).value;

describe('⭐ the option → factor link follows its level\'s source', () => {
  it('⭐ an Olumi level\'s link is Olumi\'s: `cee_hypothesis` — still topology, and never `defaulted`', () => {
    const p = built([{ factor_id: PRICE, value: 0.285, source: 'cee_hypothesis' }]);
    const edge = edgeTo(p, PRICE);
    expect(edge.provenance).toEqual({ source: 'cee_hypothesis' });
    expect(edge).toMatchObject(STRUCTURAL_EDGE_DEFAULTS);
    expect('defaulted' in edge).toBe(false);
  });

  it('CONTRAST: a user level\'s link is byte-identical to today\'s (`user_specified`)', () => {
    const p = built([{ factor_id: PRICE, value: 0.285 }]);
    expect(edgeTo(p, PRICE)).toEqual(structuralEdgeValue(p.optionId, PRICE));
    expect(edgeTo(p, PRICE).provenance).toEqual({ source: 'user_specified' });
  });

  it('each link follows ITS OWN level — one Olumi level, one user level, on one option', () => {
    const p = built([
      { factor_id: PRICE, value: 0.285, source: 'user_specified' },
      { factor_id: AI, value: 0.4, source: 'cee_hypothesis' },
    ]);
    expect(edgeTo(p, PRICE).provenance).toEqual({ source: 'user_specified' });
    expect(edgeTo(p, AI).provenance).toEqual({ source: 'cee_hypothesis' });
  });

  it('a link with no level and no source is the user\'s, as today', () => {
    const p = built([{ factor_id: PRICE, value: 0.285, source: 'cee_hypothesis' }, { factor_id: AI, value: null }]);
    expect(edgeTo(p, AI)).toEqual(structuralEdgeValue(p.optionId, AI));
  });

  it('the decision → option link is unchanged: the user approves the option itself', () => {
    const p = built([{ factor_id: PRICE, value: 0.285, source: 'cee_hypothesis' }]);
    const link = p.operations.find((o: Json) => o.op === 'add_edge' && o.value.to === p.optionId).value;
    expect(link).toEqual(structuralEdgeValue(DECISION, p.optionId));
  });

  it('a batch stamps each option\'s links from its own levels', () => {
    const r = buildAddOptionsTransaction(
      {
        parent_decision_id: DECISION,
        options: [
          { label: 'Olumi at £57', interventions: [{ factor_id: PRICE, value: 0.285, source: 'cee_hypothesis' }] },
          { label: 'Yours at £61', interventions: [{ factor_id: PRICE, value: 0.305 }] },
        ],
      },
      GRAPH as never,
    ) as Json;
    expect(r.matched).toBe(true);
    const [olumi, yours] = r.proposals as Json[];
    expect(edgeTo(olumi!, PRICE).provenance).toEqual({ source: 'cee_hypothesis' });
    expect(edgeTo(yours!, PRICE).provenance).toEqual({ source: 'user_specified' });
  });
});

describe('⭐ it lands that way through the held rail and the real confirm', () => {
  it('⭐ approved: the persisted link is `cee_hypothesis`, with no `defaulted`', () => {
    const stored = projectGraphForPersistence(structuredClone(GRAPH) as never) as Json;
    const hash = computeAnalysisAffectingGraphHash(stored as never)!;
    const out = dispatchAddOptionTransaction({
      parameters: { parent_decision_id: DECISION, label: 'Raise Pro to £57', interventions: [{ factor_id: PRICE, value: 0.285, source: 'cee_hypothesis' }] },
      currentGraph: stored, currentGraphHash: hash, freshness: 'none', mode: 'live',
      scenarioId: 'scn-link-source', turnId: 'turn-propose', requestId: 'req-propose', stage: 'frame',
    } as never) as Json;
    expect(out.kind).toBe('held');
    const read = readGmHeldResume(out.pendingActions[0]) as Json;
    const executed = executeGmHeldResume({
      operations: read.operations, ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
      currentGraph: stored, currentGraphHash: hash, freshness: 'none', hasExistingAnalysis: false,
      scenarioId: 'scn-link-source', turnId: 'turn-confirm', requestId: 'req-confirm',
    }) as Json;
    expect(executed.status).toBe('executed');
    const option = (executed.mutatedGraph.nodes as Json[]).find((n) => n.label === 'Raise Pro to £57')!;
    const edge = (executed.mutatedGraph.edges as Json[]).find((e) => e.from === option.id && e.to === PRICE)!;
    expect(edge.provenance?.source).toBe('cee_hypothesis');
    expect('defaulted' in edge).toBe(false);
  });
});
