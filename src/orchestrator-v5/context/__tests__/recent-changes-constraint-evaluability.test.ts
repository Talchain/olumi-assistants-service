/**
 * ⭐⭐ THE EVALUABILITY VERDICT SURVIVES THE TURN IT WAS WRITTEN ON.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * #1484 made the WRITE-TIME receipt say when a limit's target records no value,
 * so the analysis cannot check it (`formatConstraintNotCheckable`, one call
 * site: `add-constraint.ts:1113`). But the same claim is re-rendered on EVERY
 * LATER TURN from a different site — `recent-changes.ts`'s
 * `summariseAddConstraint`, which calls `formatConstraintAdded` and holds no
 * graph, so it structurally cannot qualify what it says. The ContextPack
 * therefore re-grounds the routing model on an unqualified "Added constraint:
 * …" for the rest of the conversation, which is why the product later restates
 * the limit as applied.
 *
 * This suite pins the projection half: the verdict reaches the entry.
 *
 * ── WHAT IS DELIBERATELY *NOT* ASSERTED ───────────────────────────────────
 * The `summary` string is UNCHANGED, and that is a requirement rather than an
 * omission. `RECENT_CHANGES_SUMMARY_MAX_CHARS` is 80 and `cap()` truncates;
 * the ratified not-checkable sentence is 144 characters before its repair ask,
 * so appending it would silently eat the receipt it is qualifying. The verdict
 * therefore rides its own structured field and the copy is byte-identical.
 *
 * ── BINDING ───────────────────────────────────────────────────────────────
 * Every arm binds by IDENTITY — the constraint's own `constraint_id`, carried
 * on the fact as `result.target_id` — never by a value predicate another
 * constraint could satisfy. The two constraints below differ ONLY in whether
 * their target records a number, so an arm that passed on the wrong object
 * would have to pass on an object with the opposite verdict.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  computeRecentChangesHash,
  projectRecentChanges,
  RECENT_CHANGES_SUMMARY_MAX_CHARS,
} from '../recent-changes.js';
import { RecentMutationSchema } from '../context-pack-schema.js';

/** The limit whose target records nothing — the 44e349fa shape. */
const UNCHECKABLE_CONSTRAINT_ID = 'gc-11111111-1111-4111-8111-111111111111';
/** The limit whose target records a number. The contrast, in the same graph. */
const CHECKABLE_CONSTRAINT_ID = 'gc-22222222-2222-4222-8222-222222222222';

const CHURN_LABEL = 'Churn must not exceed 7% for more than 3 months';
const COST_LABEL = 'Support cost must be at most £250k';

function addConstraintFact(opts: {
  readonly constraintId: string;
  readonly nodeId: string;
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
}): HandlerFact {
  const after = {
    constraint_id: opts.constraintId,
    node_id: opts.nodeId,
    operator: '<=' as const,
    value: opts.value,
    label: opts.label,
    provenance: 'explicit',
    ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
  };
  return {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop: false,
    result: {
      // ⚠ DERIVED, NOT ASSUMED: `add-constraint.ts:975` writes
      // `target_id: newConstraint.constraint_id`. It is the CONSTRAINT id, not
      // the node id — which is exactly why the join key below is the constraint
      // id and the node is reached through `goal_constraints`.
      target_id: opts.constraintId,
      status: 'applied',
      before: null,
      after,
    },
  };
}

const UNCHECKABLE_FACT = addConstraintFact({
  constraintId: UNCHECKABLE_CONSTRAINT_ID,
  nodeId: 'risk_churn',
  label: CHURN_LABEL,
  value: 7,
  unit: '%',
});

const CHECKABLE_FACT = addConstraintFact({
  constraintId: CHECKABLE_CONSTRAINT_ID,
  nodeId: 'f_support_cost',
  label: COST_LABEL,
  value: 250000,
  unit: '£',
});

describe('recent_changes carries the constraint evaluability verdict', () => {
  it('marks the entry whose target records no value', () => {
    const projected = projectRecentChanges(
      [UNCHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    );

    expect(projected).toHaveLength(1);
    const entry = projected[0]!;
    // Bound by identity: this entry is the churn limit, not "some constraint".
    expect(entry.target_label).toBe(CHURN_LABEL);
    expect(entry.constraint_not_checkable).toBe('target_records_no_value');
  });

  it('leaves the entry unmarked when the constraint is not in the set', () => {
    const projected = projectRecentChanges(
      [CHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    );

    expect(projected).toHaveLength(1);
    const entry = projected[0]!;
    expect(entry.target_label).toBe(COST_LABEL);
    expect(entry.constraint_not_checkable).toBeUndefined();
  });

  it('discriminates between two constraints in one projection', () => {
    // ⭐ THE DISCRIMINATING ARM. A projector that stamped every constraint, or
    // none, satisfies neither of the two assertions above on its own — this one
    // fails for both of those degenerate implementations.
    const projected = projectRecentChanges(
      [UNCHECKABLE_FACT, CHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    );

    expect(projected).toHaveLength(2);
    const byLabel = new Map(projected.map((p) => [p.target_label, p]));
    expect(byLabel.get(CHURN_LABEL)!.constraint_not_checkable).toBe('target_records_no_value');
    expect(byLabel.get(COST_LABEL)!.constraint_not_checkable).toBeUndefined();
  });

  it('claims nothing when no verdict set is supplied — today’s behaviour, unchanged', () => {
    const projected = projectRecentChanges([UNCHECKABLE_FACT]);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.constraint_not_checkable).toBeUndefined();
  });

  it('does not touch the summary, and stays inside the character budget', () => {
    const marked = projectRecentChanges(
      [UNCHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    )[0]!;
    const unmarked = projectRecentChanges([UNCHECKABLE_FACT])[0]!;

    // The copy does not change. This increment changes the SET OF TURNS on
    // which the verdict is available, never the sentence.
    expect(marked.summary).toBe(unmarked.summary);
    expect(marked.target_label).toBe(unmarked.target_label);
    expect(marked.summary.length).toBeLessThanOrEqual(RECENT_CHANGES_SUMMARY_MAX_CHARS);
  });

  it('is accepted by the ContextPack schema in both states', () => {
    // The pack schema is `.strict()`, so an unregistered field would fail the
    // assembler's non-prod runtime gate rather than reaching the model.
    const marked = projectRecentChanges(
      [UNCHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    )[0]!;
    const unmarked = projectRecentChanges([CHECKABLE_FACT])[0]!;

    expect(RecentMutationSchema.safeParse(marked).success).toBe(true);
    expect(RecentMutationSchema.safeParse(unmarked).success).toBe(true);
  });
});

describe('the E4 recent-changes hash', () => {
  it('is byte-identical for an entry carrying no verdict', () => {
    // ⭐ THE DEGRADE-PATH PIN. `computeRecentChangesHash` feeds
    // `deriveRecentChangesEvidence` → `turn-executor.ts` telemetry. An
    // unconditional new key would move every historic hash; a conditional one
    // moves none of them.
    const unmarked = projectRecentChanges([CHECKABLE_FACT]);
    expect(computeRecentChangesHash(unmarked)).toBe(
      computeRecentChangesHash([
        {
          action: unmarked[0]!.action,
          summary: unmarked[0]!.summary,
          target_label: unmarked[0]!.target_label,
        },
      ]),
    );
  });

  it('separates a marked entry from the same entry unmarked', () => {
    // Without this, the verdict could be dropped anywhere downstream and the
    // operator evidence would still read "same payload".
    const marked = projectRecentChanges(
      [UNCHECKABLE_FACT],
      undefined,
      new Set([UNCHECKABLE_CONSTRAINT_ID]),
    );
    const unmarked = projectRecentChanges([UNCHECKABLE_FACT]);
    expect(computeRecentChangesHash(marked)).not.toBe(computeRecentChangesHash(unmarked));
  });
});
