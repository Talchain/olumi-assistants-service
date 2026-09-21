/**
 * R8 held_proposal builder — fail-closed pins.
 *
 * The builder is the only source of held_proposal blocks; every guard must
 * fail to `null` (emit nothing) rather than risk a malformed KNOWN block
 * strict-failing the whole envelope UI-side (R4 hazard class).
 */
import { describe, expect, it } from 'vitest';

import { HeldProposalBlockSchema } from '@talchain/schemas/boundary';
import { buildHeldProposalBlock } from '../held-proposal.js';

const GRAPH = {
  nodes: [
    { id: 'fac_price', label: 'Price', kind: 'factor' },
    { id: 'fac_idlike', label: 'fac_idlike', kind: 'factor' },
  ],
  edges: [],
} as unknown as Parameters<typeof buildHeldProposalBlock>[0]['graph'];

function baseInput() {
  return {
    proposalId: 'gmh_abc123def456',
    confirmActionId: 'gmh_abc123def456',
    mutationClass: 'tunable' as string | null,
    blockerCode: 'TUNABLE_APPLY_HELD' as string | null,
    targetKey: 'node:fac_price',
    graph: GRAPH,
  };
}

describe('buildHeldProposalBlock', () => {
  it('happy path: node target resolves to a label; block is strict-schema valid', () => {
    const block = buildHeldProposalBlock(baseInput());
    expect(block).not.toBeNull();
    expect(HeldProposalBlockSchema.safeParse(block).success).toBe(true);
    expect(block!.summary).toBe("A change to 'Price' is held for your confirmation.");
    expect(block!.reason_code).toBe('TUNABLE_APPLY_HELD');
    expect(block!.mutation_class).toBe('tunable');
    expect(block!.confirm_action_id).toBe('gmh_abc123def456');
    expect(block!.decline_action_id).toBeUndefined();
  });

  it.each([
    'GRAPH_OPTIONS_MALFORMED',
    'READINESS_DOWNGRADE',
    'OPTION_ID_COLLISION',
    'CANDIDATE_BUILD_FAILED',
    'SOME_FUTURE_CODE',
  ])('held-reachable but non-ratified reason code %s → null (fail-closed)', (code) => {
    expect(buildHeldProposalBlock({ ...baseInput(), blockerCode: code })).toBeNull();
  });

  it('null blocker code → null', () => {
    expect(buildHeldProposalBlock({ ...baseInput(), blockerCode: null })).toBeNull();
  });

  it.each(['non_mutating', null, 'anything_else'])(
    'mutation_class %s (outside structural|tunable) → null',
    (mutationClass) => {
      expect(
        buildHeldProposalBlock({ ...baseInput(), mutationClass: mutationClass as string | null }),
      ).toBeNull();
    },
  );

  it('empty confirmActionId → null (the block must reference a REAL chip)', () => {
    expect(buildHeldProposalBlock({ ...baseInput(), confirmActionId: '' })).toBeNull();
  });

  it('edge target → generic summary (no label resolution attempted)', () => {
    const block = buildHeldProposalBlock({
      ...baseInput(),
      targetKey: 'edge:fac_price->goal_revenue',
    });
    expect(block!.summary).toBe('A change to the model is held for your confirmation.');
  });

  it('node target with no matching graph node → generic summary, never id-as-label', () => {
    const block = buildHeldProposalBlock({ ...baseInput(), targetKey: 'node:fac_missing' });
    expect(block!.summary).toBe('A change to the model is held for your confirmation.');
    expect(block!.summary).not.toContain('fac_');
  });

  it('node whose stored label is id-shaped → generic summary (resolveLabel unsafe-label guard)', () => {
    const block = buildHeldProposalBlock({ ...baseInput(), targetKey: 'node:fac_idlike' });
    expect(block!.summary).toBe('A change to the model is held for your confirmation.');
  });

  it('null graph → generic summary, still schema-valid', () => {
    const block = buildHeldProposalBlock({ ...baseInput(), graph: null });
    expect(block!.summary).toBe('A change to the model is held for your confirmation.');
    expect(HeldProposalBlockSchema.safeParse(block).success).toBe(true);
  });

  it('structural class + STRUCTURAL_APPLY_HELD maps cleanly', () => {
    const block = buildHeldProposalBlock({
      ...baseInput(),
      mutationClass: 'structural',
      blockerCode: 'STRUCTURAL_APPLY_HELD',
      targetKey: 'ref:cand-1',
    });
    expect(block!.mutation_class).toBe('structural');
    expect(block!.reason_code).toBe('STRUCTURAL_APPLY_HELD');
  });
});

describe('wave-2 ask #20 — the card body carries the FULL changeset description', () => {
  const DESCRIPTION =
    "remove the link from 'Price' to 'Demand', remove the link from 'Supply' to 'Cost' and add option 'Go Direct'";

  it('a safe changeset description becomes the summary verbatim', () => {
    const block = buildHeldProposalBlock({
      ...baseInput(),
      changesetDescription: DESCRIPTION,
    });
    expect(block).not.toBeNull();
    expect(block!.summary).toBe(`Held for your confirmation: ${DESCRIPTION}.`);
    expect(HeldProposalBlockSchema.safeParse(block).success).toBe(true);
  });

  it('null / absent description falls back to the pre-#20 single-target template', () => {
    expect(buildHeldProposalBlock({ ...baseInput(), changesetDescription: null })!.summary).toBe(
      "A change to 'Price' is held for your confirmation.",
    );
    expect(buildHeldProposalBlock(baseInput())!.summary).toBe(
      "A change to 'Price' is held for your confirmation.",
    );
  });

  it('an unsafe description (em dash) falls back — never rendered verbatim', () => {
    const block = buildHeldProposalBlock({
      ...baseInput(),
      changesetDescription: "remove the link — internal doctrine wording",
    });
    expect(block!.summary).toBe("A change to 'Price' is held for your confirmation.");
    expect(block!.summary).not.toContain('—');
  });

  it('a blank description falls back (absence is omission, never an empty sentence)', () => {
    expect(buildHeldProposalBlock({ ...baseInput(), changesetDescription: '   ' })!.summary).toBe(
      "A change to 'Price' is held for your confirmation.",
    );
  });
});
