/**
 * A REUSED OPERATION ID CARRYING A DIFFERENT INSTRUCTION MUST REFUSE, NOT NARRATE.
 *
 * ⛔ WITNESSED ON DEPLOYED STAGING (build `a459d23`), two trials, deterministic,
 *    with a 3s settle to exclude a late write:
 *
 *      turn T1  "change Sales Cycle Length to 14"  -> applied, value 14, 1 turn row
 *      turn T1  "change Sales Cycle Length to 25"  -> HTTP 200, value STILL 14
 *
 *      assistant_text: "Updated Sales Cycle Length from 14 months to 25 months."
 *      blocks[0]: graph_patch status:'applied' after:{value:1.25,raw_value:25,…}
 *
 *    The durable key did its job — nothing was written, no second turn row. The
 *    NARRATION and the WIRE CONTRACT both claimed an edit that never happened,
 *    in the direction of the number the user had just asked for.
 *
 * ⛔ THE RATIONALE THIS REPLACES WAS MEASURABLY FALSE. `supabase-store.ts` said a
 *    hash mismatch fell back to "the caller composes fresh text … never a wrong
 *    answer, only no answer". Fresh text is composed FROM THE PROPOSED PATCH, so
 *    the fallback is precisely how the wrong answer is produced. I wrote that
 *    comment without measuring it.
 *
 * ⭐ WHY THIS IS NOT THE REPLAY FIX RELABELLED. A replay is the SAME request
 *    arriving twice; "that change had already been recorded" is TRUE. A reused id
 *    is a DIFFERENT request the key refused; saying "already recorded" would be
 *    the same lie in a politer register — the user's NEW instruction was never
 *    carried out. The two arms are pinned apart below, in both directions.
 */
import { describe, it, expect } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore } from '../session/store.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The prose the deployed build actually emitted for the REUSED id. */
const FRESH = 'Updated Sales Cycle Length from 14 months to 25 months.';

/** Authoritative state: the FIRST instruction stuck. The model holds 14, not 25. */
const GRAPH_AT_14 = {
  nodes: [
    {
      id: 'bc936d4c',
      kind: 'factor',
      label: 'Sales Cycle Length',
      display_value: '14 months',
      observed_state: { unit: 'months', value: 0.7, raw_value: 14 },
    },
  ],
  edges: [],
};

function composed() {
  const base = composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: FRESH,
    stage: 'analyse',
  });
  return {
    ...base,
    // Real wire shapes: GraphPatchBlockSchema.before/after is
    // Record<string, unknown> | null; UiDirectiveBlockObjectSchema needs
    // `verb` + `targets: TargetRef[]`. A fixture that is not the wire shape
    // can pass while the production block it stands for would not.
    blocks: [
      {
        type: 'graph_patch',
        status: 'applied',
        operation: 'set_factor_value',
        target_id: 'bc936d4c',
        before: { value: 14, unit: 'months' },
        after: { value: 25, unit: 'months' },
      },
      {
        type: 'ui_directive',
        verb: 'open_inspector',
        targets: [{ id: 'bc936d4c', label: 'Sales Cycle Length', kind: 'factor' }],
      },
    ],
  } as typeof base;
}

const meta = () => ({
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 0,
  duration_ms: 1,
  handler_facts: [],
});

/**
 * A receipt shaped as `append_turn_atomic_v5` actually returns one.
 *
 * ⚠ It is NOT self-validating on its own — an invented shape would simply be
 *   dropped by `toModelVersionMutationReceiptV1` and every "absent" assertion
 *   would pass VACUOUSLY. The REPLAY arm below is the control that makes this
 *   fixture load-bearing: it requires the receipt to be PRESENT, so a bad shape
 *   turns that test red rather than silently strengthening the others.
 */
const RECEIPT = {
  mutation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  version_number: 2,
  graph_identity_hash: 'a'.repeat(64),
  analysis_affecting_hash: 'b'.repeat(64),
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  actor_kind: 'unknown' as const,
  authored_by: null,
  creation_kind: 'committed_mutation' as const,
  source_version_id: null,
  source_turn_id: TURN_ID,
  parent_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  undo_version_id: null,
  graph: GRAPH_AT_14,
  event_id: 'model_version_created_mutation_dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

function storeWithReceipt(verdict: 'conflict' | 'replay'): SessionStore {
  const base = createNoopSessionStore();
  return {
    ...base,
    append: async () => ({
      id: 'turn-row',
      modelVersionReceipt: RECEIPT,
      ...(verdict === 'conflict'
        ? { priorTurnConflict: true as const }
        : { replayedPriorTurn: true as const }),
    }),
    loadGraph: async () => GRAPH_AT_14,
  } as unknown as SessionStore;
}

function storeReporting(
  verdict: 'conflict' | 'replay',
  loadGraph: () => Promise<unknown> = async () => GRAPH_AT_14,
): SessionStore {
  const base = createNoopSessionStore();
  return {
    ...base,
    append: async () => ({
      id: 'turn-row',
      ...(verdict === 'conflict'
        ? { priorTurnConflict: true as const }
        : { replayedPriorTurn: true as const }),
    }),
    loadGraph,
  } as SessionStore;
}

const blocksOf = (r: unknown) => ((r as { blocks?: unknown }).blocks ?? []) as Array<Record<string, unknown>>;
const textOf = async (verdict: 'conflict' | 'replay') =>
  (await commitDirectAnswer(composed(), meta() as never, storeReporting(verdict))).response.assistant_text;

describe('a reused operation id refuses truthfully', () => {
  it('RED: the prose does NOT claim the edit happened', async () => {
    expect(
      await textOf('conflict'),
      'the deployed build said "Updated … to 25 months" while the model held 14',
    ).not.toMatch(/\bUpdated\b/i);
  });

  it('RED: the prose does NOT contain the value that was never written', async () => {
    expect(
      await textOf('conflict'),
      'naming 25 at all invites the user to believe it landed',
    ).not.toMatch(/\b25\b/);
  });

  it('RED: the machine-readable graph_patch does NOT say `applied`', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting('conflict'));
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch, 'the block must survive — it is the contract, not decoration').toBeDefined();
    expect(
      patch?.status,
      'compose.ts treats assistant_text as the FALLBACK and the block as the contract',
    ).toBe('noop');
  });

  it('RED: the `after` carries AUTHORITATIVE current state, not the refused value', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting('conflict'));
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch?.after).toMatchObject({ raw_value: 14 });
  });

  it('RED: the open_inspector directive is dropped — no node was changed', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeReporting('conflict'));
    expect(blocksOf(r.response).some((b) => b.type === 'ui_directive')).toBe(false);
  });

  it('RED: it states plainly that the change was NOT made', async () => {
    expect(await textOf('conflict')).toMatch(/did not make that change/i);
  });

  /**
   * ⭐ THE DISCRIMINATING PAIR. Collapsing the two verdicts in EITHER direction
   *    turns one of these red — which a `status === 'noop'` assertion alone,
   *    satisfied identically by both arms, would never catch.
   */
  it('DISCRIMINATOR: a conflict must NOT be told it was "already recorded"', async () => {
    expect(
      await textOf('conflict'),
      'that sentence is true for a replay and FALSE here — the instruction never ran',
    ).not.toMatch(/already been recorded/i);
  });

  it('CONTROL: the replay arm still says exactly that, and is unchanged', async () => {
    const t = await textOf('replay');
    expect(t).toMatch(/already been recorded/i);
    expect(t).not.toMatch(/did not make that change/i);
    expect(t).not.toMatch(/\bUpdated\b/i);
  });

  it('CONTROL: an unreadable graph does not invent state on either arm', async () => {
    const boom = async () => {
      throw new Error('unreadable');
    };
    for (const verdict of ['conflict', 'replay'] as const) {
      const r = await commitDirectAnswer(composed(), meta() as never, storeReporting(verdict, boom));
      const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
      expect(patch?.status).toBe('noop');
      expect(patch?.after, 'null is the structured current-state-unavailable signal').toBeNull();
      expect(r.response.assistant_text).not.toMatch(/\b25\b/);
    }
  });
});


/**
 * ⛔ A CONFLICT MUST NOT HAND BACK THE PRIOR OPERATION'S RECEIPT.
 *
 * `append_turn_atomic_v5` returns the ORIGINAL operation's receipt on a reused
 * id, because the deterministic mutation id is derived from
 * `scenario_id + turn_id` — exactly what a reused id shares. So the response
 * said "I did not make that change" while still carrying a
 * `model_version_receipt`, and `CommitResult.modelVersionReceipt` was non-null.
 * A consumer reading the receipt rather than the prose concludes the write
 * happened: the same false success, moved into the structured carrier.
 *
 * Nothing is removed from the RPC or from durable version history. The receipt
 * is TRUE of the earlier operation; it is simply not the receipt of THIS request.
 */
describe('a conflict does not hand back the prior operation receipt', () => {
  it('CONTROL — a genuine replay STILL recovers the receipt, on both carriers', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeWithReceipt('replay'));
    expect(
      (r.response as Record<string, unknown>).model_version_receipt,
      'if this is absent the RECEIPT fixture is malformed and every absence assertion below is vacuous',
    ).toBeDefined();
    expect(r.modelVersionReceipt, 'a replay may truthfully recover the original receipt').not.toBeNull();
  });

  it('RED: on a conflict the response carries NO model_version_receipt', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeWithReceipt('conflict'));
    expect((r.response as Record<string, unknown>).model_version_receipt).toBeUndefined();
  });

  it('RED: on a conflict CommitResult.modelVersionReceipt is null', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeWithReceipt('conflict'));
    expect(
      r.modelVersionReceipt,
      'the two carriers must agree — a consumer reading one and rendering the other diverges',
    ).toBeNull();
  });

  it('the prose and patch assertions still hold with a receipt in play', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never, storeWithReceipt('conflict'));
    expect(r.response.assistant_text).toMatch(/did not make that change/i);
    expect(r.response.assistant_text).not.toMatch(/\b25\b/);
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch?.status).toBe('noop');
    expect(patch?.after).toMatchObject({ raw_value: 14 });
  });
});
