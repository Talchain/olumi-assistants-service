/**
 * TWO THINGS THIS PR OWES A PIN, BOTH DERIVED RATHER THAN HAND-LISTED.
 *
 * 1. THE KNOWN-GAP SET. The bare-leaf translation deliberately does NOT cover
 *    the intervention subtree (15 of the 100 measured refusals on the serving
 *    tip `07da2c0b`): `extractInterventionUpdates` reads those keys OFF THE
 *    OPERATION, so rewriting them would break the option-configure chain.
 *    That gap is honest only if it is RECORDED — a gap the suite cannot see is
 *    how four rounds of oscillation happen. This file pins EXACTLY the set:
 *    it REDs if the set GROWS (a leaf stops translating) and it REDs if the set
 *    SHRINKS (the intervention subtree starts being rewritten behind the
 *    encoder's back).
 *
 *    ⭐ DERIVED FROM THE OWNER, NOT COPIED. The "must translate" side is
 *    `ALLOWED_OBSERVED_SUBKEYS` — the referee's own allowlist, the same single
 *    owner the translator derives from — minus `interventions`. Adding a
 *    tunable subkey to `field-safety.ts` therefore EXTENDS this test
 *    automatically; a hand-kept copy here would drift silently and the drift
 *    would read as green (trap 12).
 *
 * 2. THE DISCLOSURE. "Nothing fails silently" (Paul, 2026-09-15). When the
 *    known gap above refuses, the refusal must now carry a copyable
 *    `request_id`, whose `fault` it was, and a plain-English `readable`.
 *    ⛔ `fault` MUST BE `olumi`: a change the user validly asked for and this
 *    service then discarded is OUR fault, never theirs by elimination.
 *
 * ⚠ THE TWO HALVES ARE IN ONE FILE ON PURPOSE. The refusal they pin is the
 * SAME refusal — the gap is what still refuses, and the disclosure is what that
 * refusal now says. Splitting them would let one be deleted without the other
 * going red.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { canonicaliseValueOps } from '../../canonicalise-value-ops.js';
import { readableNonLandingFailure } from '../edit-failure-disclosure.js';
import { ALLOWED_OBSERVED_SUBKEYS } from '../../../orchestrator-v5/graph-management/field-safety.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

const FACTOR_ID = 'fac_unit_price';
const OPTION_ID = 'opt_a';
const REQUEST_ID = 'req-known-gap-0001';

function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Pricing' },
      { id: OPTION_ID, kind: 'option', label: 'Raise the price' },
      {
        id: FACTOR_ID,
        kind: 'factor',
        label: 'Unit price',
        observed_state: { value: 0.2, raw_value: 20, unit: 'index', cap: 100 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: 'dec_x', to: OPTION_ID, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: OPTION_ID, to: FACTOR_ID, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: FACTOR_ID, to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

/** Did the canonicaliser translate this bare key, or leave it verbatim? */
function translates(key: string, to: unknown): boolean {
  const base = buildGraph();
  const ops = [{ op: 'update_node', path: FACTOR_ID, value: { [key]: to } }] as never;
  const [out] = canonicaliseValueOps(ops, base).operations;
  const value = (out as { value: Record<string, unknown> }).value;
  // Bound by IDENTITY — the exact key path, never a value predicate another
  // key could satisfy. Verbatim means THIS key is still present as written.
  return !Object.prototype.hasOwnProperty.call(value, key);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the bare-leaf translation covers EXACTLY the derived leaf set', () => {
  it('every AI-editable observed subkey except `interventions` is translated', () => {
    // Derived from the referee's own allowlist — NOT a copy of it.
    const mustTranslate = [...ALLOWED_OBSERVED_SUBKEYS].filter((k) => k !== 'interventions');

    // The instrument must have something to measure (a silently empty list
    // would make every assertion below vacuous).
    expect(mustTranslate.length).toBeGreaterThan(0);

    const notTranslated = mustTranslate.filter((k) => !translates(k, 1));
    expect(notTranslated).toEqual([]);
  });

  it('⛔ KNOWN GAP, pinned exactly: the intervention subtree is still left verbatim', () => {
    // These REFUSE today and continue to refuse — honestly, via the landed-op
    // guard — because `extractInterventionUpdates` reads them off the
    // operation. If any of these starts translating, this REDs: the encoder
    // would be silently bypassed.
    const knownGapKeys = [
      'interventions',
      `interventions/${OPTION_ID}`,
      `interventions/${OPTION_ID}/value`,
      `data/interventions/${OPTION_ID}/value`,
      `observed_state.interventions.${OPTION_ID}`,
    ];
    const unexpectedlyTranslated = knownGapKeys.filter((k) => translates(k, 5));
    expect(unexpectedlyTranslated).toEqual([]);
  });

  it('CONTRAST CONTROL: `translates` can return true, so the zeroes above are measurements', () => {
    // Without this, a `translates` that always returned false would make both
    // assertions above pass while measuring nothing.
    expect(translates('unit', '£')).toBe(true);
    expect(translates('value', 69)).toBe(true);
  });
});

describe('nothing fails silently — the refusal discloses request id, fault and plain English', () => {
  it('a still-refused edit carries the disclosure, and the fault is `olumi`', async () => {
    const adapter = {
      name: 'fixtures',
      model: 'test-model',
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          operations: [
            {
              op: 'update_node',
              // The known-gap spelling: still refused, now disclosed.
              path: `/nodes/${FACTOR_ID}/interventions/${OPTION_ID}/value`,
              value: 5,
              old_value: 1,
              impact: 'moderate',
              rationale: 'Apply the change the user asked for.',
            },
          ],
          removed_edges: [],
          warnings: [],
          coaching: { summary: 'Updated.', rerun_recommended: true },
        }),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'test-model',
        latencyMs: 1,
        stopReason: 'end_turn',
      }),
    } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      { graph: buildGraph(), analysis_response: null, framing: null, messages: [], scenario_id: 'scn-gap' } as unknown as ConversationContext,
      'Set that intervention to 5',
      adapter,
      REQUEST_ID,
      'turn-known-gap',
    );

    expect(result.wasRejected).toBe(true);

    // WALK for the disclosure rather than guessing a block path — a wrong path
    // returns undefined identically to "no disclosure", which would make this
    // assertion vacuous in the most convincing way.
    let found: Record<string, unknown> | null = null;
    const walk = (v: unknown): void => {
      if (found !== null || v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach(walk); return; }
      const rec = v as Record<string, unknown>;
      const d = rec.disclosure as Record<string, unknown> | undefined;
      if (d !== undefined && typeof d.readable === 'string') { found = d; return; }
      Object.values(rec).forEach(walk);
    };
    walk(result.blocks);

    expect(found).not.toBeNull();
    const disclosure = found as unknown as Record<string, unknown>;
    // Copyable, and it is THIS request — bound by identity, not by shape.
    expect(disclosure.request_id).toBe(REQUEST_ID);
    // ⛔ THE LOAD-BEARING ONE. Never the user's fault by elimination.
    expect(disclosure.fault).toBe('olumi');
    // Plain English for a person, not a code: it must not be the enum member.
    expect(disclosure.readable).toBe(
      readableNonLandingFailure('update_writes_did_not_survive'),
    );
    expect(disclosure.readable as string).not.toMatch(/update_writes_did_not_survive|OPERATION_DID_NOT_LAND|_/);
    // And it must say the two things a person needs to hear.
    expect(disclosure.readable as string).toMatch(/nothing in your model has changed/i);
    expect(disclosure.readable as string).toMatch(/fault on our side/i);
  });

  it('every NonLandingReason has plain-English copy — no code leaks to a user', () => {
    // The closed enum, restated here ONLY as the corpus to walk; the `never`
    // arm in `readableNonLandingFailure` is what makes a missing arm a TYPE
    // error, so this cannot silently go short.
    const reasons = [
      'added_entity_missing_from_canonical',
      'removed_entity_still_present',
      'added_edge_missing_from_canonical',
      'edge_target_path_unparseable',
      'update_writes_did_not_survive',
      'unknown_op_kind',
      'check_threw',
    ] as const;
    for (const reason of reasons) {
      const copy = readableNonLandingFailure(reason);
      expect(copy.length).toBeGreaterThan(40);
      expect(copy).not.toContain('_');
      expect(copy).toMatch(/nothing in your model has changed/i);
    }
  });
});
