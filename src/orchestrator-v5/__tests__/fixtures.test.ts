/**
 * Self-test for the shared turn-payload fixture factories.
 *
 * Guards against `OrchestratorTurnPayload` schema drift recurring at the
 * fixture layer. Earlier history: the factories' default `turn_id` /
 * `scenario_id` were opaque strings (`'t-001'`, `'scen-abc'`) that
 * passed typecheck but failed `safeParse` because the runtime schema
 * applies a `.uuid()` refinement invisible at the type level. If a
 * future schema bump tightens any other field on either branch, this
 * test surfaces it before downstream tests inherit broken fixtures.
 */

import { describe, expect, it } from 'vitest';

import {
  MessageTurnPayloadSchema,
  OrchestratorTurnPayloadSchema,
  SystemEventTurnPayloadSchema,
} from '@talchain/schemas/boundary';

import { makeMessagePayload, makeSystemEventPayload } from './fixtures.js';

describe('turn-payload fixture factories', () => {
  it('makeMessagePayload() defaults satisfy MessageTurnPayloadSchema at runtime', () => {
    const result = MessageTurnPayloadSchema.safeParse(makeMessagePayload());
    expect(result.success).toBe(true);
  });

  it('makeSystemEventPayload() defaults satisfy SystemEventTurnPayloadSchema at runtime', () => {
    const result = SystemEventTurnPayloadSchema.safeParse(makeSystemEventPayload());
    expect(result.success).toBe(true);
  });

  // Belt-and-braces: also parse through the discriminated union so any
  // union-level refinement (e.g. cross-branch `superRefine` rules) is
  // covered by the self-test.
  it('both factory defaults satisfy the OrchestratorTurnPayloadSchema union', () => {
    expect(OrchestratorTurnPayloadSchema.safeParse(makeMessagePayload()).success).toBe(true);
    expect(OrchestratorTurnPayloadSchema.safeParse(makeSystemEventPayload()).success).toBe(true);
  });
});
