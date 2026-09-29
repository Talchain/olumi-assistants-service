/**
 * ⛔ A SECOND OPTION WITH THE SAME LEVELS IS NOT A NEW CHOICE (served DL browser (F) bf-20260926T101424Z, UI e1bcbf99 /
 * CEE 42114c6, OpenAI only).
 *
 * One approval added "Test £54 versus £59 by customer cohort before rollout" whose ONLY level was `pro_plan_price` at the
 * value "Raise Pro to £54" already set. The engine cannot tell two options with the same levels apart (PLoT
 * `validation/identical-options.ts`: a validation error); the run's result then carried four options without it, with no
 * warning, and its card read "Not analysed" beside a run CEE had admitted.
 *
 * The rule, at the one add-option writer: an option whose VALUED levels equal an existing option's (same factors, each
 * within PLoT's epsilon) is refused, and the refusal names the option it would duplicate. The typed chip path refuses
 * with a sentence rather than skipping (a skip falls through to the free-text edit lane, which could add it anyway).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildAddOptionTransaction, buildAddOptionsTransaction } from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-same-levels-option.bf-101424.json', import.meta.url), 'utf8'),
) as { graph: Json; added_option: Json; _provenance: { decision_id: string } };
const GRAPH = SERVED.graph;
const DECISION = SERVED._provenance.decision_id;
const ADDED = SERVED.added_option;
const TWIN = { id: 'raise_pro_to_54', label: 'Raise Pro to £54' };

/** The served added option, as the add-option spec that produced it. */
function servedSpec(overrides: Json = {}): Json {
  const level = ADDED.interventions.pro_plan_price;
  return {
    parent_decision_id: DECISION,
    label: ADDED.label,
    interventions: [{ factor_id: 'pro_plan_price', value: level.value, raw_value: level.raw_value, unit: level.unit }],
    ...overrides,
  };
}

describe('an option with the same levels as an existing one is refused, by name', () => {
  it('PREMISE (served): the added option\'s only level equals "Raise Pro to £54"\'s', () => {
    const twin = (GRAPH.nodes as Json[]).find((n) => n.id === TWIN.id)!;
    expect(twin.label).toBe(TWIN.label);
    expect(Object.keys(ADDED.interventions)).toEqual(['pro_plan_price']);
    expect(Object.keys(twin.interventions)).toEqual(['pro_plan_price']);
    expect(ADDED.interventions.pro_plan_price.value).toBe(twin.interventions.pro_plan_price.value);
  });

  it('PREMISE (served): the twin also links "ai_feature_release_value" WITHOUT a level — and the run still dropped the add', () => {
    const linked = (GRAPH.edges as Json[]).filter((e) => e.from === TWIN.id).map((e) => e.to).sort();
    expect(linked).toEqual(['ai_feature_release_value', 'pro_plan_price']);
    expect((GRAPH.nodes as Json[]).find((n) => n.id === TWIN.id)!.interventions.ai_feature_release_value).toBeUndefined();
  });

  it('⭐ the served add is refused, naming the option it would duplicate', () => {
    expect(buildAddOptionTransaction(servedSpec(), GRAPH as never)).toEqual({
      matched: false,
      reason: 'same_levels_as_existing_option',
      sameAs: TWIN,
    });
  });

  it('CONTRAST: a different level on the same factor is a new choice — built', () => {
    const r = buildAddOptionTransaction(servedSpec({ interventions: [{ factor_id: 'pro_plan_price', value: 0.28 }] }), GRAPH as never);
    expect(r.matched).toBe(true);
  });

  it('CONTRAST: the same level PLUS another level is a new choice — built', () => {
    const other = (GRAPH.nodes as Json[]).find((n) => n.kind === 'factor' && n.id !== 'pro_plan_price')!;
    const r = buildAddOptionTransaction(
      servedSpec({ interventions: [{ factor_id: 'pro_plan_price', value: 0.27 }, { factor_id: other.id, value: 0.5 }] }),
      GRAPH as never,
    );
    expect(r.matched).toBe(true);
  });

  it('CONTRAST: an EXISTING option that sets the same level PLUS another is a different choice — built', () => {
    const graph = structuredClone(GRAPH);
    const twin = (graph.nodes as Json[]).find((n) => n.id === TWIN.id)!;
    twin.interventions.ai_feature_release_value = { value: 0.6, source: 'user_specified' };
    expect(buildAddOptionTransaction(servedSpec(), graph as never).matched).toBe(true);
  });

  it('CONTRAST: an option with no levels is never compared — added unconfigured, as today', () => {
    const r = buildAddOptionTransaction(servedSpec({ interventions: [] }), GRAPH as never);
    expect(r.matched).toBe(true);
  });

  it('CONTRAST: a NEW option with an unsized link is never compared — added, and readiness names the missing value', () => {
    const r = buildAddOptionTransaction(
      servedSpec({
        interventions: [
          { factor_id: 'pro_plan_price', value: ADDED.interventions.pro_plan_price.value },
          { factor_id: 'ai_feature_release_value', value: null },
        ],
      }),
      GRAPH as never,
    );
    expect(r.matched).toBe(true);
  });

  it('a batch refuses a second NEW option that repeats the first one\'s levels, at its index, naming the first', () => {
    const r = buildAddOptionsTransaction(
      {
        parent_decision_id: DECISION,
        options: [
          { label: 'Price at 61', interventions: [{ factor_id: 'pro_plan_price', value: 0.305 }] },
          { label: 'Also price at 61', interventions: [{ factor_id: 'pro_plan_price', value: 0.305 }] },
        ],
      },
      GRAPH as never,
    );
    expect(r).toMatchObject({ matched: false, reason: 'same_levels_as_existing_option', index: 1, sameAs: { label: 'Price at 61' } });
  });

  it('the batch path carries the refusal and its name for a duplicate of an EXISTING option too', () => {
    const r = buildAddOptionsTransaction(
      { parent_decision_id: DECISION, options: [{ label: 'Fresh', interventions: [{ factor_id: 'pro_plan_price', value: 0.31 }] }, servedSpec()] },
      GRAPH as never,
    );
    expect(r).toMatchObject({ matched: false, reason: 'same_levels_as_existing_option', index: 1, sameAs: TWIN });
  });
});

describe('the typed add_option chip path refuses it with a sentence — it never falls through to the edit lane', () => {
  const base = {
    currentGraph: GRAPH,
    currentGraphHash: computeAnalysisAffectingGraphHash(GRAPH as never),
    freshness: 'none' as const,
    mode: 'live' as const,
    scenarioId: 'scn-same-levels',
    turnId: 'turn-same-levels',
    requestId: 'req-same-levels',
    stage: 'frame' as const,
  };

  it('⭐ refused (not skipped), and the sentence names "Raise Pro to £54"', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: servedSpec() });
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.reason).toBe('same_levels_as_existing_option');
    expect(out.response.assistant_text).toContain('"Raise Pro to £54"');
    expect(out.response.assistant_text).toContain("I haven't added it");
  });

  it('CONTRAST: a different level is held for the user\'s approval, as today', () => {
    const out = dispatchAddOptionTransaction({ ...base, parameters: servedSpec({ interventions: [{ factor_id: 'pro_plan_price', value: 0.28 }] }) });
    expect(out.kind).toBe('held');
  });
});
