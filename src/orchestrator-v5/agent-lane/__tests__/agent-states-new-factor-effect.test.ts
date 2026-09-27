/**
 * ⭐ THE AGENT SENDS THE USER'S STATED SIZE, READ FROM THE USER'S OWN WORDS (AI Quality #70 5854410205, binding; ChatGPT
 * 5854144804: "with it, churn falls by 3 points" must size the causal link, not become a level beside a placeholder).
 *
 * ⚠ SERVED (R&C `dloop3x-2`, CEE ecd379a): "Add a new option: keep the price at £49 and launch a retention programme that
 * we expect to cut monthly churn by 3 percentage points, based on last year's pilot." The Agent added a graded factor,
 * the 3 points became its level, and the link into churn was Olumi's placeholder.
 *
 * HARNESS: Paul's served graph (the routing fixture `served-f4-pre-addon.bf-054503.json`: churn 7%, Olumi's estimate).
 * The Agent's typed turn is answered by the REAL product dispatcher (`dispatchAddOptionTransaction`) on the parameters it
 * sent, so the held chip the Agent checks for is the product's own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('../../routing/__tests__/fixtures/served-f4-pre-addon.bf-054503.json', import.meta.url), 'utf8'),
) as { nodes: Json[]; edges: Json[] };
const STORED = projectGraphForPersistence(structuredClone(SERVED)) as typeof SERVED;
const churnAt = (pct: number): typeof SERVED => {
  const g = structuredClone(STORED);
  g.nodes.find((n) => n.id === 'monthly_churn_rate')!.observed_state = { unit: '%', value: pct / 100, raw_value: pct, source: 'cee_inference', extractionType: 'inferred' };
  return g;
};

const DLOOP3X_2 = 'Add a new option: keep the price at £49 and launch a retention programme that we expect to cut monthly churn by 3 percentage points, based on last year\'s pilot.';

const setup = (graph: typeof SERVED = STORED) => {
  const sent: { path: string; body: Json }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    const b = body as Json;
    sent.push({ path, body: b });
    if (path === '/orchestrate/v2/turn' && b.chip?.intent === 'add_option') {
      const out = dispatchAddOptionTransaction({
        parameters: b.chip.parameters, currentGraph: graph, currentGraphHash: computeAnalysisAffectingGraphHash(graph as never)!,
        freshness: 'none', mode: 'live', scenarioId: b.scenario_id, turnId: b.turn_id, requestId: 'r', stage: 'frame',
      } as never) as Json;
      return { status: 200, json: out.response ?? {} };
    }
    return { status: 500, json: {} };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
};
const ctxFor = (text: string) => ({
  scenario_id: '550e8400-e29b-41d4-a716-4466554400d1', authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text,
});
const call = (affect: Json, level?: Json) => ({
  label: '£49 with retention programme',
  acts_on: [{ factor_label: 'Retention programme', direction: 'positive', ...(level !== undefined ? { level } : {}) }],
  new_factors: [{ label: 'Retention programme', affects: [affect] }],
  rationale: 'the user asked for it',
});
const churn = (stated?: Json, direction = 'negative') => ({ label: 'Monthly churn rate', direction, ...(stated !== undefined ? { stated_effect: stated } : {}) });
const paramsOf = (sent: { body: Json }[]) => sent[0]?.body.chip?.parameters as Json | undefined;

describe('⭐ RED (dloop3x-2): the typed turn carries the user\'s size, and the option switches the new factor ON', () => {
  it('"cut monthly churn by 3 percentage points" → effect_amount −3 on the link, and the option\'s level on the switch is 1', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor(DLOOP3X_2), call(churn({ amount: 3, unit: 'percentage points' })) as never) as Json;
    const params = paramsOf(sent);
    expect(params, JSON.stringify(r)).toBeDefined();
    expect(params!.new_factors).toEqual([{ key: 'retention_programme', label: 'Retention programme',
      affects: [{ node_id: 'monthly_churn_rate', effect_direction: 'negative', effect_amount: -3 }] }]);
    // The user named the programme, so the level (on) is theirs: no Olumi stamp.
    expect(params!.interventions).toEqual([{ factor_key: 'retention_programme', value: 1 }]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('ITEM 4 — WHOSE SIZE: the preview says it as the user\'s ("You said"), never as Olumi\'s estimate or a placeholder', async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctxFor(DLOOP3X_2), call(churn({ amount: 3, unit: 'percentage points' })) as never) as Json;
    expect(r.new_factors).toHaveLength(1);
    expect(r.new_factors[0].how_strongly).toBe('You said switching on "Retention programme" lowers "Monthly churn rate" by 3 points');
    expect(r.new_factors[0].how_strongly).not.toMatch(/Olumi|placeholder/);
    expect(r.new_factors[0].switch).toBeDefined();
    expect(r.new_factors[0].current_value).toBeNull();
    expect(r.new_factors_note).toContain('that size is the user’s own');
  });

  it('"falls by 3 points" on churn (a percentage level) is 3 percentage points', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxFor('Add an option: launch a retention programme. With it, monthly churn falls by 3 points.'),
      call(churn({ amount: 3, unit: 'points' })) as never);
    expect(paramsOf(sent)!.new_factors[0].affects[0].effect_amount).toBe(-3);
  });

  it('SIGN FROM THE VERB — CONTRAST "rises by 3 points" → +3', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxFor('Add an option: launch a retention programme. With it, monthly churn rises by 3 points.'),
      call(churn({ amount: 3, unit: 'points' }, 'positive')) as never);
    expect(paramsOf(sent)!.new_factors[0].affects[0]).toEqual({ node_id: 'monthly_churn_rate', effect_direction: 'positive', effect_amount: 3 });
  });

  it('a level the Agent gives the switch is never used as its level: it is on (1), and the other figure is said', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor(DLOOP3X_2), call(churn({ amount: 3, unit: 'percentage points' }), { value: 3 }) as never) as Json;
    expect(paramsOf(sent)!.interventions).toEqual([{ factor_key: 'retention_programme', value: 1 }]);
    expect(JSON.stringify(r.levels_not_set)).toContain('switches on');
  });
});

describe('POINTS ARE POINTS: a bare "3%" is asked, never guessed — and read from the USER\'s words, not the Agent\'s unit', () => {
  const PERCENT = 'Add an option: launch a retention programme. With it, monthly churn falls by 3%.';

  it('"falls by 3%" → refused, nothing sent, and the user is asked which they mean', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor(PERCENT), call(churn({ amount: 3, unit: '%' })) as never) as Json;
    expect(r.refusal).toBe('stated_effect_not_points');
    expect(r.say).toBe('Do you mean "Monthly churn rate" moves by 3 percentage points, or by 3% of its level today?');
    expect(sent).toEqual([]);
  });

  it('the Agent calling the user\'s "3%" "percentage points" changes nothing: still asked', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor(PERCENT), call(churn({ amount: 3, unit: 'percentage points' })) as never) as Json;
    expect(r.refusal).toBe('stated_effect_not_points');
    expect(sent).toEqual([]);
  });
});

describe('the size is the user\'s, or it is not sent', () => {
  it('a figure the user never wrote is refused: nothing sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor('Add an option: launch a retention programme. It cuts monthly churn.'),
      call(churn({ amount: 3, unit: 'percentage points' })) as never) as Json;
    expect(r.refusal).toBe('stated_effect_not_users');
    expect(sent).toEqual([]);
  });

  it('a stated size on something that is not a percentage level is refused with what to do (scope of this change)', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor('Add an option: launch a retention programme. It adds £3000 a month to MRR.'),
      call({ label: 'MRR', direction: 'positive', stated_effect: { amount: 3000, unit: '£' } }) as never) as Json;
    expect(r.refusal).toBe('stated_effect_target_not_a_percentage');
    expect(sent).toEqual([]);
  });

  it('ITEM 5 — on churn at Olumi\'s estimate of 2%, −3 points would go below 0%: nothing sent, and the user is told why and asked', async () => {
    const { caps, sent } = setup(churnAt(2));
    const r = await caps.proposeNewOption(ctxFor(DLOOP3X_2), call(churn({ amount: 3, unit: 'percentage points' })) as never) as Json;
    expect(r).toMatchObject({ ok: false, refusal: 'not_prepared', reason: 'stated_effect_unusable' });
    expect(r.say).toContain('at Olumi\'s own estimate of "Monthly churn rate" today (2%), that would take it below 0%');
    expect(r.say).toContain('What is "Monthly churn rate" today?');
    expect(r.detail).toContain(r.say);
    expect(sent).toEqual([]);
  });
});

describe('CONTROL — no stated size: exactly today\'s wire and words', () => {
  it('the link is sent without a size, the new factor with no level, and how strongly is Olumi\'s', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxFor(DLOOP3X_2), call(churn()) as never) as Json;
    expect(paramsOf(sent)!.new_factors).toEqual([{ key: 'retention_programme', label: 'Retention programme',
      affects: [{ node_id: 'monthly_churn_rate', effect_direction: 'negative' }] }]);
    expect(paramsOf(sent)!.interventions).toEqual([{ factor_key: 'retention_programme', value: null }]);
    expect(r.new_factors[0]).toEqual({ label: 'Retention programme', changes: ['Monthly churn rate (lowers it)'],
      how_strongly: 'Olumi’s estimate, for the user to correct', current_value: null });
    expect(r.new_factors_note).toContain('Ask the user what it is today');
  });
});

describe('the tool offers it, and says when not to use it', () => {
  it('propose_new_option → new_factors[].affects[].stated_effect {amount (required), unit}, closed to other keys', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_new_option')!;
    const affects = (tool.parameters as Json).properties.new_factors.items.properties.affects.items;
    const stated = affects.properties.stated_effect;
    expect(stated.required).toEqual(['amount']);
    expect(stated.additionalProperties).toBe(false);
    expect(Object.keys(stated.properties).sort()).toEqual(['amount', 'unit']);
    expect(stated.description).toContain('ONLY when the user said HOW MUCH');
    expect(affects.required).toEqual(['label', 'direction']);
  });
});
