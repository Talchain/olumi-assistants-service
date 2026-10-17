/**
 * ⛔ T1 HOST P05 (pilot 17 Oct, judges/T1-ATTRIBUTION.codex.md; outbox/LANE-A-T1-HOST-MAP.md row 2): a target stated as a CUT
 * ("cut … by 20% from today's 10 days") was drafted −20 on a decreasing change goal. The words write 20, so the verifier refused the
 * statement, the S2 C4 binding found no target sentence, and the current target was dropped ("No target was set …"). The goal's own
 * direction (operator and frame) carries the sign, as a link's does for its range (#3356): its target statements keep the
 * magnitudes the words write. A negative on a level goal, or on an INCREASING change goal (the AI's sign against its own operator),
 * is refused as before. SYNTHETIC brief (never the pilot's words).
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { goalTargetStatements } from '../construction-source-map.js';

type Rec = Record<string, any>;
const METRIC = 'Average delivery time';
const CUT = "Over the next year we need to cut average delivery time by 15% from today's 8 days.";
const BRIEF = `${CUT} We could add a second van or reroute the morning rounds.`;

function draft(o: { readonly frame?: string; readonly operator?: string; readonly value?: number; readonly form?: string; readonly low?: number | null; readonly high?: number | null; readonly quote?: string } = {}): Rec {
  const value = o.value ?? -15;
  return {
    goal: { kind: null, deliverable: null, metric: METRIC, operator: o.operator ?? '<=', target_stated: true, value, unit: 'days', horizon_months: 12,
      provenance: 'explicit', frame: o.frame ?? 'change_rel', baseline_known: true, baseline_value: 8, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: o.quote ?? CUT, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add a second van', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Vans', value: 2, value_kind: 'absolute', unit: 'vans', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Vans', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'vans', provenance: 'inferred', plausible_max: 5 }],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [{ from: 'Vans', to: METRIC, direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [
      { quote: o.quote ?? CUT, subject: { kind: 'goal', label: METRIC, to_label: null, factor_label: null }, field: 'level', form: 'point', value: 8, low: null, high: null, unit: 'days', qualifier: "today's", conditions: null },
      { quote: o.quote ?? CUT, subject: { kind: 'goal', label: METRIC, to_label: null, factor_label: null }, field: 'target', form: o.form ?? 'point',
        value: o.form === 'range' ? null : value, low: o.low ?? null, high: o.high ?? null, unit: '%', qualifier: null, conditions: null },
    ],
  };
}
async function build(model: Rec): Promise<{ goal: Rec; out: Rec; graph: Rec }> {
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c0c0c0c0-0000-4c0c-8c0c-c0c0c0c0c0c0', BRIEF, d, (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 600)).toBe(true);
  return { goal: graph!.nodes.find((n: Rec) => n.kind === 'goal'), out, graph: graph! };
}

describe('a target stated as a cut keeps the magnitude its words write; the goal\'s direction carries the sign', () => {
  it('⭐ RED → GREEN, real path: "cut … by 15% from today\'s 8 days" is the goal\'s current target (−15% of today), the user\'s 15 % recorded', async () => {
    const { goal, out } = await build(draft());
    expect(goal).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.15, goal_direction: '<=' });
    expect((out.not_represented ?? []).some((s: string) => s.startsWith('No target was set'))).toBe(false);
    const record = (goal.user_statements ?? []).find((r: Rec) => r.subject_key.endsWith('||target'));
    expect(record?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: CUT, form: 'point', low: 15, high: 15, unit: '%' })]);
  });

  it('CONTRAST: the same −15 on an INCREASING change goal (the AI\'s sign against its own operator) still binds nothing', async () => {
    const { goal, out } = await build(draft({ operator: '>=' }));
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect((out.not_represented ?? []).some((s: string) => s.startsWith('No target was set'))).toBe(true);
  });

  it('⭐ SWEEP (DL-3 14:28Z, sign relabel): frame × operator × drafted sign × form — a cut binds exactly where the goal\'s own direction is a decrease', () => {
    const wrong: string[] = [];
    const ranged = "Over the next year we need to cut average delivery time by between 10% and 15% from today's 8 days.";
    for (const frame of ['level', 'change_abs', 'change_rel']) for (const operator of ['<=', '<', '>=', '>']) for (const sign of [-1, 1])
      for (const form of ['point', 'upper_bound', 'lower_bound', 'range']) {
        const quote = form === 'range' ? ranged : CUT;
        const m = draft({ frame, operator, value: sign * 15, form, quote, ...(form === 'range' ? { low: sign < 0 ? -15 : 10, high: sign < 0 ? -10 : 15 } : {}) });
        const bound = goalTargetStatements(m, `${quote} We could add a second van.`, sign * 15) ?? [];
        const decreasing = operator === '<=' || operator === '<';
        // The oracle: a positive figure binds as written; a negative only on a decreasing CHANGE goal, by its written magnitude.
        const expected = sign > 0 || (frame !== 'level' && decreasing);
        if ((bound.length > 0) !== expected) wrong.push(`${frame} ${operator} ${sign < 0 ? '−' : '+'} ${form}: ${bound.length > 0 ? 'bound' : 'unbound'}`);
        // A negative bound is a cut's opposite side: "at most −15" (a change) is "at least 15" cut.
        if (bound.length > 0 && sign < 0 && form === 'upper_bound' && bound[0]!.form !== 'lower_bound') wrong.push(`${frame} ${operator} − upper_bound read as ${bound[0]!.form}`);
        if (bound.length > 0 && sign < 0 && form === 'range' && !(bound[0]!.low === 10 && bound[0]!.high === 15)) wrong.push(`${frame} ${operator} − range ends ${bound[0]!.low}..${bound[0]!.high}`);
      }
    expect(wrong).toEqual([]);
  });
});
