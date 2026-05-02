/**
 * V5 D1 golden-path closure (A3.1 Task 4) — strict rejection of
 * `raw_value` in proposal parameters.
 *
 * Pre-fix `StructuredValueSchema` declared `raw_value` as an optional
 * field but `parseProposalValue` ignored it. A proposal carrying
 * `{ value: 5, raw_value: 0.05 }` silently used the model-unit value
 * (5) and dropped raw_value — a footgun for any future caller that
 * intended raw_value to be authoritative.
 *
 * Post-fix the schema removes `raw_value`. With `.strict()` already
 * enforced, Zod now rejects unknown keys explicitly.
 */

import { describe, it, expect } from 'vitest';

import { SetFactorValueValueSchema } from '../set-factor-value.js';

describe('A3.1 Task 4 — SetFactorValueValueSchema rejects raw_value', () => {
  it('structured value with raw_value → Zod failure with "unrecognized" message', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 5,
      raw_value: 0.05,
      unit: '%',
      cap: 100,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues;
    expect(issues.length).toBeGreaterThan(0);
    // Zod reports unknown-key strictness as `unrecognized_keys`.
    expect(
      issues.some((iss) => iss.code === 'unrecognized_keys'),
    ).toBe(true);
  });

  it('structured value WITHOUT raw_value → still accepted', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 5,
      unit: '%',
      cap: 100,
    });
    expect(result.success).toBe(true);
  });

  it('primitive number → still accepted (bare-number proposal path)', () => {
    expect(SetFactorValueValueSchema.safeParse(0.5).success).toBe(true);
    expect(SetFactorValueValueSchema.safeParse(50000).success).toBe(true);
  });

  it('structured value with unit only → accepted', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 50000,
      unit: '£',
    });
    expect(result.success).toBe(true);
  });
});

describe('A3.1 — standalone `raw_value` parameter is silently ignored (documented contract)', () => {
  // DEFERRED VALIDATOR LIMITATION (flagged by post-A3.1 review):
  //
  // The V5 validator's parameter_schemas loop in
  // `routing/validator.ts:241` only validates parameters whose `name`
  // is declared in the handler's `parameter_schemas`. An UNDECLARED
  // parameter (e.g. a separate `parameters: [..., { name:
  // 'raw_value', value: 0.05 }]` entry) bypasses Zod entirely and is
  // silently ignored by `parseProposalValue`, which only reads the
  // parameter named 'value'. The handler's strict StructuredValueSchema
  // catches `raw_value` ONLY when nested inside the structured value
  // object (`{ value, raw_value }`); a top-level rogue parameter
  // entry slips through.
  //
  // Why this is acceptable for now:
  //   - No production caller emits a top-level `raw_value` parameter
  //     (Sonnet's tool schema doesn't advertise it; the handler's
  //     own parseProposalValue only reads `value`).
  //   - Tightening the validator to reject unknown parameter names is
  //     a broader cross-handler change (every handler would need a
  //     declared-parameters allowlist) — flagged for a future brief
  //     alongside required-parameter enforcement.
  //
  // This test pins the silent-ignore contract so a future change
  // either preserves it (no regression) or arrives bundled with the
  // broader validator update. If/when the cross-handler enforcement
  // lands, this test should flip to assert PARAMETER_INVALID.
  it('a separate parameter named "raw_value" does not influence set_factor_value', async () => {
    const { createSetFactorValueHandler } = await import('../set-factor-value.js');
    const { buildD1Fixture } = await import('../d1-shared/__tests__/fixtures.js');
    const { GraphV3 } = await import('../../../../schemas/cee-v3.js');
    const handler = createSetFactorValueHandler();
    const ingress = buildD1Fixture();
    const outcome = await handler({
      context: {
        session_id: 'scn-rv',
        stage: 'frame',
        request_id: 'req-rv',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as never,
      payload: {
        kind: 'message',
        scenario_id: 'scn-rv',
        turn_id: 'turn-rv',
        stage: 'frame',
        message: 'mutate',
      } as never,
      requestId: 'req-rv',
      signal: new AbortController().signal,
      orientationText: '',
      proposal: {
        handler_id: 'set_factor_value',
        entity: {
          id: 'f-churn',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [
          {
            name: 'value',
            value: { value: 5, unit: '%', cap: 100 },
            operator: 'set',
            source: 'user_explicit',
          },
          // Standalone raw_value parameter — neither declared by the
          // validator nor read by the handler. Must NOT influence the
          // mutation outcome.
          {
            name: 'raw_value',
            value: 99.99,
            source: 'user_explicit',
          },
        ],
        cited_context_fields: [],
      },
      graphForTurn: ingress,
    } as never);
    const mutated = outcome.mutated_graph as ReturnType<typeof buildD1Fixture>;
    const churn = mutated.nodes.find((n) => n.id === 'f-churn');
    // The mutation reflects the `value` parameter (5%, normalised to
    // 0.05), NOT the rogue raw_value parameter (99.99).
    expect(churn?.observed_state?.raw_value).toBe(5);
    expect(churn?.observed_state?.value).toBe(0.05);
    expect(GraphV3.safeParse(mutated).success).toBe(true);
  });
});
