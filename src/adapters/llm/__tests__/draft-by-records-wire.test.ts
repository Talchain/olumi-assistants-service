/**
 * DRAFT BY RECORDS — the three integration points, asserted ON THE WIRE.
 *
 * The mechanism is only real if the request the adapter actually sends carries
 * it. This file mocks the SDK and inspects the REQUEST BODY, so what is pinned is
 * what the provider would receive:
 *
 *   1. the RECORDS grammar occupies the structured-outputs slot;
 *   2. the INSTRUCTION rides as a SECOND system block, AFTER the cached one;
 *   3. a record-set response is projected, and a GRAPH response is REFUSED.
 *
 * Point 3 is the one that cannot be replaced by any static check: the
 * prompt-only degradation rebuild keeps the instruction and drops the grammar, so
 * a graph-shaped response is reachable in production, and accepting it would
 * re-admit the retired draft path as an undeclared fallback.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DRAFT_RECORDS_INSTRUCTION,
  buildDraftRecordsSchema,
  draftRecordsInstructionHash,
  projectDraftRecords,
} from '../../../cee/draft/records/index.js';
import {
  CEE_MINTED_GOAL_FIELDS,
  stripModelAuthoredGoalThreshold,
} from '../normalisation.js';

const h = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  payload: { text: '' },
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        const payload = h.payload.text;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text: payload }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

/** A record set the projector turns into a structurally complete little graph. */
const RECORD_SET_RESPONSE = JSON.stringify({
  stated_items: [
    { kind: 'goal', source_quote: 'cut delivery time' },
    { kind: 'option', source_quote: 'open a second warehouse' },
    { kind: 'option', source_quote: 'stay with one warehouse' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'handling capacity', basis: [0], category: 'controllable' },
    { claim_kind: 'causal_link', label: 'more capacity cuts time', basis: [0], from_stated: 1, to_claim: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'capacity drives the goal', basis: [0], from_claim: 0, to_stated: 0, effect: 'positive' },
  ],
});

/** Exactly what the retired draft path used to return. */
const GRAPH_RESPONSE = JSON.stringify({
  nodes: [{ id: 'a', kind: 'factor', label: 'A' }],
  edges: [],
});

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let scrubProjectedDraftGoalTargets: typeof import('../anthropic.js').scrubProjectedDraftGoalTargets;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-draft-records';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic, scrubProjectedDraftGoalTargets } = await import('../anthropic.js'));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => { h.bodies = []; });

async function draft(
  responseText: string,
  brief = 'Should we open a second warehouse in Leeds?',
) {
  h.payload.text = responseText;
  const result = await draftGraphWithAnthropic(
    { brief, docs: [], seed: 1, model: 'claude-sonnet-4-6' },
    { timeoutMs: 120_000, forceDefault: true },
  ).then(
    (r) => ({ ok: true as const, result: r }),
    (e: unknown) => ({ ok: false as const, error: e as Error }),
  );
  expect(h.bodies.length, 'no request body captured').toBeGreaterThanOrEqual(1);
  return { body: h.bodies[0]!, ...result };
}

describe('1. the records grammar occupies the structured-outputs slot', () => {
  it('attaches EXACTLY the object buildDraftRecordsSchema() produces', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    const outputConfig = body.output_config as { format?: { type?: string; schema?: unknown } } | undefined;
    expect(outputConfig?.format?.type).toBe('json_schema');
    // Compared by SERIALISED IDENTITY against the builder, so this can never
    // drift into asserting a copy of the schema rather than the schema.
    expect(JSON.stringify(outputConfig?.format?.schema)).toBe(JSON.stringify(buildDraftRecordsSchema()));
  });

  it('sends no `tools` array — this is structured outputs, not a tool call', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    expect(body.tools).toBeUndefined();
  });

  /**
   * The discriminator that proves the cutover actually happened rather than
   * merely that *a* schema is attached: the graph grammar's own top-level
   * properties must be absent.
   */
  it('no longer sends the graph grammar', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    const schema = (body.output_config as { format: { schema: Record<string, unknown> } }).format.schema;
    const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
    expect(props).toEqual(['stated_items', 'claims']);
    expect(props).not.toContain('nodes');
    expect(props).not.toContain('edges');
  });
});

describe('2. the instruction rides as a second system block, after the cached one', () => {
  it('appends the instruction as the LAST system block, byte-identical', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    const system = body.system as Array<{ type: string; text: string }>;
    expect(Array.isArray(system)).toBe(true);
    expect(system.length).toBeGreaterThanOrEqual(2);
    expect(system[system.length - 1]!.text).toBe(DRAFT_RECORDS_INSTRUCTION);
    // ⭐ DERIVED, NOT A SECOND LITERAL. This assertion's question is "do the bytes
    // on the wire equal the bytes we SERVE" — so the right-hand side must be the
    // served constant's own hash. A hardcoded copy of the pin lived here and made
    // the instruction's hash a TWO-AUTHORITY number: moving the pin deliberately
    // in `instruction-pin.test.ts` (v2 → the pre-registered v3) left this copy
    // pointing at the old value, and the wire test failed for a reason that had
    // nothing to do with the wire. Which version is pinned is that file's
    // question and only that file's; this one asks whether the adapter ships it
    // intact, and it must keep answering that across every future version bump.
    expect(
      createHash('sha256').update(system[system.length - 1]!.text, 'utf8').digest('hex'),
    ).toBe(draftRecordsInstructionHash());
  });

  /**
   * ⭐ ORDERING IS LOAD-BEARING, not cosmetic. The cache breakpoint sits on the
   * long served prompt; appending AFTER it keeps that prefix byte-identical and
   * cached. Putting the instruction first would silently make every single draft
   * pay a cold cache write.
   */
  it('leaves the cache_control breakpoint on an EARLIER block, never on the instruction', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    const system = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    const last = system[system.length - 1]!;
    expect(last.cache_control).toBeUndefined();
    expect(system.slice(0, -1).some((b) => b.cache_control !== undefined)).toBe(true);
  });

  /**
   * The instruction must NOT reach the model through `systemDirective`, which the
   * lean-draft retry owns. Two meanings under one channel is trap 21, and the
   * cheapest way to check it is that the user content never contains these bytes.
   */
  it('never threads the instruction through the user content channel', async () => {
    const { body } = await draft(RECORD_SET_RESPONSE);
    const messages = JSON.stringify(body.messages);
    expect(messages).not.toContain('OUTPUT SHAPE FOR THIS REQUEST');
    expect(messages).not.toContain('CONNECT WHAT YOU EMIT');
  });
});

describe('3. the projection seam, and its honest failure', () => {
  it('projects a record-set response into a graph the pipeline can consume', async () => {
    const r = await draft(RECORD_SET_RESPONSE);
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    const graph = (r.result as { graph?: { nodes?: unknown[]; edges?: unknown[] } }).graph;
    expect(Array.isArray(graph?.nodes)).toBe(true);
    // A decision scaffold plus the stated/claimed nodes: the projector built
    // topology the record set did not contain, which is the whole job.
    expect((graph?.nodes ?? []).length).toBeGreaterThanOrEqual(4);
    expect((graph?.edges ?? []).length).toBeGreaterThanOrEqual(3);
  });

  /**
   * ⭐ THE UNDECLARED-FALLBACK GUARD, at the adapter rather than at the unit.
   * A graph response must produce the SAME typed failure a malformed draft
   * produces — never a drafted graph.
   */
  it('REFUSES a graph-shaped response, with the typed schema failure', async () => {
    const r = await draft(GRAPH_RESPONSE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('anthropic_response_invalid_schema');
    expect(r.error.message).toContain('draft_records_graph_shaped_response');
  });

  it('REFUSES prose, and never substitutes an empty graph', async () => {
    const r = await draft('I could not work out what you wanted.');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).not.toContain('nodes');
  });
});

describe('4. records-projector goal targets at the legacy scrub boundary', () => {
  const brief = [
    'Success means restoring renewal to at least 88%.',
    'We can open a second warehouse or stay with one warehouse.',
  ].join(' ');
  const responseObject = {
    stated_items: [
      {
        kind: 'goal',
        source_quote: 'Success means restoring renewal to at least 88%.',
        value: 88,
        unit: '%',
        role: 'target',
      },
      { kind: 'option', source_quote: 'open a second warehouse' },
      { kind: 'option', source_quote: 'stay with one warehouse' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'retention work', basis: [0], category: 'controllable' },
      { claim_kind: 'causal_link', label: 'warehouse change affects retention work', basis: [0], from_stated: 1, to_claim: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'retention work supports renewal', basis: [0], from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  };
  const response = JSON.stringify(responseObject);

  function withGoal(overrides: Record<string, unknown>): string {
    const changed = structuredClone(responseObject);
    Object.assign(changed.stated_items[0]!, overrides);
    return JSON.stringify(changed);
  }

  function graphGoal(result: Awaited<ReturnType<typeof draftGraphWithAnthropic>>) {
    return result.graph.nodes.find((node) => node.kind === 'goal');
  }

  function expectNoGoalContract(goal: unknown): void {
    for (const field of CEE_MINTED_GOAL_FIELDS) {
      expect(goal, `${field} must not survive without a verified explicit target`).not.toHaveProperty(field);
    }
  }

  it.each([
    ['the original brief', brief],
    ['an unrelated-object wording addition', `${brief} A blue teapot is in the meeting room.`],
  ])('retains the complete typed target for %s', async (_caseName, testBrief) => {
    const r = await draft(response, testBrief);
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    const goal = graphGoal(r.result);
    expect(goal).toMatchObject({
      goal_threshold: 0.88,
      goal_threshold_raw: 88,
      goal_threshold_unit: '%',
      goal_threshold_cap: 100,
      goal_threshold_frame: 'level',
    });
    // Participation controls: this is the real Anthropic draft route with the
    // records grammar and appended instruction, not a direct helper fixture.
    expect(r.body.model).toBe('claude-sonnet-4-6');
    expect(
      ((r.body.system as Array<{ text?: string }>).at(-1)?.text),
    ).toBe(DRAFT_RECORDS_INSTRUCTION);
    expect(
      ((r.body.output_config as { format?: { schema?: unknown } }).format?.schema),
    ).toEqual(buildDraftRecordsSchema());
  });

  it('strips a contradicted magnitude even when the quoted words are genuine', async () => {
    const r = await draft(
      withGoal({ value: 90 }),
      `${brief} A separate planning estimate is 90%.`,
    );
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    const goal = graphGoal(r.result);
    expect(goal?.provenance).toMatchObject({
      provenance_class: 'stated',
      brief_binding: 'unverified',
    });
    expectNoGoalContract(goal);
  });

  it('uses the projector authority for an omitted optional role', async () => {
    const changed = JSON.parse(response) as typeof responseObject;
    delete (changed.stated_items[0] as Record<string, unknown>).role;
    const r = await draft(JSON.stringify(changed), brief);
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    expect(graphGoal(r.result)).toMatchObject({
      goal_threshold: 0.88,
      goal_threshold_raw: 88,
      goal_threshold_unit: '%',
      goal_threshold_cap: 100,
      goal_threshold_frame: 'level',
    });
  });

  it('retains a later verified target carried onto an unverified duplicate-goal survivor', async () => {
    const duplicateQuote = 'Margin is -5% now; success is 10%.';
    const duplicateBrief = [
      duplicateQuote,
      'We can open a second warehouse or stay with one warehouse.',
    ].join(' ');
    const duplicateResponse = JSON.stringify({
      stated_items: [
        { kind: 'goal', source_quote: duplicateQuote, value: -5, unit: '%', role: 'baseline' },
        { kind: 'goal', source_quote: duplicateQuote, value: 10, unit: '%', role: 'target' },
        { kind: 'option', source_quote: 'open a second warehouse' },
        { kind: 'option', source_quote: 'stay with one warehouse' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'margin work', basis: [1], category: 'controllable' },
        { claim_kind: 'causal_link', label: 'warehouse change affects margin work', basis: [1], from_stated: 2, to_claim: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'margin work supports success', basis: [1], from_claim: 0, to_stated: 1, effect: 'positive' },
      ],
    });

    const r = await draft(duplicateResponse, duplicateBrief);
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    const goals = r.result.graph.nodes.filter((node) => node.kind === 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      provenance: {
        provenance_class: 'stated',
        brief_binding: 'unverified',
      },
      goal_threshold: 0.1,
      goal_threshold_raw: 10,
      goal_threshold_unit: '%',
      goal_threshold_cap: 100,
      goal_threshold_frame: 'level',
    });
  });

  it.each(['baseline', 'context'] as const)(
    'does not reclassify a current %s reading as the target',
    async (role) => {
      const currentQuote = 'Renewal is currently 72%.';
      const r = await draft(
        withGoal({ source_quote: currentQuote, value: 72, unit: '%', role }),
        `${currentQuote} We can open a second warehouse or stay with one warehouse.`,
      );
      expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
      if (!r.ok) return;
      const goal = graphGoal(r.result);
      expect(goal?.provenance).toMatchObject({
        provenance_class: 'stated',
        brief_binding: 'verified',
      });
      expectNoGoalContract(goal);
    },
  );

  it('keeps a qualitative goal valid without inventing a numeric contract', async () => {
    const qualitativeQuote = 'Improve renewal quality.';
    const changed = JSON.parse(withGoal({ source_quote: qualitativeQuote })) as typeof responseObject;
    delete (changed.stated_items[0] as Record<string, unknown>).value;
    delete (changed.stated_items[0] as Record<string, unknown>).unit;
    delete (changed.stated_items[0] as Record<string, unknown>).role;
    const r = await draft(
      JSON.stringify(changed),
      `${qualitativeQuote} We can open a second warehouse or stay with one warehouse.`,
    );
    expect(r.ok, r.ok ? '' : `draft threw: ${r.error?.message}`).toBe(true);
    if (!r.ok) return;
    expect(graphGoal(r.result)?.label).toMatch(/renewal quality/i);
    expectNoGoalContract(graphGoal(r.result));
  });

  it('retains the raw/legacy anti-fabrication control unchanged', () => {
    const raw = {
      nodes: [{
        id: 'legacy-model-goal',
        kind: 'goal',
        label: 'Grow renewal',
        goal_threshold: 0.88,
        goal_threshold_raw: 88,
        goal_threshold_unit: '%',
        goal_threshold_cap: 100,
        goal_threshold_frame: 'level',
        goal_baseline: 0.72,
        goal_baseline_raw: 72,
      }],
    };
    const stripped = stripModelAuthoredGoalThreshold(raw);
    expect(stripped.nodeIds).toEqual(['legacy-model-goal']);
    expectNoGoalContract(raw.nodes[0]);
  });

  it('protects only projector target fields, never injected baseline fields', () => {
    const seam = projectDraftRecords(responseObject, brief);
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const goal = seam.projection.graph.nodes.find((node) => node.kind === 'goal')!;
    Object.assign(goal, {
      goal_baseline: 0.72,
      goal_baseline_raw: 72,
    });

    const scrubbed = scrubProjectedDraftGoalTargets({
      rawJson: seam.projection.graph,
      records: seam.records,
      projection: seam.projection,
      brief,
    });
    expect(scrubbed.ok).toBe(true);
    if (!scrubbed.ok) return;
    expect(scrubbed.stripped.nodeIds).toEqual([goal.id]);
    expect(scrubbed.stripped.fields).toEqual(expect.arrayContaining([
      'goal_baseline',
      'goal_baseline_raw',
    ]));
    expect(goal).toMatchObject({
      goal_threshold: 0.88,
      goal_threshold_raw: 88,
      goal_threshold_unit: '%',
      goal_threshold_cap: 100,
      goal_threshold_frame: 'level',
    });
    expect(goal).not.toHaveProperty('goal_baseline');
    expect(goal).not.toHaveProperty('goal_baseline_raw');
  });

  it.each([
    ['omitted', undefined],
    ['incompatible', 'days'],
    ['word alias', 'percent'],
    ['long word alias', 'percentage'],
    ['whitespace-padded alias', ' % '],
  ])('refuses a percent target whose unit is %s', async (_caseName, unit) => {
    const changed = JSON.parse(response) as typeof responseObject;
    if (unit === undefined) delete (changed.stated_items[0] as Record<string, unknown>).unit;
    else changed.stated_items[0]!.unit = unit;
    const r = await draft(JSON.stringify(changed), brief);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('anthropic_response_invalid_schema');
    expect(r.error.message).toContain('0:unit_ambiguous');
  });

  it('fails closed when a verified numeric target would leave projection label-only', () => {
    const seam = projectDraftRecords(responseObject, brief);
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const goal = seam.projection.graph.nodes.find((node) => node.kind === 'goal')!;
    for (const field of CEE_MINTED_GOAL_FIELDS) Reflect.deleteProperty(goal, field);

    expect(scrubProjectedDraftGoalTargets({
      rawJson: seam.projection.graph,
      records: seam.records,
      projection: seam.projection,
      brief,
    })).toEqual({
      ok: false,
      issues: [{ statedItemIndex: 0, reason: 'target_unrepresented' }],
    });
  });
});
