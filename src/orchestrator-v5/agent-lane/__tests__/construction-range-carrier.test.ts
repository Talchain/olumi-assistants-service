/**
 * ⛔ A FACTOR'S RANGE MUST LIVE WHERE EVERY LATER WRITER READS IT.
 *
 * MEASURED on deployed staging 29ffda8a (Paul's own test, 22 Sep 23:22Z,
 * scenario 450acd25). "Hire Two Developers" was built with its level divided by
 * the factor's construction range, and the range was written as an UNDECLARED
 * node-level `cap`. Nothing reads that field, and CEE's own `NodeV3` strips it
 * on every parse (the edit seam parses first). When the user later adopted
 * "5 FTE", the value writer saw no frame, wrote the bare amount, and the
 * adoption path then derived a SECOND frame from that figure (0 to 10). The
 * option's level stayed on the first frame and the baseline landed on the
 * second, so "hire two developers" read as shrinking the team. In the replay
 * (repro/FINDINGS.md, turns 3-4) the Agent also refused to state levels at all,
 * because its own reader looked for the range in `observed_state` only.
 *
 * The declared carrier is `scale_frame` (`schemas/cee-v3.ts`). It is the
 * divisor the draft's pass 3d writes on every framed factor, including one
 * with no baseline, and the value writer honours it (`normalise-factor-value.ts`,
 * "FRAMED"). These tests EXECUTE the real construction capability and the real
 * `factor_value_edit` handler; the only double is the product's storage.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const SCENARIO = '22222222-2222-4222-8222-222222222222';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-range' };

/** Paul's decision, shaped the way the builder returns it. No baseline is known for either factor. */
const HIRING = {
  goal: { metric: 'Delivery velocity', operator: '>=', value: 30, unit: 'points per sprint', horizon_months: 6, provenance: 'inferred' },
  constraints: [],
  options: [
    { label: 'Hire Two Developers', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Developer headcount', value: 7, unit: 'FTE', provenance: 'inferred' }] },
    { label: 'Hire a Tech Lead', provenance: 'explicit', changes: [],
      interventions: [{ factor_label: 'Tech leads hired', value: 1, unit: 'FTE', provenance: 'explicit' }] },
  ],
  factors: [
    { label: 'Developer headcount', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'FTE', provenance: 'inferred', plausible_max: 100 },
    { label: 'Tech leads hired', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'FTE', provenance: 'inferred', plausible_max: 10 },
  ],
  risks: [],
  outcomes: [],
  links: [
    { from: 'Developer headcount', to: 'Delivery velocity', direction: 'positive', provenance: 'inferred' },
    { from: 'Tech leads hired', to: 'Delivery velocity', direction: 'positive', provenance: 'inferred' },
  ],
  unknowns: [],
};

type StoredNode = {
  id: string; kind: string; label: string;
  observed_state?: { value?: number; raw_value?: number; cap?: number; unit?: string; source?: string };
  interventions?: Record<string, { value: number } | number>;
  scale_frame?: number;
  cap?: number;
};
type Stored = { nodes: StoredNode[]; edges: unknown[] };

/**
 * The product's storage, and nothing else. Registration stores what it is
 * sent (measured: a node-level `cap` survived it on staging). A value edit
 * runs through the REAL `applyFactorValueEdit`, which parses the stored graph
 * with CEE's `GraphV3` exactly as the served handler does.
 */
function product() {
  let graph: Stored = { nodes: [], edges: [] };
  let rev = 0;
  const edits: { kind: string; detail?: string }[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((b as { graph: Stored }).graph);
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const event = b.event as { kind: 'factor_value_edit'; target_id: string; value: number; unit?: string };
      const result = await applyFactorValueEdit({
        payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: String(b.turn_id), stage: 'frame', event } as never,
        event: event as never,
        requestId: 'range-carrier',
        persistedGraph: graph,
        priorFacts: [],
      } as never);
      edits.push({ kind: result.kind, detail: result.kind === 'mutated' ? undefined : result.response?.assistant_text });
      if (result.kind !== 'mutated') return { status: 422, json: {} };
      graph = structuredClone(result.graph) as unknown as Stored;
      rev += 1;
      return { status: 200, json: {} };
    }
    return { status: 200, json: { graph, graph_hash: `h${rev}` } };
  };
  const node = (label: string) => graph.nodes.find((n) => n.label === label)!;
  const level = (option: string, factor: string) => {
    const iv = node(option).interventions?.[node(factor).id];
    return typeof iv === 'number' ? iv : iv?.value;
  };
  return { d, edits, node, level, graph: () => graph };
}

const structured = (payload: unknown): CallStructuredModel => async () => ({ text: JSON.stringify(payload) });

async function built() {
  const p = product();
  const caps = createAgentCapabilities(p.d, new ProposalStore(), structured(HIRING));
  const r = await caps.buildModelFromBrief(ctx, { brief: 'Should I hire a Tech lead or two developers to increase velocity?' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { p, caps };
}

async function adopt(caps: ReturnType<typeof createAgentCapabilities>, factor_label: string, value: number) {
  const proposed = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label, value, unit: 'FTE', basis: 'the user said so' }] });
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  return caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
}

describe('construction stores a factor range where the product reads it', () => {
  it('writes the range as the declared scale_frame, which survives the run-path parse', async () => {
    const { p } = await built();
    const f = p.node('Developer headcount');
    expect(f.observed_state, 'no baseline was known, so none may be written').toBeUndefined();
    expect(f.scale_frame).toBe(100);
    // An undeclared field is a range nothing will ever read.
    expect(f).not.toHaveProperty('cap');
    const parsed = GraphV3.parse(p.graph());
    expect(parsed.nodes.find((n) => n.id === f.id)?.scale_frame).toBe(100);
    // The level the option sets was divided by that same range.
    expect(p.level('Hire Two Developers', 'Developer headcount')).toBeCloseTo(7 / 100, 12);
  });

  it('a value the user gives LATER is read against the construction range, through the real edit handler', async () => {
    const { p, caps } = await built();
    const r = await adopt(caps, 'Developer headcount', 5);
    expect(r.ok, JSON.stringify({ r, edits: p.edits })).toBe(true);
    const os = p.node('Developer headcount').observed_state!;
    expect(os.raw_value).toBe(5);
    expect(os.value).toBeCloseTo(5 / 100, 12);
    // No second range was invented from the user's figure.
    expect(r).not.toHaveProperty('ranges_added_for_analysis');
    // ⭐ THE PAIR IS COHERENT: 7 hired-to over 5 today is 1.4, on the model scale too.
    // Paul's session had 0.02 beside 0.5 here, which reads as hiring shrinking the team.
    expect(p.level('Hire Two Developers', 'Developer headcount')! / os.value!).toBeCloseTo(7 / 5, 9);
  });

  it('keeps an honest level above the range rather than inventing a new range for it', async () => {
    const { p, caps } = await built();
    const r = await adopt(caps, 'Developer headcount', 150);
    expect(r.ok, JSON.stringify({ r, edits: p.edits })).toBe(true);
    const os = p.node('Developer headcount').observed_state!;
    expect(os.raw_value).toBe(150);
    expect(os.value).toBeCloseTo(1.5, 12);
    expect(r).not.toHaveProperty('ranges_added_for_analysis');
    expect(p.node('Developer headcount').scale_frame).toBe(100);
  });
});

describe("the Agent's own option-level reader honours the same range", () => {
  it('reads a level in the user’s units against the stored range, not one derived from the figure', async () => {
    const { caps } = await built();
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Hire a Tech Lead', factor_label: 'Developer headcount', value: 6, basis: 'the lead replaces one developer' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [iv] = r.interventions as { recorded_on_model_scale: number; model_range: number | null; range_taken_from_your_figure?: number }[];
    expect(iv.model_range).toBe(100);
    expect(iv.recorded_on_model_scale).toBeCloseTo(6 / 100, 12);
    expect(iv).not.toHaveProperty('range_taken_from_your_figure');
  });
});
