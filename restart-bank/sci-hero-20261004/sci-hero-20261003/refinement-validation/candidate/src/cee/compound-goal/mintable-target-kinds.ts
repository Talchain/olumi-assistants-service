/**
 * ⭐ WHICH NODE KINDS MAY CARRY A NUMERIC THRESHOLD — ONE SPELLING, TWO READERS.
 *
 * A limit is a statement about a MEASURED quantity. A `goal` is the thing being
 * achieved and an `option` is a course of action; neither carries the metric's
 * scale, so welding a percentage floor onto either is the unit-mismatch class of
 * harm rather than a near-miss of a correct binding.
 *
 * ⚠⚠ WHY IT LIVES IN ITS OWN LEAF MODULE, WITH NO IMPORTS.
 *
 * It was module-private in `unified-pipeline/stages/repair/compound-goals.ts`,
 * which is a LATE pipeline stage. The draft-records projector is an EARLY
 * producer and now needs the same rule, and a producer importing from a later
 * stage is both a layering inversion and a real cycle risk — sibling modules in
 * that same `repair/` directory already import from
 * `draft/records/projector.js`. Re-spelling `{outcome, factor}` in the projector
 * would have been the hand-maintained mirror this estate keeps paying for
 * (CLAUDE.md trap 12): two copies of one rule, drifting silently, each looking
 * correct on its own.
 *
 * A leaf with zero imports cannot participate in a cycle, so both readers derive
 * from this one object and a member added here reaches both for free.
 *
 * ⚠ `goal` IS EXCLUDED, AND THAT EXCLUSION IS LOAD-BEARING — not tidiness. A
 * goal label routinely RECITES the constraints bearing on it ("bring
 * first-response time back under four hours without going over budget"), which
 * makes it a magnet for every limit in the brief under any label- or
 * token-based matcher. `risk` and `constraint` are excluded for the plainer
 * reason that neither is the metric being bounded.
 */
export const MINTABLE_TARGET_KINDS: ReadonlySet<string> = new Set(["outcome", "factor"]);
