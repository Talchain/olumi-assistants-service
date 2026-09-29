import { describe, it, expect } from 'vitest';
import { NodeV3 } from '../cee-v3.js';

/**
 * COLLAB Track A — `node.analysis_participation` must SURVIVE the parse.
 *
 * ── WHY THIS SUITE EXISTS, AND WHY A PLAIN "it round-trips" TEST WOULD BE VOID
 * There are TWO same-named `NodeV3`s. `@talchain/schemas`' `NodeV3Schema` is
 * `.passthrough()` and keeps unknown keys; CEE's own `NodeV3` (cee-v3.ts) is a
 * plain `z.object` that SILENTLY DELETES undeclared roots, with no error
 * anywhere. Declaring the field in the shared contract alone would change
 * nothing here, and the failure mode is a field that simply vanishes.
 *
 * So asserting only "the declared field survives" is not enough: it would also
 * pass if this schema were permissive, which is the very thing that is not true
 * and the thing a future refactor might accidentally make true. Every case below
 * is therefore a DISCRIMINATING PAIR — the declared field survives AND an
 * undeclared sibling is stripped IN THE SAME PARSE. If the pair ever agrees,
 * the test is measuring the schema's permissiveness rather than the declaration.
 */

const base = { id: 'factor_a', kind: 'factor' as const, label: 'Monthly churn' };

describe('node.analysis_participation survives CEE NodeV3 parse', () => {
  it("keeps 'retained_excluded' while stripping an undeclared sibling in the SAME parse", () => {
    const parsed = NodeV3.parse({
      ...base,
      analysis_participation: 'retained_excluded',
      zzz_undeclared_control: 'must be stripped',
    }) as Record<string, unknown>;

    // The claim.
    expect(parsed.analysis_participation).toBe('retained_excluded');
    // The discrimination: this schema really does strip, so survival above means something.
    expect(parsed).not.toHaveProperty('zzz_undeclared_control');
  });

  it("keeps 'included' while stripping an undeclared sibling in the SAME parse", () => {
    const parsed = NodeV3.parse({
      ...base,
      analysis_participation: 'included',
      zzz_undeclared_control: 'must be stripped',
    }) as Record<string, unknown>;

    expect(parsed.analysis_participation).toBe('included');
    expect(parsed).not.toHaveProperty('zzz_undeclared_control');
  });

  /**
   * Canvas lane's binding display contract, 18 Sep: absence is NOT a claim.
   * Absent must stay ABSENT after parsing — never defaulted to 'included' — so a
   * surface cannot read inclusion out of a node CEE never stamped. Defaulting
   * here would make absence and inclusion indistinguishable at the consumer and
   * is the single change this test exists to prevent.
   */
  it('leaves an unstamped node with NO key at all — absence must not become a claim', () => {
    const parsed = NodeV3.parse({ ...base }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('analysis_participation');
    expect(parsed.analysis_participation).toBeUndefined();
  });

  /**
   * Not a boolean, deliberately: the state is named so a third state later does
   * not need a second flag. An unrecognised value must be REFUSED at the parse
   * rather than coerced, so it can never reach a surface that would have to
   * decide what to render for it.
   */
  it('refuses an unrecognised participation value rather than coercing it', () => {
    const bad = NodeV3.safeParse({ ...base, analysis_participation: 'excluded' });
    expect(bad.success).toBe(false);

    // CONTROL: the same payload with a declared value parses, so the failure
    // above is the enum and not something else in the node.
    const good = NodeV3.safeParse({ ...base, analysis_participation: 'retained_excluded' });
    expect(good.success).toBe(true);
  });
});
