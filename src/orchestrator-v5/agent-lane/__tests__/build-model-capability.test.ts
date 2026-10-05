import { strictRecordsWire } from './records-wire-fixture.js';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
/**
 * `build_model_from_brief` — the construction capability, as the ROUTE reaches it.
 *
 * ⛔ THE FIRST TEST HERE EXISTS BECAUSE THE FLAG WAS WIRED TO THE WRONG OBJECT.
 * The route read `config.features.agentLaneEnabled` while the flag was declared
 * on `config.proxy`. Every unit test passed, the typecheck I ran passed, and
 * setting `AGENT_LANE_ENABLED=true` on the deployed service would have mounted
 * NOTHING — the route would have returned early, silently, for ever. A test that
 * reads the config the way the route reads it is the only thing that catches it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../../../config/index.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { budgetFor } from '../model-budgets.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { AGENT_TOOLS, dispatchTool } from '../runtime/agent-tools.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };

/** An explicit records topology, including a located user limit on claim 1. */
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: 'goal', source_quote: 'MRR' },
    { kind: 'option', source_quote: 'Raise Pro to £59' },
    { kind: 'constraint', source_quote: 'Monthly churn under 4%', value: 4, unit: '%', direction: 'ceiling',
      direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 1 },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Pro plan price', value: 49, unit: 'GBP', value_scale: 'raw_count' },
    { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue' },
    { claim_kind: 'causal_link', label: 'Price effect', from_claim: 0, to_claim: 2, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Churn effect', from_claim: 1, to_claim: 2, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'Revenue reaches goal', from_claim: 2, to_stated: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Price level', from_stated: 1, to_claim: 0, sets_to: 59, unit: 'GBP', value_scale: 'raw_count', effect: 'positive' },
  ],
};

const structured = (payload: DraftRecordSet = RECORDS): CallStructuredModel =>
  async () => ({ text: JSON.stringify(strictRecordsWire(payload)) });

/** `nodes` drives both the pre-check and the post-write confirmation. */
function dispatcher(opts: { before: unknown[]; after: unknown[]; registerStatus?: number }) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  let registered = false;
  const d: InternalDispatch = async (path, body) => {
    calls.push(path);
    if (path.endsWith('/graph/register')) bodies.register = body;
    if (path.endsWith('/graph/register')) {
      registered = true;
      return { status: opts.registerStatus ?? 200, json: {} };
    }
    const nodes = registered ? opts.after : opts.before;
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: registered ? 'after' : 'before' } };
  };
  return { d, calls, bodies };
}

const NON_EMPTY = [{ id: 'x', kind: 'goal', label: 'Already here' }];

describe('the flag the route actually reads', () => {
  it('names a config object that REALLY carries agentLaneEnabled', () => {
    // \u26d4 AN EARLIER VERSION OF THIS TEST MATCHED THE FILE, NOT THE CONFIG:
    // a non-greedy `[\\s\\S]*?` anchored at `features: z.object({` ran on past
    // that object's closing brace and found `agentLaneEnabled` inside `proxy`.
    // It passed under the very mutant it existed to catch. So this asks the
    // PARSED config object \u2014 the same object the route dereferences.
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const gate = /config\.([A-Za-z]+)\??\.agentLaneEnabled/.exec(route);
    expect(gate, 'the route must gate on config.<object>.agentLaneEnabled').not.toBeNull();
    const objectTheRouteReads = gate![1];

    const section = (config as unknown as Record<string, Record<string, unknown> | undefined>)[objectTheRouteReads];
    expect(section, `config.${objectTheRouteReads} does not exist`).toBeTypeOf('object');
    expect(
      typeof section!.agentLaneEnabled,
      `the route gates on config.${objectTheRouteReads}.agentLaneEnabled, but that key is not on ` +
        `the parsed config.${objectTheRouteReads} \u2014 the gate can never be true and the route ` +
        `would never mount, however the environment is set`,
    ).toBe('boolean');
  });
});

describe('build_model_from_brief', () => {
  it('is declared to the Agent, or it can never be called', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('build_model_from_brief');
  });

  it('is reachable through dispatchTool by its declared name', async () => {
    const { d } = dispatcher({ before: [], after: [{ id: 'a' }] });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured());
    const r = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' }), ctx, caps);
    expect(r.ok).toBe(true);
    expect(r.mutated).toBe(true);
  });

  it('REFUSES over a model that already has entities, rather than replacing it', async () => {
    const { d, calls } = dispatcher({ before: NON_EMPTY, after: NON_EMPTY });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured());
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('model_already_exists');
    expect(r.mutated).toBe(false);
    // The point of the refusal: nothing was registered.
    expect(calls.some((c) => c.endsWith('/graph/register'))).toBe(false);
  });

  it('refuses honestly when no construction caller is available', async () => {
    const { d } = dispatcher({ before: [], after: [] });
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.refusal).toBe('construction_unavailable');
  });

  it('reports NOT APPLIED when registration refuses', async () => {
    const { d } = dispatcher({ before: [], after: [], registerStatus: 403 });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured());
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.ok).toBe(false);
    expect(r.mutated).toBe(false);
    expect(r.refusal).toBe('registration_refused');
  });

  it('confirms from a RE-READ, not from the write returning 200', async () => {
    // Registration answers 200 while the model reads back empty — the exact
    // shape that once let the Agent announce "Added: …" over a refusal.
    const { d } = dispatcher({ before: [], after: [] });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured());
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('model_not_readable_after_write');
  });

  it('drops a constraint naming an entity that does not exist \u2014 the contrast control', async () => {
    // Same run, same shape, one difference: the metric matches no entity. If
    // this ALSO reported 1, the count above would be measuring nothing.
    const unresolvable = {
      ...RECORDS,
      stated_items: RECORDS.stated_items.map((item, index) => index === 2
        ? { ...item, source_quote: 'Something nobody modelled under 4%', applies_to_claim: 999 } : item),
    };
    const { d, bodies } = dispatcher({ before: [], after: [{ id: 'a' }] });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured(unresolvable));
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.goal_constraints_carried).toBe(0);
    const sent = (bodies.register as { graph?: Record<string, unknown> } | undefined)?.graph;
    expect(sent && 'goal_constraints' in sent, 'no constraints => the key must be absent').toBe(false);
  });

  it('carries the stated constraint with the graph it registers', async () => {
    const { d, bodies } = dispatcher({ before: [], after: [{ id: 'a' }] });
    const caps = createAgentCapabilities(d, new ProposalStore(), structured());
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    // The records state one constraint; `/graph/register` takes graph +
    // brief_text only, so it is NOT enforced by what was just persisted.
    expect(r.goal_constraints_carried).toBe(1);
    // And the graph SENT to registration must actually carry them — the point
    // of the fix. Asserting only the count would pass while the payload dropped
    // them, which is exactly the shape of the bug this replaces.
    // ⛔ ASSERT THE PAYLOAD, NOT THE CALL. A count of admitted constraints
    // would stay green while the graph sent to registration dropped them —
    // which is precisely the bug this replaces.
    const sent = (bodies.register as { graph?: { goal_constraints?: unknown[] } } | undefined)?.graph;
    expect(sent?.goal_constraints, 'the registered graph must carry the constraint').toHaveLength(1);
  });

  it('refuses an empty structured answer instead of writing nothing', async () => {
    const { d } = dispatcher({ before: [], after: [] });
    const caps = createAgentCapabilities(d, new ProposalStore(), async () => ({ text: '' }));
    const r = await caps.buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });
    expect(r.refusal).toBe('no_structured_output');
  });
});

describe('the construction budget is the measured one', () => {
  it('sends the WHOLE-candidate ceiling on the real call, not the widening one', async () => {
    // \u2b50 ASSERT WHAT THE CALL SITE SENDS, not what the constant says. A test
    // that only reads budgetFor() is a second copy of the table and is blind in
    // the direction a wrong role would move it.
    const seen: { max?: number; model?: string; effort?: string }[] = [];
    const capture: CallStructuredModel = async (r) => {
      seen.push({ max: r.max_output_tokens, model: r.model, effort: r.reasoning_effort });
      return { text: JSON.stringify(strictRecordsWire(RECORDS)) };
    };
    const { d } = dispatcher({ before: [], after: [{ id: 'a' }] });
    await createAgentCapabilities(d, new ProposalStore(), capture).buildModelFromBrief(ctx, { brief: 'MRR. Raise Pro to £59. Monthly churn under 4%.' });

    expect(seen).toHaveLength(1);
    const whole = budgetFor(seen[0].model!, 'whole');
    expect(seen[0].max).toBe(whole.max_output_tokens);
    // Measured 22 Sep: out 3404. A ceiling at or below that truncates, and the
    // widening budget IS at or below it \u2014 so the roles are not interchangeable.
    expect(seen[0].max!).toBeGreaterThan(3404);
    expect(budgetFor(seen[0].model!, 'widening').max_output_tokens).toBeLessThan(3404);
    // ⭐ Construction runs at its banked effort: MEDIUM per OpenAI Technical Architecture ruling (#63 5798194848),
    // LOWERED to low on 1 Oct (AI HARNESS A/B: first-pass median 58.9 → 39.8 s, MG fidelity PASS). Bound at the CALL,
    // not only the table, so a builder that ignored the budget would fail here too.
    expect(seen[0].effort).toBe('low');
  });
});

/**
 * ⛔ The construction must NAME its operation, or a lost registration response
 * can only be retried as a brand-new write — and #1691 makes registration mint
 * a version, so that retry would mint a SECOND one.
 */
describe('build_model_from_brief names its construction operation', () => {
  it('sends a DERIVED operation_id — the same (scenario, brief) always names the same operation', async () => {
    const run = async () => {
      const { d, bodies } = dispatcher({ before: [], after: [{ id: 'a' }] });
      const caps = createAgentCapabilities(d, new ProposalStore(), structured());
      await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'the pricing brief' }), ctx, caps);
      return (bodies.register as { operation_id?: string }).operation_id;
    };
    const first = await run();
    const second = await run();
    // Bound by IDENTITY: the exact derivation, and stable across two processes.
    expect(first).toBe(constructionOperationId(SCENARIO, 'the pricing brief'));
    expect(second).toBe(first);
    // A UUID, because the route validates it as one.
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('CONTRAST CONTROL: a different brief is a different operation', () => {
    expect(constructionOperationId(SCENARIO, 'brief A')).not.toBe(constructionOperationId(SCENARIO, 'brief B'));
    expect(constructionOperationId(SCENARIO, 'brief A')).not.toBe(constructionOperationId('22222222-2222-2222-2222-222222222222', 'brief A'));
  });
});
