/**
 * ⭐⭐ THE FOUR-POINT OPTION→FACTOR MAGNITUDE CENSUS — points 1-3 (the draft
 * adapter). Point 4 (`at_commit`) is pinned in
 * `src/orchestrator-v5/__tests__/commit-option-magnitude-census.test.ts`.
 *
 * WHAT THIS PINS, and why a unit test of the census function could not.
 * `option-magnitude-census.test.ts` proves the FUNCTION counts correctly. It
 * cannot see whether the function is CALLED, or whether each call is pointed at
 * the artefact its `point` name claims. That is the whole question here — an
 * instrument wired to the wrong artefact reports a confident number about
 * something else, and every unit test still passes (trap 3b's shape at the
 * emission site). So this drives the REAL `draftGraphWithAnthropic` with only
 * the provider SDK mocked, and reads the emitted telemetry.
 *
 * ⭐ THE TWO CASES EXIST TO MAKE THE THREE POINTS DISAGREE. A spec in which all
 * three arms expect the same number cannot tell an arm bound to its own point
 * from an arm reading a shared value — every arm would pass either way (trap
 * 20's uniformity heuristic: when a per-item probe returns the same answer for
 * every item, the probe is suspect). So:
 *
 *   CASE A — the completion pass is NOT attempted (zero answerable ask items),
 *     and OPTION FRAMING withdraws the question-shaped baseline option along
 *     with its option→factor edge. Expected: 3/3 → 3/3 → 2/2. This is the pair
 *     that discriminates `after_completion` from `after_projection`.
 *
 *   CASE B — the completion pass IS attempted and its claim IS kept, supplying
 *     a magnitude for one option. Expected: 2/2 → 2/1 → 2/1. This is the pair
 *     that discriminates `before_completion` from `after_completion`.
 *
 * Every expected number was derived by running the PRODUCERS themselves
 * (`projectDraftRecords` → `mergeCompletionClaims` + `projectRecordsToGraph` →
 * `reconcileDraftOptionFraming`) over these exact record sets, not read back
 * off the emission sites under test.
 *
 * ⭐ CASE A ALSO PINS THAT `after_completion` FIRES WHEN NO COMPLETION RAN.
 * A census that only emitted inside the `answerableAskItems > 0` branch would
 * go silent on exactly the drafts where pass 1 produced nothing to complete —
 * i.e. it would be missing from the population it most needs to describe, and
 * the gap would look like "no drafts had this problem".
 *
 * MUTATION-CHECK (recorded in the PR body; run in a throwaway worktree):
 * each of the three emission sites in `anthropic.ts` was mutated separately —
 * repointed at a neighbouring point's artefact — and only that point's arms
 * went RED.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectDraftRecords } from '../seam.js';
import { enumerateCompletionAsk, modelAnswerableAskItems } from '../completion.js';
import { censusOptionFactorMagnitudes } from '../option-magnitude-census.js';
import type { DraftRecordSet } from '../grammar.js';
import { TelemetryEvents, setTestSink } from '../../../../utils/telemetry.js';

const h = vi.hoisted(() => ({
  payload: '',
  completionPayload: JSON.stringify({ claims: [] }),
  streamCalls: 0,
  completionCalls: 0,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        h.streamCalls++;
        const text = h.payload;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
      create: async () => {
        h.completionCalls++;
        return {
          content: [{ type: 'text', text: h.completionPayload }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        };
      },
    };
  }
  return { default: MockAnthropic };
});

let draftGraphWithAnthropic: typeof import('../../../../adapters/llm/anthropic.js').draftGraphWithAnthropic;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-magnitude-census';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../../../../adapters/llm/anthropic.js'));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { _resetConfigCache } = await import('../../../../config/index.js');
  _resetConfigCache();
});

interface CapturedEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}
let captured: CapturedEvent[] = [];

beforeEach(() => {
  h.payload = '';
  h.completionPayload = JSON.stringify({ claims: [] });
  h.streamCalls = 0;
  h.completionCalls = 0;
  captured = [];
  setTestSink((name, data) => {
    captured.push({ name, data: data as Record<string, unknown> });
  });
});

afterEach(() => {
  setTestSink(null);
});

/**
 * Every census event emitted for the draft, in emission order. Bound by the
 * frozen EVENT NAME, never by a shape predicate another event could satisfy
 * (`ask_items`-carrying completion telemetry is emitted on the same path).
 */
function censusEvents(): CapturedEvent[] {
  return captured.filter((e) => e.name === TelemetryEvents.CeeDraftOptionMagnitudeCensus);
}

/**
 * The one event for `point`. Asserts EXACTLY ONE — a site that fired twice, or
 * two sites that both claimed the same point, would otherwise pass silently
 * while the four-point structure had quietly become three.
 */
function at(point: string): Record<string, unknown> {
  const matches = censusEvents().filter((e) => e.data.point === point);
  expect(matches, `exactly one census event at point "${point}"`).toHaveLength(1);
  return matches[0]!.data;
}

const QUESTION = 'Should we expand delivery capacity?';
const BRIEF =
  `${QUESTION} Compare opening a second warehouse with partnering with a fulfilment provider. ` +
  'Our goal is to improve delivery reliability.';

const STATED_ITEMS = [
  { kind: 'goal', source_quote: 'improve delivery reliability' },
  { kind: 'option', source_quote: QUESTION, is_baseline: true },
  { kind: 'option', source_quote: 'opening a second warehouse', is_baseline: false },
  { kind: 'option', source_quote: 'partnering with a fulfilment provider', is_baseline: false },
];

/**
 * CASE A — the question option IS linked to the factor, which leaves the
 * completion nothing answerable to ask for, and option framing then withdraws
 * that option together with its edge. NOT ONE `sets_to` ANYWHERE: this is the
 * shape the deployed traffic actually shows.
 */
function caseARecords(): DraftRecordSet {
  return {
    stated_items: STATED_ITEMS,
    claims: [
      { claim_kind: 'factor', label: 'Fulfilment capacity', category: 'controllable', basis: [2, 3] },
      { claim_kind: 'causal_link', label: 'Question option touches capacity', from_stated: 1, to_claim: 0 },
      { claim_kind: 'causal_link', label: 'Warehouse expands capacity', from_stated: 2, to_claim: 0 },
      { claim_kind: 'causal_link', label: 'Partner supplies capacity', from_stated: 3, to_claim: 0 },
      { claim_kind: 'causal_link', label: 'Capacity improves delivery', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  } as unknown as DraftRecordSet;
}

/**
 * CASE B — the question option is left UNLINKED, which raises one answerable
 * ask item (`option_without_chain`) and buys the completion turn.
 */
function caseBRecords(): DraftRecordSet {
  return {
    stated_items: STATED_ITEMS,
    claims: [
      { claim_kind: 'factor', label: 'Fulfilment capacity', category: 'controllable', basis: [2, 3] },
      { claim_kind: 'causal_link', label: 'Warehouse expands capacity', from_stated: 2, to_claim: 0 },
      { claim_kind: 'causal_link', label: 'Partner supplies capacity', from_stated: 3, to_claim: 0 },
      { claim_kind: 'causal_link', label: 'Capacity improves delivery', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  } as unknown as DraftRecordSet;
}

async function draft(records: DraftRecordSet): Promise<void> {
  h.payload = JSON.stringify(records);
  await draftGraphWithAnthropic(
    { brief: BRIEF, docs: [], seed: 17, model: 'claude-sonnet-4-6' },
    { timeoutMs: 120_000, forceDefault: true },
  );
  expect(h.streamCalls, 'the draft turn must have been taken').toBe(1);
}

describe('option→factor magnitude census — the three draft-adapter points', () => {
  it('CASE A: no completion attempted; option framing withdraws an option AND its unvalued edge (3/3 → 3/3 → 2/2)', async () => {
    const records = caseARecords();

    // PRECONDITION, PINNED IN-TEST. Without this the case could stop buying a
    // completion turn (or start buying one) after an unrelated change, and the
    // "after_completion equals before_completion" arm below would still pass —
    // asserting nothing about the branch it was written for.
    const seam = projectDraftRecords(records, BRIEF);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error('case A records must project');
    expect(
      modelAnswerableAskItems(enumerateCompletionAsk(seam.records, seam.projection)),
      'case A must raise NO answerable ask item, or it is not the no-completion case',
    ).toHaveLength(0);

    await draft(records);
    expect(h.completionCalls, 'no completion turn may be bought in case A').toBe(0);

    expect(at('before_completion')).toMatchObject({ option_factor_edges: 3, missing_magnitude: 3 });
    expect(at('after_completion')).toMatchObject({ option_factor_edges: 3, missing_magnitude: 3 });
    expect(at('after_projection')).toMatchObject({ option_factor_edges: 2, missing_magnitude: 2 });
  });

  it('CASE B: a kept completion supplies one magnitude (2/2 → 2/1 → 2/1)', async () => {
    const records = caseBRecords();

    const seam = projectDraftRecords(records, BRIEF);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error('case B records must project');
    expect(
      modelAnswerableAskItems(enumerateCompletionAsk(seam.records, seam.projection)).length,
      'case B must raise an answerable ask item, or no completion turn is bought and the arm is vacuous',
    ).toBeGreaterThan(0);

    h.completionPayload = JSON.stringify({
      claims: [
        {
          claim_kind: 'causal_link',
          label: 'Warehouse sets capacity level',
          from_stated: 2,
          to_claim: 0,
          sets_to: 0.8,
        },
      ],
    });

    await draft(records);
    expect(h.completionCalls, 'the completion turn must have been taken').toBe(1);

    expect(at('before_completion')).toMatchObject({ option_factor_edges: 2, missing_magnitude: 2 });
    expect(at('after_completion')).toMatchObject({ option_factor_edges: 2, missing_magnitude: 1 });
    expect(at('after_projection')).toMatchObject({ option_factor_edges: 2, missing_magnitude: 1 });
  });

  it('emits all three adapter points exactly once, in chain order, on one draft', async () => {
    await draft(caseARecords());
    expect(censusEvents().map((e) => e.data.point)).toEqual([
      'before_completion',
      'after_completion',
      'after_projection',
    ]);
  });

  it('carries the idempotency key on every adapter point so the three are correlatable', async () => {
    await draft(caseARecords());
    const keys = censusEvents().map((e) => e.data.idempotency_key);
    expect(keys.every((k) => typeof k === 'string' && (k as string).length > 0)).toBe(true);
    expect(new Set(keys).size, 'all three adapter points belong to one draft').toBe(1);
  });

  it('the emitted before_completion census equals an independent projection of the same records', async () => {
    // A SECOND, INDEPENDENT DERIVATION of point 1: project the records here and
    // census that. If the emission site were pointed at a different artefact —
    // the post-completion projection, say — this arm would disagree even when
    // the hardcoded numbers above happened to coincide.
    const records = caseARecords();
    const seam = projectDraftRecords(records, BRIEF);
    if (!seam.ok) throw new Error('records must project');
    const independent = censusOptionFactorMagnitudes(seam.projection.graph);

    await draft(records);
    expect(at('before_completion')).toMatchObject({
      option_factor_edges: independent.option_factor_edges,
      missing_magnitude: independent.missing_magnitude,
    });
  });
});
