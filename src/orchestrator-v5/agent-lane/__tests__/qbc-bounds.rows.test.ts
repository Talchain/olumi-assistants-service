/**
 * ⭐ QUANTITY BINDING CONTRACT, row 10 (#3396 B2; outbox/QUANTITY-BINDING-CONTRACT-20261018.md, PR-B): a figure becomes a BOUND only as
 * its own quantity's, unqualified. Guards and the declared-limit CONTROL are the owner's rows (wip/qbc-rows @0dfc9f25), taken whole.
 *
 * The producer half lands here: the drafter's factor `plausible_max` is number|null, and the AIE's exact W3 text (tests/fixtures/sys2/
 * aie-w3-producer-bound-text-amend-v1.json, the AIE's file byte for byte) asks for it ONLY for a supported upper domain bound in the
 * factor's own unit and encoding; otherwise null. A null range is admission's existing defaulted frame, never a bound.
 *
 * ⛔ DEPENDENCE, stated: every check here reads the AI's structured reading (the statement's form, qualifier and subject; the factor's
 * plausible_max; the constraint it declares). There is no qualifier word list. Where the AI leaves the qualifier out, the host cannot
 * tell "likely at most" from "at most"; the OMISSION rows below pin exactly what then happens. Synthetic words only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const PRICE = 'Monthly price';
const W3 = JSON.parse(readFileSync('tests/fixtures/sys2/aie-w3-producer-bound-text-amend-v1.json', 'utf8')) as {
  spans: { span: string; effective_find: string; effective_replace: string }[];
  remaining_shared_outcome_risk_description: { effective_find: string; effective_replace: string } };
const LIMIT_40 = { metric: PRICE, operator: '<=', value: 40, unit: '£ per month', provenance: 'explicit', frame: 'level', role: 'limit' };

async function constructPrice(said: string, statement: Rec, constraints: Rec[] = [], plausibleMax: number | null = 40):
  Promise<{ graph: Rec | undefined; sent: Rec | undefined }> {
  let graph: Rec | undefined;
  let sent: Rec | undefined;
  const draft = {
    goal: { kind: null, deliverable: null, metric: 'Monthly revenue', operator: '>=', target_stated: true, value: 50000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, quantity_frame: 'level',
      source_quote: 'We want monthly revenue of at least £50,000.', deadline_words: null },
    constraints,
    options: [{ label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Raise the price', provenance: 'explicit', changes: [PRICE], interventions: [], added_capacity: null, is_status_quo: null }],
    factors: [{ label: PRICE, role: 'controllable', baseline_known: true, baseline_value: 20, unit: '£ per month', provenance: 'explicit', plausible_max: plausibleMax }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: 'Supplier quality', provenance: 'inferred', unit: 'score out of 40', plausible_max: 40 }],
    links: [{ from: PRICE, to: 'Monthly revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [{ quote: said, speaker: 'user', subject: { kind: 'factor', label: PRICE, to_label: null, factor_label: null }, unit: '£ per month',
      qualifier: null, conditions: null, low: null, high: null, ...statement }],
  };
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as unknown as InternalDispatch;
  const brief = `We want monthly revenue of at least £50,000. ${said} We could raise the price.`;
  await buildModelFromBrief('qbc00000-0000-4000-8000-0000000000a0', brief, dispatch,
    (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft), status: 'completed' }; }) as unknown as CallStructuredModel);
  return { graph, sent };
}
const priceNode = (g: Rec | undefined): Rec | undefined => ((g?.nodes ?? []) as Rec[]).find((n) => n.label === PRICE);
const hardPriceLimits = (g: Rec | undefined): Rec[] => ((g?.goal_constraints ?? []) as Rec[])
  .filter((c) => c.node_id === priceNode(g)?.id && c.value === 40);

describe('row 10 (#3396 B2): a figure becomes a bound only as its own quantity\'s, unqualified', () => {
  it('GUARD: "price is £20 … supplier quality is scored out of 40" never gives £40 to the price as a limit', async () => {
    const { graph } = await constructPrice('Our monthly price is £20 per month and supplier quality is scored out of 40.', { field: 'level', form: 'point', value: 20 });
    expect(graph, 'PRECONDITION: the model registers').toBeDefined();
    expect(hardPriceLimits(graph)).toEqual([]);
  });

  it('CONTROL (the probe sees a limit): "cannot exceed £40", declared as the price\'s limit, registers its hard limit of 40', async () => {
    const { graph } = await constructPrice('Our monthly price cannot exceed £40 per month.', { field: 'level', form: 'upper_bound', value: 40 }, [LIMIT_40]);
    expect(hardPriceLimits(graph), JSON.stringify(graph?.goal_constraints)).toHaveLength(1);
  });

  it('GUARD: "likely at most £40" is never recorded as a hard limit on the price', async () => {
    const { graph } = await constructPrice('Our monthly price is likely at most £40 per month.', { field: 'level', form: 'upper_bound', value: 40, qualifier: 'likely' });
    expect(graph, 'PRECONDITION: the model registers').toBeDefined();
    expect(hardPriceLimits(graph)).toEqual([]);
  });

  it('PRODUCER (SENT body): plausible_max is number|null and required; the AIE W3 text is sent once, the "never null" text not at all', async () => {
    const { sent } = await constructPrice('Our monthly price is £20 per month.', { field: 'level', form: 'point', value: 20 });
    const factor = sent!.schema.properties.factors.items.properties.plausible_max as Rec;
    expect(factor.anyOf).toEqual([{ type: 'number' }, { type: 'null' }]);
    expect(sent!.schema.properties.factors.items.required).toContain('plausible_max');
    const S1 = W3.spans.find((s) => s.span.startsWith('S1'))!, S2 = W3.spans.find((s) => s.span.startsWith('S2'))!;
    expect(factor.description).toBe(S1.effective_replace);
    const text = String(sent!.instructions);
    expect(text.split(S2.effective_replace)).toHaveLength(2);
    expect(text).not.toContain(S2.effective_find);
    const shared = W3.remaining_shared_outcome_risk_description;
    for (const k of ['outcomes', 'risks']) expect(sent!.schema.properties[k].items.properties.plausible_max.description).toBe(shared.effective_replace);
  });

  it('B2 FRAME: the AI\'s null range for the price ("… quality is scored out of 40") registers with no 40 anywhere on the price', async () => {
    const { graph } = await constructPrice('Our monthly price is £20 per month and supplier quality is scored out of 40.',
      { field: 'level', form: 'point', value: 20 }, [], null);
    expect(graph, 'PRECONDITION: the model registers').toBeDefined();
    const price = priceNode(graph)!;
    expect(price.observed_state?.raw_value).toBe(20);
    expect(price.observed_state?.cap, JSON.stringify(price.observed_state)).not.toBe(40);
    expect(hardPriceLimits(graph)).toEqual([]);
  });

  it('DEPENDENCE (the AI\'s reading): where the AI still gives the price the quality\'s 40 as its range, the price is read against 40', async () => {
    const { graph } = await constructPrice('Our monthly price is £20 per month and supplier quality is scored out of 40.',
      { field: 'level', form: 'point', value: 20 }, [], 40);
    expect(priceNode(graph)!.observed_state?.cap).toBe(40);
    expect(hardPriceLimits(graph), 'still never a limit').toEqual([]);
  });

  it('OMISSION (the AI leaves out "likely") with no declared limit: still no hard limit — a limit needs the AI\'s own declared constraint', async () => {
    const { graph } = await constructPrice('Our monthly price is likely at most £40 per month.', { field: 'level', form: 'upper_bound', value: 40 });
    expect(graph, 'PRECONDITION: the model registers').toBeDefined();
    expect(hardPriceLimits(graph)).toEqual([]);
  });

  it('OMISSION + declared limit (DEPENDENCE): with "likely" left out, the host cannot tell it from "at most" — a hard limit registers', async () => {
    const { graph } = await constructPrice('Our monthly price is likely at most £40 per month.', { field: 'level', form: 'upper_bound', value: 40 }, [LIMIT_40]);
    expect(hardPriceLimits(graph)).toHaveLength(1);
  });

  // OWED (lean core, admission hunk outbox/C5-QBC-ROW10-OWNER-HUNK.patch): the AI KEEPS "likely" on its statement but also declares the
  // limit; admission takes the declared constraint without reading its own bound statement's qualifier (`combineStatementEnds`).
  it.fails('OWED (admission): "likely at most £40" kept qualified by the AI, yet declared as a limit, is never a hard limit', async () => {
    const { graph } = await constructPrice('Our monthly price is likely at most £40 per month.',
      { field: 'level', form: 'upper_bound', value: 40, qualifier: 'likely' }, [LIMIT_40]);
    expect(hardPriceLimits(graph)).toEqual([]);
  });
});
