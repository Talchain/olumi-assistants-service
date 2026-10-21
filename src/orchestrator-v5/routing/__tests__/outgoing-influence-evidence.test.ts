/**
 * The `outgoing_influence` arm of the enforcing `StructureQuerySchema`.
 *
 * The schema is live: it parses `structure_query` on every router proposal
 * (`ProposalActionSchema` in `../types.ts`). The outgoing-influence evidence
 * builder and composer this file once also covered were deleted as
 * unreachable; the schema arm and its negatives remain and stay pinned here.
 */
import { describe, expect, it } from 'vitest';

import { StructureQuerySchema } from '../types.js';

describe('the outgoing-influence structure query', () => {
  it('accepts the new kind at the enforcing schema, and rejects a malformed one', () => {
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence', element_id: 'focus' }).success)
      .toBe(true);
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence' }).success).toBe(false);
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence', element_id: '' }).success)
      .toBe(false);
    // A stray identity field must not be smuggled through a `.strict()` arm.
    expect(StructureQuerySchema.safeParse({
      kind: 'outgoing_influence', element_id: 'focus', element_ids: ['a', 'b'],
    }).success).toBe(false);
  });
});
