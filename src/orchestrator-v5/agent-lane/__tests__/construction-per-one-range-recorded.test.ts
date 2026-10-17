/**
 * ⭐ A3 (design spec v2.1 row A1/A3; DL-3 12:42Z; AIE: "a range is not a calibrated spread"): both LOW-end producers are retired.
 * A money size the brief states PER ONE of something, as a RANGE, keeps its countable and its per-one link, and the range is
 * recorded on that link with NO size: never one of its ends, never a middle. The draft that records it is complete, so the repair
 * retry is not asked for it again. SYNTHETIC brief.
 * Real path: `buildModelFromBrief` (scripted drafter) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { linkHoldsStatedRange } from '../../statement-door/statements.js';

/** The notes and issues ride the drafter's input JSON-encoded: a fragment as it appears there. */
const sent = (words: string): string => JSON.stringify(words).slice(1, -1);

type Rec = Record<string, any>;
const AIM = 'We need to bring in at least £600k of new contract value this year.';
const SIZE = 'Our broker says each contract we sign is worth between £40k and £60k.';
const BRIEF = `${AIM} ${SIZE} We could hire a second salesperson or start a referral scheme.`;
const GOAL = 'New contract value';
const COUNT = 'Contracts signed';

function draft(withRange: 'recorded' | 'denied' | 'none'): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 600000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Hire a second salesperson', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Salespeople', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Salespeople', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'people', provenance: 'inferred', plausible_max: 5 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: COUNT, provenance: 'inferred', unit: 'contracts', plausible_max: 30 }],
    // The per-one link is kept, with no size: the range is not one size.
    links: [link('Salespeople', COUNT), { ...link(COUNT, GOAL), provenance: 'explicit' }],
    statements: [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 600000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      ...(withRange === 'none' ? [] : [{ quote: SIZE, subject: { kind: 'link', label: COUNT, to_label: GOAL, factor_label: null }, field: 'effect', form: 'range',
        value: null, low: 40000, high: 60000, unit: '£', qualifier: null, conditions: null, ...(withRange === 'denied' ? { negated: true } : {}) }]),
    ],
  };
}
async function build(drafts: readonly Rec[]) {
  let body: unknown = null;
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a3a3a3a3-0000-4a3a-8a3a-a3a3a3a3a3a3', BRIEF, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Rec, raw: body as Rec, inputs };
}
const ends = (g: Rec): { from: string; to: string } => ({ from: g.nodes.find((n: Rec) => n.label === COUNT).id, to: g.nodes.find((n: Rec) => n.kind === 'goal').id });

describe('A3: a per-one range is recorded on its link, never sized at an end', () => {
  it('the first construct\'s note asks the per-one rule with the range recorded and no size; no "LOW end" anywhere', () => {
    const input = firstConstructInput(BRIEF);
    expect(input).toContain(sent('retain "£40k and £60k" as the complete stated effect range in statements on that directed link'));
    expect(input).toContain(sent('Leave the point size null unless a separately supported point size is supplied.'));
    expect(input).not.toMatch(/LOW end/u);
  });

  it('⭐ RED → GREEN, real build → register: a draft that records the range on the per-one link is complete in ONE call; the link keeps no size of the user\'s', async () => {
    const { graph, raw, inputs } = await build([draft('recorded')]);
    expect(inputs, 'no retry is asked for a range the draft already holds').toHaveLength(1);
    const { from, to } = ends(graph);
    const edge = graph.edges.find((e: Rec) => e.from === from && e.to === to);
    expect(edge.provenance.magnitude).not.toBe('user_stated');
    expect(edge.provenance.natural_effect?.stated_range).toBeUndefined();
    // The user's range is theirs, on the link, both ends as written.
    expect(linkHoldsStatedRange(raw, from, to)).toBe(true);
    const record = (raw.nodes as Rec[]).find((n) => n.id === from)!.user_statements.find((r: Rec) => r.subject_key === `link|${from}|${to}||effect`);
    expect(record.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: SIZE, form: 'range', low: 40000, high: 60000 })]);
  });

  it('CONTRAST: a draft that holds the range nowhere is still asked it, with the new per-one words', async () => {
    const { inputs } = await build([draft('none'), draft('recorded')]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain(sent('The brief writes "£40k and £60k" and no link in the model carries it.'));
    expect(inputs[1]).toContain(sent('retain "£40k and £60k" as the complete stated effect range in statements on that directed link'));
    expect(inputs[1]).not.toMatch(/LOW end/u);
  });

  it('CONTRAST: a range the AI marks DENIED is not held, so it is still asked', async () => {
    const { inputs } = await build([draft('denied'), draft('recorded')]);
    expect(inputs).toHaveLength(2);
  });
});
