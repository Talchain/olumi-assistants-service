/**
 * (A) — several options in ONE typed add-option transaction: one disclosed
 * batch, one hold, one approval, one write. Canonical CONTRACT #70 5841241418.
 *
 * WHY THIS EXISTS. The Agent's F4 ("add these two options") could only land one
 * option per approval: the referee caps a batch at `PROPOSAL_CAP` (8) envelopes,
 * and one option is already `2 + factors` ops. Two options with three factors
 * each is 10. Folding them into separate holds would split one decision into
 * several consents and several writes — the opposite of what ChatGPT's A2 asks.
 *
 * THE CONTRACT, pinned below by identity:
 *   1. `chip.parameters.options: [...]` builds ONE batch (each option validated
 *      against the graph PLUS the options before it), refereed as ONE hold.
 *   2. The cap is RAISED ONLY for CEE-built typed transactions, RECORDED on the
 *      hold, and the SAME cap is used at confirm and at thread-through. A
 *      model-produced batch keeps `PROPOSAL_CAP`.
 *   3. All-or-nothing: one invalid option → no hold at all.
 *   4. A batch the hold cannot carry (too many options, or a payload past the
 *      JSON cap) is REFUSED at propose, with a sentence — never a hold whose
 *      "yes" would silently decline.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { dispatchAddOptionTransaction } from '../add-option-dispatch.js';
import {
  assessHeldBatchAgainstGraph,
  evaluateEditGraphMutations,
  GM_HELD_HANDLER_ID,
} from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { PROPOSAL_CAP, TYPED_TRANSACTION_ENVELOPE_CAP } from '../../graph-management/types.js';
import { MAX_OPTIONS_PER_TRANSACTION } from '../../routing/add-option-transaction.js';
import type { PendingAction } from '../../session/pending-action.js';
import * as telemetry from '../../../utils/telemetry.js';

const GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort', observed_state: { value: 0.4 } },
    { id: 'fac_uplift', kind: 'factor', label: 'Capability uplift', observed_state: { value: 0.3 } },
    {
      id: 'opt_stay',
      kind: 'option',
      label: 'Stay',
      interventions: {
        fac_effort: {
          value: 0.1,
          source: 'user_specified',
          target_match: { node_id: 'fac_effort', match_type: 'exact_id', confidence: 'high' },
        },
      },
    },
  ],
  edges: [
    { from: 'fac_effort', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_uplift', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'dec_choice', to: 'opt_stay', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_effort', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const option = (label: string, effort: number | null, uplift: number | null) => ({
  label,
  interventions: [
    { factor_id: 'fac_effort', value: effort },
    { factor_id: 'fac_uplift', value: uplift },
  ],
});

// 3 options × (node + decision edge + 2 factor edges) = 12 envelopes > PROPOSAL_CAP.
const THREE = {
  parent_decision_id: 'dec_choice',
  options: [option('Outsource', 0.55, 0.7), option('Hire in-house', 0.8, 0.6), option('Partner', 0.3, null)],
};

const base = {
  currentGraph: GRAPH,
  currentGraphHash: hashOf(GRAPH),
  freshness: 'none' as const,
  mode: 'live' as const,
  scenarioId: 'scn-multi',
  turnId: 'turn-multi',
  requestId: 'req-multi',
  stage: 'decide' as const,
};

const inlinePatchOf = (p: PendingAction): Record<string, unknown> =>
  (p.action as { inline_patch: Record<string, unknown> }).inline_patch;

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('(A) several options, ONE hold', () => {
  it('PRECONDITION: the batch really exceeds the model-batch cap', () => {
    expect(3 * 4).toBeGreaterThan(PROPOSAL_CAP);
    expect(3 * 4).toBeLessThanOrEqual(TYPED_TRANSACTION_ENVELOPE_CAP);
  });

  it('holds ONE pending carrying every option, and records the cap it was refereed under', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    expect(out.kind).toBe('held');
    if (out.kind !== 'held') return;
    expect(out.pendingActions).toHaveLength(1);
    expect(out.options.map((o) => o.optionLabel)).toEqual(['Outsource', 'Hire in-house', 'Partner']);
    const patch = inlinePatchOf(out.pendingActions[0]!);
    expect(patch.handler_id).toBe(GM_HELD_HANDLER_ID);
    expect(patch.operations).toHaveLength(12);
    expect(patch.envelope_cap).toBe(TYPED_TRANSACTION_ENVELOPE_CAP);
    // Distinct ids, each derived against the graph PLUS the options before it.
    expect(new Set(out.options.map((o) => o.optionId)).size).toBe(3);
  });

  it('CONFIRM applies every option, its decision link and its values in ONE apply', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    if (out.kind !== 'held') throw new Error(`expected held, got ${out.kind}`);
    const read = readGmHeldResume(out.pendingActions[0]!);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.envelopeCap).toBe(TYPED_TRANSACTION_ENVELOPE_CAP);

    const outcome = executeGmHeldResume({
      operations: read.operations,
      envelopeCap: read.envelopeCap,
      currentGraph: GRAPH,
      currentGraphHash: base.currentGraphHash,
      freshness: 'none',
      hasExistingAnalysis: false,
      scenarioId: base.scenarioId,
      turnId: base.turnId,
      requestId: base.requestId,
    });
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const edges = new Set(outcome.appliedGraph.edges.map((e) => `${e.from}->${e.to}`));
    for (const o of out.options) {
      const node = outcome.appliedGraph.nodes.find((n) => n.id === o.optionId) as
        | { kind: string; interventions?: Record<string, { value?: number }> }
        | undefined;
      expect(node?.kind).toBe('option');
      expect(edges.has(`dec_choice->${o.optionId}`)).toBe(true);
      expect(edges.has(`${o.optionId}->fac_effort`)).toBe(true);
    }
    const outsource = outcome.appliedGraph.nodes.find((n) => n.id === out.options[0]!.optionId) as {
      interventions: Record<string, { value?: number }>;
    };
    expect(outsource.interventions.fac_uplift!.value).toBe(0.7);
  });

  it('CONTRAST: the same hold confirmed WITHOUT its recorded cap is declined, never partly applied', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    if (out.kind !== 'held') throw new Error(`expected held, got ${out.kind}`);
    const read = readGmHeldResume(out.pendingActions[0]!);
    if (read.kind !== 'ok') throw new Error('expected ok');
    const outcome = executeGmHeldResume({
      operations: read.operations,
      currentGraph: GRAPH,
      currentGraphHash: base.currentGraphHash,
      freshness: 'none',
      hasExistingAnalysis: false,
      scenarioId: base.scenarioId,
      turnId: base.turnId,
      requestId: base.requestId,
    });
    expect(outcome.status).toBe('referee_blocked');
  });

  it('THREAD-THROUGH judges the hold under its recorded cap (a moved graph must not lapse it for size)', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    if (out.kind !== 'held') throw new Error(`expected held, got ${out.kind}`);
    const read = readGmHeldResume(out.pendingActions[0]!);
    if (read.kind !== 'ok') throw new Error('expected ok');
    const common = {
      operations: read.operations,
      currentGraph: GRAPH,
      currentGraphHash: base.currentGraphHash,
      scenarioId: base.scenarioId,
      turnId: base.turnId,
      requestId: base.requestId,
    };
    expect(assessHeldBatchAgainstGraph({ ...common, envelopeCap: read.envelopeCap }).valid).toBe(true);
    expect(assessHeldBatchAgainstGraph(common).valid).toBe(false);
  });

  it('a MODEL-produced batch keeps PROPOSAL_CAP: the same 12 ops without a typed cap are rejected at propose', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    if (out.kind !== 'held') throw new Error(`expected held, got ${out.kind}`);
    const ops = inlinePatchOf(out.pendingActions[0]!).operations as never[];
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: ops,
      currentGraph: GRAPH,
      currentGraphHash: base.currentGraphHash,
      baseGraphHash: base.currentGraphHash,
      freshness: 'none',
      scenarioId: base.scenarioId,
      turnId: base.turnId,
      requestId: base.requestId,
      dispatchPath: 'edit_graph',
    });
    expect(decision.governing).toBe('rejected');
  });
});

describe('(A) each option is built against the graph PLUS the options before it', () => {
  it('two entries with the same label get DISTINCT ids and are held together', () => {
    const out = dispatchAddOptionTransaction({
      ...base,
      parameters: { parent_decision_id: 'dec_choice', options: [option('Outsource', 0.5, 0.5), option('Outsource', 0.4, 0.4)] },
    });
    expect(out.kind).toBe('held');
    if (out.kind !== 'held') return;
    const ids = out.options.map((o) => o.optionId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]!.startsWith(ids[0]!)).toBe(true);
  });
});

describe('(A) all-or-nothing, and a batch the hold cannot carry is refused at propose', () => {
  it('one invalid option → no hold for any of them', () => {
    const out = dispatchAddOptionTransaction({
      ...base,
      parameters: {
        parent_decision_id: 'dec_choice',
        options: [option('Outsource', 0.5, 0.5), { label: 'Ghost', interventions: [{ factor_id: 'fac_missing', value: 0.2 }] }],
      },
    });
    expect(out.kind).toBe('skip');
    if (out.kind !== 'skip') return;
    expect(out.reason).toBe('factor_not_found');
  });

  it(`more than ${MAX_OPTIONS_PER_TRANSACTION} options → refused with a sentence, no pending`, () => {
    const many = Array.from({ length: MAX_OPTIONS_PER_TRANSACTION + 1 }, (_, i) => option(`Route ${i + 1}`, 0.5, null));
    const out = dispatchAddOptionTransaction({ ...base, parameters: { parent_decision_id: 'dec_choice', options: many } });
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.reason).toBe('too_many_options');
    expect(out.response.assistant_text).toContain(String(MAX_OPTIONS_PER_TRANSACTION));
    expect(out.response.suggested_actions).toEqual([]);
  });

  it('a payload past the hold JSON cap → refused at propose, never a hold whose "yes" would decline', () => {
    const long = (n: number) => `Option ${n} ${'with a very long description '.repeat(150)}`;
    const out = dispatchAddOptionTransaction({
      ...base,
      parameters: { parent_decision_id: 'dec_choice', options: [option(long(1), 0.5, 0.5), option(long(2), 0.4, 0.4)] },
    });
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.reason).toBe('payload_too_large');
  });

  it('a recorded cap is BOUNDED: a persisted value above the typed ceiling reads as the ceiling, below the default as absent', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: THREE });
    if (out.kind !== 'held') throw new Error(`expected held, got ${out.kind}`);
    const p = out.pendingActions[0]!;
    const withCap = (cap: unknown): PendingAction =>
      ({ ...p, action: { ...p.action, inline_patch: { ...inlinePatchOf(p), envelope_cap: cap } } }) as PendingAction;
    const high = readGmHeldResume(withCap(10_000));
    const low = readGmHeldResume(withCap(3));
    const junk = readGmHeldResume(withCap('32'));
    expect(high.kind === 'ok' && high.envelopeCap).toBe(TYPED_TRANSACTION_ENVELOPE_CAP);
    expect(low.kind === 'ok' && low.envelopeCap).toBeUndefined();
    expect(junk.kind === 'ok' && junk.envelopeCap).toBeUndefined();
  });
});
