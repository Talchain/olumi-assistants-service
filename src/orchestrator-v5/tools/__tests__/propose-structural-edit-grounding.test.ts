/**
 * THE STRUCTURAL-EDIT OP VOCABULARY IS THE CANONICAL ONE — no second grammar.
 *
 * ⚠ 21 Oct 2026 — the coach's structural-edit tool (`propose-structural-edit.ts`)
 * and its grounding validator were retired (superseded by the core
 * `propose_change`); every row about the validator, its grounding table and its
 * advert went with them. `STRUCTURAL_EDIT_OPS` survives in
 * `system-events/dispatch.ts`, where it types `READER_ONLY_CHAT_ROUTE_OPS`, and
 * `reader-only-refusal-capability-honesty.test.ts` relies on it being pinned both
 * ways to the enforcing `PatchOperation` union. This row is that pin.
 */
import { describe, expect, it } from 'vitest';

import { STRUCTURAL_EDIT_OPS } from '../../system-events/dispatch.js';
import { PatchOperationSchema } from '../../../orchestrator/patch-validation.js';

describe('the op vocabulary is the canonical one (A1) — no second grammar', () => {
  it('every structural-edit op is a real PatchOperation discriminator, and every discriminator is listed', () => {
    // DERIVED from the enforcing schema, both directions — the union assertion
    // that notices a new canonical op with no row here (trap 12d).
    const canonical = PatchOperationSchema.options
      .map((o) => o.shape.op.value)
      .sort();
    expect([...STRUCTURAL_EDIT_OPS].sort()).toEqual(canonical);
  });
});
