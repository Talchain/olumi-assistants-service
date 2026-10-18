/**
 * ⭐ LEAN CORE W32 (DL-3 owner-apply hunk, build-model.ts `goalUnitReading` call): on the REAL path, the goal's unit is the user's only
 * where the verified {goal, target} statement itself writes the target in that currency, quoting that statement. Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const AIM = 'We want monthly revenue above £40k within a year.';
const BRIEF = [AIM, 'Revenue is £31k a month today.', 'We already spend £40k on tooling each year.', 'We could raise prices or add a premium tier.'].join('\n');
const GOAL = 'Monthly revenue';
const draft = (statements: Rec[]): Rec => ({
  goal: { kind: null, deliverable: null, metric: GOAL, operator: '>', target_stated: true, value: 40000, unit: 'GBP/month', horizon_months: 12,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 31000, baseline_provenance: 'explicit', scope: null,
    quantity_frame: 'level', source_quote: AIM, deadline_words: null },
  constraints: [],
  options: [
    { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Raise prices', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Price level', value: 110, value_kind: 'absolute', unit: '% of today', provenance: 'ai_proposed' }] },
  ],
  factors: [{ label: 'Price level', role: 'controllable', baseline_known: false, baseline_value: 100, unit: '% of today', provenance: 'ai_proposed', plausible_max: 200 }],
  risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
  links: [{ from: 'Price level', to: GOAL, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
    effect_provenance: null, definitional: null, basis: null, source_quote: null }],
  statements,
});
const target = (quote: string): Rec => ({ quote, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target',
  form: 'lower_bound', value: 40000, low: null, high: null, unit: 'GBP/month', qualifier: null, conditions: null });
async function goalNode(model: Rec): Promise<Rec> {
  let body: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('7c7c7c7c-0000-4c7c-8c7c-7c7c7c7c7c7c', BRIEF, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return body!.nodes.find((n: Rec) => n.kind === 'goal');
}

describe('W32: the goal\'s unit is the user\'s only where their verified target statement writes it', () => {
  it('the verified target statement writes £40k: user_stated, quoting THAT statement', async () => {
    expect((await goalNode(draft([target(AIM)]))).unit_reading).toEqual({ unit: 'GBP', source: 'user_stated', source_quote: AIM });
  });
  it('CONTRAST: the brief writes £40k, but no verified target statement does (the AI cited words the user never wrote): Olumi\'s reading', async () => {
    expect((await goalNode(draft([target('We want monthly revenue above £40k.')]))).unit_reading?.source).toBe('olumi_reading');
  });
});
