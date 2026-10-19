/**
 * ⭐ v6.0 PR-2 (served G2 1253187a, C5 trace): the user's "about 20 … between 10 and 30" per specialist was held on the link's
 * statement while the link itself stayed Olumi's placeholder (the draft left its size null). The link's size is now DERIVED from its
 * current claim (`withClaimLinkSizes`): the user's verified range around a central figure the quote writes sizes the link per ONE of
 * its source, through the ONE existing sizing path, so it is stamped exactly as a drafted size of the same figure (side by side).
 * Never an end or a midpoint, never another speaker's figure, never a figure the words do not write. SYNTHETIC brief.
 * Real path: `buildModelFromBrief` (scripted drafter) → admission → `/graph/register` → the stored edge as a reload reads it.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { EdgeV3 } from '../../../schemas/cee-v3.js';
import { withClaimLinkSizes } from '../construction-source-map.js';
import { userStatementFor } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const LEVEL = 'Our repair desk fixes 60 faults a week today.';
const TARGET = 'We need to fix at least 75 faults a week.';
const EFFECT = 'Each extra technician fixes about 12 faults a week, between 8 and 16.';
const BRIEF = `${LEVEL} ${TARGET} We could hire one more technician or keep the team as it is. ${EFFECT}`;
const GOAL = 'Weekly faults fixed';
const SOURCE = 'Extra technicians';
type Effect = { readonly value: number | null; readonly low: number; readonly high: number; readonly unit: string; readonly speaker?: string };
const CLAIM: Effect = { value: 12, low: 8, high: 16, unit: 'faults per week per technician' };

function draft(effect: Effect | null, drafted: number | null = null): Rec {
  const stmt = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string, extra: Rec = {}): Rec => ({ quote,
    subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null,
    conditions: null, ...extra });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 75, unit: 'faults per week', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 60, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
      basis: null, source_quote: TARGET, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep the team as it is', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Hire one more technician', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: SOURCE, value: 1, value_kind: 'absolute', unit: 'technicians', provenance: 'explicit' }] },
    ],
    factors: [{ label: SOURCE, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'technicians', provenance: 'inferred', plausible_max: 10 }],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [{ from: SOURCE, to: GOAL, direction: 'positive', provenance: 'explicit', effect_amount: drafted, effect_per_source_change: drafted === null ? null : 1,
      effect_provenance: drafted === null ? null : 'explicit', definitional: null, basis: null, source_quote: EFFECT }],
    statements: [
      stmt(LEVEL, { kind: 'goal', label: GOAL }, 'level', 'point', { value: 60 }, 'faults per week'),
      stmt(TARGET, { kind: 'goal', label: GOAL }, 'target', 'lower_bound', { value: 75 }, 'faults per week'),
      ...(effect === null ? [] : [stmt(EFFECT, { kind: 'link', label: SOURCE, to_label: GOAL }, 'effect', 'range',
        { value: effect.value, low: effect.low, high: effect.high }, effect.unit, { qualifier: 'about', ...(effect.speaker !== undefined ? { speaker: effect.speaker } : {}) })]),
    ],
  };
}

async function built(wire: Rec, brief = BRIEF): Promise<{ edge: Rec; graph: Rec }> {
  let registered: { nodes: Rec[]; edges: Rec[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire), status: 'completed' })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Rec[]; edges: Rec[] } }).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c1a1c1a1-0000-4000-8000-00000000c1a1', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 1500)).toBe(true);
  const g = registered!;
  const idOf = (l: string) => g.nodes.find((n) => n.label === l)!.id;
  return { edge: EdgeV3.parse(g.edges.find((e) => e.from === idOf(SOURCE) && e.to === idOf(GOAL))!) as Rec, graph: g as unknown as Rec };
}
const edgeOf = async (wire: Rec): Promise<Rec> => (await built(wire)).edge;

describe('v6.0 PR-2: a link\'s size is derived from its current claim', () => {
  it('NEGATIVE (the drafter\'s own central figure, written ELSEWHERE in the brief): only the claim\'s own quote can give it', async () => {
    const elsewhere = `${BRIEF} Each technician also fixes about 11 faults a week on the old system.`;
    const { edge } = await built(draft({ ...CLAIM, value: 11 }), elsewhere);
    expect(edge.provenance?.magnitude).toBe('olumi_placeholder');
    expect(edge.provenance?.natural_effect).toBeUndefined();
  });
  it('⭐ G2 shape: the draft leaves the link unsized; the user\'s "about 12, between 8 and 16" per technician sizes it, as the user\'s', async () => {
    const { edge, graph } = await built(draft(CLAIM));
    expect(edge.provenance).toMatchObject({ magnitude: 'user_stated' });
    expect(edge.provenance.natural_effect).toMatchObject({ amount: 12, per_source_change: 1, amount_unit: 'faults per week' });
    // The claim itself stays whole on the link, the user's range with it (the same record construction always wrote).
    const record = userStatementFor(graph, { kind: 'link', id: edge.from, to_id: edge.to, field: 'effect' });
    expect(record?.statements).toEqual([expect.objectContaining({ speaker: 'user', form: 'range', low: 8, high: 16, quote: EFFECT })]);
  });
  it('⭐ SIDE BY SIDE: the derived size is stamped exactly as a drafted size of the same figure (no reader sees a difference)', async () => {
    const derived = await edgeOf(draft(CLAIM));
    const drafted = await edgeOf(draft(CLAIM, 12));
    expect(derived).toEqual(drafted);
  });
  it('SIDE BY SIDE (pure): a link the draft already sized, or any link without a usable claim, is returned as the SAME object', () => {
    const model = draft(CLAIM, 12);
    const [link] = withClaimLinkSizes(model as never, BRIEF);
    expect(link).toBe(model.links[0]);
    const bare = draft(null);
    expect(withClaimLinkSizes(bare as never, BRIEF)[0]).toBe(bare.links[0]);
  });
  it.each([
    ['a range with no central figure (never a midpoint)', { ...CLAIM, value: null }],
    ['another speaker\'s figure (never the user\'s)', { ...CLAIM, speaker: 'other' }],
    ['a central figure the words do not write (the drafter\'s own number)', { ...CLAIM, value: 11 }],
    ['a unit that is not per one of the source', { ...CLAIM, unit: 'faults per week' }],
  ] as const)('NEGATIVE (%s): the link stays Olumi\'s placeholder, never the user\'s size', async (_n, effect) => {
    const edge = await edgeOf(draft(effect as Effect));
    // No size from the claim at all: neither the user's nor a figure passed to Olumi's estimate path.
    expect(edge.provenance?.magnitude).toBe('olumi_placeholder');
    expect(edge.provenance?.natural_effect).toBeUndefined();
  });
});
