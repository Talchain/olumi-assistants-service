import { describe,it } from 'vitest';


describe('tryChipSimplifyIntercept', () => {






  describe('future metadata leg (deferred — PR1 ships exact-text only)', () => {
    // TODO: ISSUE-197 — extend tryChipSimplifyIntercept once Action.source_chip_id schema lands.
    it.skip('matches when boundary `Action` carries chip-source metadata', () => {
      // Breadcrumb for the follow-up workstream. When the boundary
      // `Action` schema gains a chip-source metadata field
      // (e.g. `Action.source_chip_id` / `Action.metadata.intent`),
      // extend `tryChipSimplifyIntercept` to accept the second leg —
      // see the module's "Future work" doc-comment. Add the
      // metadata field path here, then unskip and pin the contract.
    });
  });
});
