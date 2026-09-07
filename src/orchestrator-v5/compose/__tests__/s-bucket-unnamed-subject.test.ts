/**
 * S-bucket catalogue — "a sentence that cannot name its subject must not
 * invent one".
 *
 * ## The witnessed defect (deployed UI `a9c2e050`, founder screenshots)
 *
 * The Reasoning panel rendered, verbatim, inside a warning box:
 *
 *   > Option 'the relevant node' produces the same result in every simulation.
 *
 * `'the relevant node'` is not a label. It is the DESCRIPTION of a missing
 * argument — `genericFallbackForId`'s defensive default for an id that does
 * not split on a known prefix (`output-safety.ts:91`). `pickOptionId` returns
 * `''` when `affected_option_ids` is absent, `''` has no prefix, so the
 * defensive default lands in a NAME slot and the product quotes a description
 * as if it were the user's option.
 *
 * ## Why the existing guards could not see it
 *
 * `sanitise-enrichment.test.ts:196` ALREADY bans `/\bnode\b/i` across the
 * whole catalogue — the guard is correct and the word is correctly forbidden.
 * It never fired because every catalogue-wide assertion in that file calls the
 * templates with `affected_option_ids: ['opt_hire_local', 'opt_offshore']`.
 * Presence of a guard is not coverage of its input: the one input class that
 * produces the defect is the one class no guard was ever pointed at.
 *
 * ## Why this is not a rare edge case
 *
 * `projectCritiquesForWithheldClaim` (`withheld-claim-projection.ts:958`)
 * re-renders every S-bucket row with `affected_option_ids: undefined` and a
 * null context BY DESIGN, on every withheld-leader turn. Its own comment
 * expects "the generic phrase" and reasons that this is "the same reviewed
 * string the catalogue already uses when an id cannot be resolved" — true for
 * `opt_x` (→ `the relevant option`), FALSE for `''` (→ `the relevant node`).
 * That path is a guaranteed producer of the witnessed string.
 *
 * ## The two directions this spec pins
 *
 * Both are required, and neither alone is evidence:
 *   - CANNOT-NAME → the sentence carries no quoted subject at all, and no
 *     forbidden vocabulary. Naming nothing is honest; naming a placeholder is
 *     broken in a way that discredits every other sentence on the surface.
 *   - CAN-NAME → the sentence still names the option. A fix that silences the
 *     placeholder by dropping the label everywhere would pass the first
 *     direction and destroy the feature.
 */

import { describe, expect, it } from 'vitest';

import {
  S_BUCKET_REPLACEMENTS,
  CRITIQUE_BUCKETS,
} from '../sanitise-enrichment.js';
import { projectCritiquesForWithheldClaim } from '../withheld-claim-projection.js';
import type { LabelResolverContext } from '../resolve-label.js';

const GRAPH = {
  nodes: [
    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally', kind: 'option' },
    { id: 'opt_offshore', label: 'Engage Offshore Partner', kind: 'option' },
    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost', kind: 'factor' },
  ],
  edges: [],
} as unknown as LabelResolverContext['graph'];

const CTX: LabelResolverContext = { graph: GRAPH };
const EMPTY_CTX: LabelResolverContext = { graph: null, analysisReady: null, enrichment: null };

/**
 * The defect shape, stated as a pattern rather than as one string: a generic
 * `the relevant <kind>` phrase sitting inside the single quotes that the
 * catalogue uses for a NAME. This is what must never reach a user — it catches
 * `'the relevant node'` (the witnessed one) AND its siblings
 * `'the relevant option'` / `'the relevant factor'`, which are the same defect
 * with a luckier prefix: a description quoted as if it were the user's label.
 */
const DESCRIPTION_QUOTED_AS_NAME = /'the relevant [a-z]+'/i;

/**
 * The catalogue's own forbidden vocabulary, as pinned by
 * `sanitise-enrichment.test.ts:196`. Reproduced here so this spec exercises
 * the SAME ban over the input class that spec never supplies.
 */
const FORBIDDEN_VOCABULARY: readonly RegExp[] = [
  /\binterventions?\b/i,
  /\bnode\b/i,
  /\bsamples?\b/i,
  /\bmonte\s+carlo\b/i,
  /\bcausal\s+paths?\b/i,
  /\bbootstrap\b/i,
  /\bvariance\b/i,
  /\bsimulated\s+futures?\b/i,
  /\bwin\s+probabilit/i,
];

/** Every S-bucket code that has a replacement template, derived not hand-listed. */
const S_CODES = Object.keys(S_BUCKET_REPLACEMENTS);

/**
 * The subset of the catalogue that interpolates an option label. Derived by
 * behaviour, not by a hand-maintained list: a template is subject-bearing iff
 * supplying real option ids changes its output. A hand-listed set would drift
 * the moment a template is added.
 */
const SUBJECT_BEARING_CODES = S_CODES.filter((code) => {
  const withIds = S_BUCKET_REPLACEMENTS[code]!(CTX, {
    affected_option_ids: ['opt_hire_local', 'opt_offshore'],
  });
  const withoutIds = S_BUCKET_REPLACEMENTS[code]!(CTX, {});
  return withIds !== withoutIds;
});

describe('S-bucket catalogue — preconditions (this spec is pointed at real inputs)', () => {
  it('the catalogue is non-empty and every code is classified S', () => {
    expect(S_CODES.length).toBeGreaterThan(0);
    for (const code of S_CODES) {
      expect(CRITIQUE_BUCKETS[code]).toBe('S');
    }
  });

  /**
   * Pin the precondition IN-TEST. If the subject-bearing set were empty — or
   * shrank because a refactor stopped interpolating labels — every
   * cannot-name assertion below would pass by exercising nothing. This makes
   * that failure loud instead of green.
   */
  it('the subject-bearing subset is non-empty and covers the witnessed code', () => {
    expect(SUBJECT_BEARING_CODES.length).toBeGreaterThanOrEqual(6);
    expect(SUBJECT_BEARING_CODES).toContain('DEGENERATE_OPTION_ZERO_VARIANCE');
    expect(SUBJECT_BEARING_CODES).toContain('IDENTICAL_OPTIONS');
  });

  /**
   * Control: the detector must be capable of firing. A defect-shape regex
   * that matches nothing would make every assertion below vacuous.
   */
  it('CONTROL — the description-quoted-as-name detector actually matches the witnessed string', () => {
    expect(
      "Option 'the relevant node' produces the same result in every simulation.",
    ).toMatch(DESCRIPTION_QUOTED_AS_NAME);
    expect(
      "Option 'the relevant option' does not change anything yet.",
    ).toMatch(DESCRIPTION_QUOTED_AS_NAME);
    // And must NOT fire on a real label, or it would ban the correct output.
    expect(
      "Option 'Hire Two Senior Engineers Locally' produces the same result.",
    ).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
  });
});

describe('CANNOT-NAME — a template with no resolvable option must not invent a subject', () => {
  /** The exact sentence the founder saw. */
  it('DEGENERATE_OPTION_ZERO_VARIANCE with no option ids does not emit the witnessed placeholder', () => {
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(EMPTY_CTX, {});
    expect(out).not.toContain('the relevant node');
    expect(out).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
  });

  /**
   * The CLASS, over both ways a subject can be missing: no ids at all, and an
   * id present but unresolvable in every lookup source.
   */
  it.each(SUBJECT_BEARING_CODES)(
    '%s emits no quoted description when option ids are absent',
    (code) => {
      const out = S_BUCKET_REPLACEMENTS[code]!(EMPTY_CTX, {});
      expect(out).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
      expect(out).not.toContain('the relevant node');
    },
  );

  it.each(SUBJECT_BEARING_CODES)(
    '%s emits no quoted description when option ids are present but unresolvable',
    (code) => {
      const out = S_BUCKET_REPLACEMENTS[code]!(EMPTY_CTX, {
        affected_option_ids: ['opt_never_seen', 'opt_also_missing'],
      });
      expect(out).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
      expect(out).not.toContain('the relevant node');
    },
  );

  /**
   * The catalogue's own forbidden-vocabulary ban, applied to the input class
   * the existing suite never supplies. `\bnode\b` is already banned; the
   * defect emits it. This is the assertion that was missing.
   */
  it.each(S_CODES)(
    '%s is free of forbidden vocabulary when no option ids are supplied',
    (code) => {
      const out = S_BUCKET_REPLACEMENTS[code]!(EMPTY_CTX, {});
      for (const re of FORBIDDEN_VOCABULARY) {
        expect(out).not.toMatch(re);
      }
    },
  );

  /** A sentence still has to be a sentence when it names nobody. */
  it.each(SUBJECT_BEARING_CODES)(
    '%s still emits non-empty prose ending in a full stop when it cannot name',
    (code) => {
      const out = S_BUCKET_REPLACEMENTS[code]!(EMPTY_CTX, {});
      expect(out.length).toBeGreaterThan(20);
      expect(out.trim()).toMatch(/\.$/);
      expect(out).not.toContain("''");
      expect(out).not.toMatch(/Option\s+'\s*'/);
    },
  );
});

describe('CAN-NAME — the opposite direction: a resolvable option must still be named', () => {
  it('DEGENERATE_OPTION_ZERO_VARIANCE names the option when the graph resolves it', () => {
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
      affected_option_ids: ['opt_hire_local'],
    });
    expect(out).toContain("Option 'Hire Two Senior Engineers Locally'");
    expect(out).toContain('produces the same result in every simulation');
  });

  it.each(SUBJECT_BEARING_CODES)(
    '%s names the resolved option label verbatim',
    (code) => {
      const out = S_BUCKET_REPLACEMENTS[code]!(CTX, {
        affected_option_ids: ['opt_hire_local', 'opt_offshore'],
      });
      expect(out).toContain('Hire Two Senior Engineers Locally');
      expect(out).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
    },
  );

  it('IDENTICAL_OPTIONS names BOTH options when both resolve', () => {
    const out = S_BUCKET_REPLACEMENTS.IDENTICAL_OPTIONS!(CTX, {
      affected_option_ids: ['opt_hire_local', 'opt_offshore'],
    });
    expect(out).toContain('Hire Two Senior Engineers Locally');
    expect(out).toContain('Engage Offshore Partner');
  });

  /**
   * The partial case — the one a fix written only for "all present" or "all
   * absent" would get wrong. One resolvable id, one missing: the sentence must
   * name what it can and must not invent the other.
   */
  it('IDENTICAL_OPTIONS names the one option it can resolve and invents nothing for the other', () => {
    const out = S_BUCKET_REPLACEMENTS.IDENTICAL_OPTIONS!(CTX, {
      affected_option_ids: ['opt_hire_local'],
    });
    expect(out).toContain('Hire Two Senior Engineers Locally');
    expect(out).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
    expect(out).not.toContain('the relevant node');
  });
});

describe('WITHHELD-CLAIM PATH — the designed producer of the empty-id case', () => {
  /**
   * `projectCritiquesForWithheldClaim` drops `affected_option_ids` and
   * re-renders from the catalogue with a null context. This is the path that
   * put the witnessed sentence on the founder's screen, and it fires by
   * design rather than by accident.
   */
  it('re-rendered DEGENERATE_OPTION_ZERO_VARIANCE carries no placeholder subject', () => {
    const rows = projectCritiquesForWithheldClaim([
      {
        code: 'DEGENERATE_OPTION_ZERO_VARIANCE',
        affected_option_ids: ['opt_hire_local'],
        user_message: "Option 'Hire Two Senior Engineers Locally' produces the same result in every simulation.",
      },
    ]) as Array<Record<string, unknown>>;

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    const msg = rows[0]!.user_message;
    expect(typeof msg).toBe('string');
    // Precondition: the projection really did strip option identity, so the
    // assertion below is about the re-render and not about an untouched row.
    expect(rows[0]!.affected_option_ids).toBeUndefined();
    expect(msg as string).not.toContain('the relevant node');
    expect(msg as string).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
    expect(msg as string).not.toContain('Hire Two Senior Engineers Locally');
  });

  it('every S-bucket row survives the withheld projection without a placeholder subject', () => {
    const rows = projectCritiquesForWithheldClaim(
      S_CODES.map((code) => ({
        code,
        affected_option_ids: ['opt_hire_local', 'opt_offshore'],
        user_message: 'placeholder to be re-rendered',
      })),
    ) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(S_CODES.length);
    for (const row of rows) {
      const msg = row.user_message as string;
      expect(typeof msg).toBe('string');
      expect(msg).not.toMatch(DESCRIPTION_QUOTED_AS_NAME);
      for (const re of FORBIDDEN_VOCABULARY) {
        expect(msg).not.toMatch(re);
      }
    }
  });
});
