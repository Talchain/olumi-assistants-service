/**
 * T1 claim safety — DRIFT GUARD on the STRUCTURED-DESIGNATION vocabulary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND WHY A UNIT-LEVEL PIN IS THE RIGHT SHAPE FOR IT.
 *
 * `WALK-2026-07-27-FINAL.md` §8: on **10 of 10** withheld bodies carrying an
 * analysis block, four structured paths named the leading option outright —
 * `decision_brief.analysis_summary.{leading_option, win_probability}` and
 * `robustness.{recommended_option_id, recommended_option_label,
 * near_tie.top_option_id}`. Present in BOTH prior archives: pre-existing, not
 * a #716 regression.
 *
 * THREE independent instruments read those bodies and all three reported clean:
 *   - the structured assertion set S1–S6 — a hand-kept list of five paths with
 *     no entry for either container;
 *   - the walk's prose matchers — the values are bare labels, no vocabulary;
 *   - the production egress guard — it did not scan `enrichment.robustness` at
 *     all, and inside `decision_brief` it matched PHRASES, which a bare option
 *     label is not.
 *
 * The route-level acceptance for the fix lives where the bytes are
 * (`__tests__/constraint-disclosure-route-level.test.ts`, assertions (e)/(f)
 * plus its permitted-arm controls). What THIS file pins is the thing a
 * route test cannot see: that the fix is a DERIVED key-name family shared with
 * the alarm, and not another hand-kept list waiting to be the fourth instrument
 * that reads clean (CLAUDE.md trap #12).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

import { keyDesignatesLeadingOption } from '../leading-option-egress-guard.js';
import {
  WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS,
  WITHHELD_DROPPED_NEAR_TIE_MEMBERS,
  WITHHELD_DROPPED_OPTION_MEMBERS,
  WITHHELD_LEADER_DESIGNATING_KEYS_OBSERVED,
  keyDesignatesOrdinalPosition,
  projectTransportEnrichmentForWithheldClaim,
} from '../withheld-claim-projection.js';

/**
 * The live enrichment shape, member-for-member, from `caseINF.run.response.json`
 * in `acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-27-final/`.
 * Values are the archive's verbatim; only the option labels are this repo's own
 * fixture vocabulary.
 */
function archivedLeakingEnrichment(): Record<string, unknown> {
  return {
    decision_brief: {
      brief_id: 'fixture',
      analysis_summary: {
        leading_option: 'Hire Marketing Manager',
        win_probability: 0.72,
        goal_fit: 0,
        robustness_band: 'fragile',
      },
      /**
       * THREE options, probability-DESCENDING, each with an explicit `rank` —
       * the live shape (`WALK-2026-07-27-CONFIRM.md` §6, 7/7 withheld bodies).
       *
       * ⚠ THE THIRD IS NOT PADDING. The fix re-orders by `option_id`, and on
       * `opt_hire` (0.72) / `opt_hold` (0.28) alone the identity order and the
       * probability order are the SAME sequence — so "the withheld array is not
       * probability-descending" could never have gone red, on fixed or unfixed
       * code (CLAUDE.md trap 13). `opt_contract` sorts FIRST by id and LAST by
       * probability, which is the structural property the archive has
       * (`opt_status_quo` leads at 0.6001 and its id sorts last of the three).
       */
      options: [
        { option_id: 'opt_hire', label: 'Hire Marketing Manager', win_probability: 0.72, rank: 1 },
        { option_id: 'opt_hold', label: 'Hold', win_probability: 0.28, rank: 2 },
        { option_id: 'opt_contract', label: 'Contract a Freelancer', win_probability: 0.1, rank: 3 },
      ],
      top_drivers: [{ factor_label: 'Hiring pipeline health', sensitivity: 0.23 }],
      robustness: 'fragile',
    },
    robustness: {
      recommended_option_id: 'opt_hire',
      recommended_option_label: 'Hire Marketing Manager',
      near_tie: {
        is_tie: false,
        top_option_id: 'opt_hire',
        second_option_id: 'opt_hold',
        tied_option_ids: ['opt_hire'],
        gap: 0.44,
        threshold: 0.1,
      },
      is_robust: false,
      level: 'low',
      confidence: 0.72,
      confidence_basis: 'recommendation_stability_uncalibrated',
      display_verdict: 'fragile',
      display_verdict_reason: 'small changes could flip this result',
      robust_edges: [],
      fragile_edges: [
        {
          edge_id: 'fac_capacity->goal_growth',
          switch_probability: 0.535,
          alternative_winner_id: 'opt_hold',
          alternative_winner_label: 'Hold',
        },
      ],
    },
    option_comparison: [
      { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.72 },
      { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28 },
    ],
  };
}

describe('the leader-designating KEY vocabulary is shared, derived, and anchored', () => {
  it('recognises every key name the live archive actually leaked', () => {
    // Provenance, per key, so this list is evidence and not an opinion:
    //   leading_option            — decision_brief.analysis_summary, 10/10 bodies
    //   recommended_option_id     — enrichment.robustness,           10/10 bodies
    //   recommended_option_label  — enrichment.robustness,           10/10 bodies
    //   top_option_id             — enrichment.robustness.near_tie,  10/10 bodies
    for (const key of WITHHELD_LEADER_DESIGNATING_KEYS_OBSERVED) {
      expect(keyDesignatesLeadingOption(key), `${key} must be recognised`).toBe(true);
    }
    // Plus the field the whole gate turns on, which sat outside every scan
    // surface in the guard module until this change.
    expect(keyDesignatesLeadingOption('leading_option_id')).toBe(true);
  });

  it('recognises designations that have NEVER been observed — the property a list has not', () => {
    // THE WHOLE REASON THIS IS A PATTERN FAMILY. A literal list of the four keys
    // above would be green today and silent the day PLoT renames the field or
    // adds a sibling — which is exactly how `analysis_summary` got here, and how
    // S1–S6 read clean over three corpora that carried it.
    for (const unseen of [
      'preferred_option_label',
      'chosen_option_id',
      'best_option_name',
      'winning_option_label',
      'leader_label',
      'recommendation_option_id',
      'top_option_label',
    ]) {
      expect(keyDesignatesLeadingOption(unseen), `${unseen} must be recognised`).toBe(true);
    }
  });

  it('ANCHOR CONTROL: does not read ordinary option-bearing keys as designations', () => {
    // The over-suppression direction, and the reason every pattern is `^`-anchored.
    //
    // `alternative_winner_*` is the sharp one: it names the COUNTERFACTUAL
    // winner if an edge flips — the substance of a fragility finding, carried
    // through the flip path by PR #717 days before this change. An unanchored
    // `/winner/` would report it here, the projection sharing this vocabulary
    // would then DROP it, and a withheld turn would lose the field that says
    // what flipping the edge does.
    for (const innocent of [
      'alternative_winner_id',
      'alternative_winner_label',
      'option_id',
      'option_label',
      'win_probability',
      'second_option_id',
      'tied_option_ids',
      'options',
      'rank',
      'confidence',
      'goal_fit',
      'robustness_band',
    ]) {
      expect(keyDesignatesLeadingOption(innocent), `${innocent} must NOT be flagged`).toBe(false);
    }
  });
});

describe('the ORDINAL vocabulary is a family, is separate, and is anchored', () => {
  // ═════════════════════════════════════════════════════════════════════════
  // WALK-2026-07-27-CONFIRM.md §6. `decision_brief.options[rank == 1]` named
  // the leader on 7 of 7 withheld analysis-bearing bodies at build `7508820`.
  //
  // WHY A SECOND FAMILY RATHER THAN FOUR CHARACTERS ADDED TO THE FIRST — and
  // this is the load-bearing design point, not a style choice:
  //   · `keyDesignatesLeadingOption` is SHARED with the Layer-3 egress alarm,
  //     whose `scanKey` returns immediately on a non-string. `rank` is a
  //     NUMBER, so a name added there could never fire — a detector in prose
  //     only, which is the exact defect this slice also corrects in a comment
  //     three files away.
  //   · the ANCHOR CONTROL above asserts `keyDesignatesLeadingOption('rank')`
  //     is false ON PURPOSE. Both statements have to stay true at once, and
  //     that is only possible with two readers.
  // ═════════════════════════════════════════════════════════════════════════

  it('recognises the ordinal the live archive actually shipped', () => {
    // Provenance: `blocks[].enrichment.decision_brief.options[].rank`, 21
    // instances across the 7 withheld analysis-bearing bodies of
    // `raw-2026-07-27-confirm/`, `rank == 1` singling out the leader on every
    // one.
    for (const member of WITHHELD_DROPPED_OPTION_MEMBERS) {
      expect(keyDesignatesOrdinalPosition(member), `${member} must be recognised`).toBe(true);
    }
    expect(keyDesignatesOrdinalPosition('rank')).toBe(true);
  });

  it('recognises ordinals that have NEVER been observed — the property a list has not', () => {
    // A one-element list would be green today and silent the day PLoT ships
    // `position: 1` beside `rank` — which is precisely how `analysis_summary`
    // reached this file, and how S1–S6 read clean over three corpora carrying
    // the leak (CLAUDE.md trap #12).
    for (const unseen of [
      'ranking',
      'rank_index',
      'rank_position',
      'order',
      'ordering',
      'order_index',
      'position',
      'ordinal',
      'placement',
      'standing',
    ]) {
      expect(keyDesignatesOrdinalPosition(unseen), `${unseen} must be recognised`).toBe(true);
    }
  });

  it('ANCHOR CONTROL: does not read card / factor ordering as an option ranking', () => {
    // The over-suppression direction, and why every pattern is `^`-anchored.
    // `priority_rank` orders COACHING CARDS — 67 instances across the withheld
    // arm of `raw-2026-07-27-confirm/`, not one singling out an option — and
    // `importance_rank` orders FACTORS. An unanchored `/rank/` would eat both.
    for (const innocent of [
      'priority_rank',
      'importance_rank',
      'win_probability',
      'option_id',
      'option_label',
      'label',
      'confidence',
      'goal_fit',
      'robustness_band',
      'switch_probability',
      'alternative_winner_id',
    ]) {
      expect(keyDesignatesOrdinalPosition(innocent), `${innocent} must NOT be flagged`).toBe(false);
    }
  });

  it('the two families stay DISJOINT on the names each one anchors', () => {
    // If `rank` ever entered the leader family, the alarm would list a key it
    // can never fire on; if an id/label key entered the ordinal family, the
    // projection would drop the option's identity and leave a probability
    // belonging to nobody. Both directions pinned.
    expect(keyDesignatesLeadingOption('rank')).toBe(false);
    expect(keyDesignatesOrdinalPosition('leading_option')).toBe(false);
    expect(keyDesignatesOrdinalPosition('recommended_option_id')).toBe(false);
    expect(keyDesignatesOrdinalPosition('top_option_id')).toBe(false);
  });
});

describe('the withheld projection honours every member it declares', () => {
  const projected = () =>
    projectTransportEnrichmentForWithheldClaim(archivedLeakingEnrichment()) as Record<string, any>;

  it('drops the container-scoped members it declares, in the container it declares them for', () => {
    // TESTING-DISCIPLINE rule 1 / trap #14: an exported constant that ASSERTS a
    // suppression is worth nothing unless the code is checked against it. These
    // two lists are the members whose KEY is innocent and whose CONTAINER makes
    // the claim, so the derived reader cannot cover them and something has to.
    const out = projected();
    for (const member of WITHHELD_DROPPED_ANALYSIS_SUMMARY_MEMBERS) {
      expect(
        out.decision_brief.analysis_summary[member],
        `analysis_summary.${member} is declared dropped and is still present`,
      ).toBeUndefined();
    }
    for (const member of WITHHELD_DROPPED_NEAR_TIE_MEMBERS) {
      expect(
        out.robustness.near_tie[member],
        `near_tie.${member} is declared dropped and is still present`,
      ).toBeUndefined();
    }
  });

  it('drops every key the SHARED reader recognises, at every depth it reaches', () => {
    const out = projected();
    expect(out.decision_brief.analysis_summary.leading_option).toBeUndefined();
    expect(out.robustness.recommended_option_id).toBeUndefined();
    expect(out.robustness.recommended_option_label).toBeUndefined();
    expect(out.robustness.near_tie.top_option_id).toBeUndefined();
  });

  it('OVER-SUPPRESSION CONTROL: keeps everything that ranks nothing', () => {
    const out = projected();
    expect(out.decision_brief.analysis_summary.goal_fit).toBe(0);
    expect(out.decision_brief.analysis_summary.robustness_band).toBe('fragile');
    expect(out.decision_brief.options).toHaveLength(3);
    expect(out.decision_brief.top_drivers).toBeDefined();
    expect(out.robustness.near_tie.is_tie).toBe(false);
    expect(out.robustness.near_tie.gap).toBe(0.44);
    expect(out.robustness.confidence).toBe(0.72);
    expect(out.robustness.fragile_edges[0].alternative_winner_label).toBe('Hold');
    expect(out.option_comparison).toHaveLength(2);
  });

  it('drops the ORDINAL and neutralises the ORDER of options[]', () => {
    // WALK-2026-07-27-CONFIRM.md §6, both halves of the channel.
    const out = projected();
    for (const option of out.decision_brief.options as Array<Record<string, unknown>>) {
      for (const member of WITHHELD_DROPPED_OPTION_MEMBERS) {
        expect(option[member], `options[].${member} is declared dropped and is present`).toBeUndefined();
      }
    }
    // Position is now a pure function of `option_id`, so it carries no rank
    // information. The third fixture option is what makes this measurable —
    // see the fixture note.
    expect((out.decision_brief.options as Array<Record<string, unknown>>).map((o) => o.option_id)).toEqual([
      'opt_contract',
      'opt_hire',
      'opt_hold',
    ]);
    const wins = (out.decision_brief.options as Array<Record<string, number>>).map(
      (o) => o.win_probability!,
    );
    expect(wins.every((w, i) => i === 0 || wins[i - 1]! >= w), 'still probability-descending').toBe(
      false,
    );
  });

  it('⚠ ANTI-OVER-SUPPRESSION: every option keeps its identity and its probability', () => {
    // THE LOAD-BEARING HALF OF THE 2026-07-27 RULING. The probabilities are
    // computed facts the withheld verdict does not withhold; the test above
    // would be green if the whole array had been dropped, and this is what
    // stops that being called a fix.
    const options = projected().decision_brief.options as Array<Record<string, unknown>>;
    expect(options).toHaveLength(3);
    expect([...options.map((o) => o.win_probability as number)].sort()).toEqual([0.1, 0.28, 0.72]);
    for (const option of options) {
      expect(typeof option.win_probability).toBe('number');
      expect(typeof option.option_id).toBe('string');
      expect(typeof option.label).toBe('string');
    }
  });

  it('an options[] it cannot re-order is dropped, never shipped in rank order', () => {
    // We cannot neutralise what we cannot identify, and keeping the survivors
    // would leave the ordering claim standing on them. Same
    // we-cannot-show-what-we-cannot-inspect decision the `decision_brief` and
    // `robustness` branches already make.
    const noIdentity = projectTransportEnrichmentForWithheldClaim({
      decision_brief: {
        brief_id: 'fixture',
        options: [{ win_probability: 0.72, rank: 1 }, { win_probability: 0.28, rank: 2 }],
        top_drivers: [],
      },
    }) as Record<string, any>;
    expect('options' in noIdentity.decision_brief).toBe(false);
    expect(noIdentity.decision_brief.brief_id).toBe('fixture');

    const notAnArray = projectTransportEnrichmentForWithheldClaim({
      decision_brief: { brief_id: 'fixture', options: 'three' },
    }) as Record<string, any>;
    expect('options' in notAnArray.decision_brief).toBe(false);
  });

  it('PURE: the caller’s enrichment is not mutated', () => {
    // The persisted fact is the same object graph; a mutating projection would
    // corrupt what CEE knows, not merely what it says.
    const source = archivedLeakingEnrichment();
    projectTransportEnrichmentForWithheldClaim(source);
    expect((source.robustness as Record<string, unknown>).recommended_option_label).toBe(
      'Hire Marketing Manager',
    );
    expect(
      ((source.decision_brief as Record<string, any>).analysis_summary as Record<string, unknown>)
        .leading_option,
    ).toBe('Hire Marketing Manager');
    // The options projection builds NEW elements and sorts a NEW array — the
    // persisted fact keeps its rank and its order. A mutating sort here would
    // corrupt what CEE knows, not merely what it says.
    const options = (source.decision_brief as Record<string, any>).options as Array<
      Record<string, unknown>
    >;
    expect(options.map((o) => o.option_id)).toEqual(['opt_hire', 'opt_hold', 'opt_contract']);
    expect(options[0]!.rank).toBe(1);
  });

  it('omits a container rather than shipping an empty one', () => {
    // `{}` is a positive assertion that the analysis contains no tie block,
    // which is false. Absence is the shape a blob without one already has, and
    // it is the shape the existing `decision_brief` branch already ships.
    const out = projectTransportEnrichmentForWithheldClaim({
      robustness: { level: 'low', near_tie: { top_option_id: 'opt_hire' } },
    }) as Record<string, any>;
    expect(out.robustness).toBeDefined();
    expect(out.robustness.level).toBe('low');
    expect('near_tie' in out.robustness).toBe(false);
  });

  it('the omission CASCADES — a blob with nothing but designations disappears', () => {
    // The far end of the same rule, pinned because the intermediate shapes are
    // where an "it still ships, just empty" regression would hide: an enrichment
    // whose ONLY content was the leader designation must leave no `robustness`
    // key, and an enrichment left with nothing at all must return `undefined` so
    // the block omits `enrichment` entirely.
    expect(
      projectTransportEnrichmentForWithheldClaim({
        robustness: { near_tie: { top_option_id: 'opt_hire' } },
      }),
    ).toBeUndefined();
    const partial = projectTransportEnrichmentForWithheldClaim({
      robustness: { recommended_option_label: 'Hire Marketing Manager' },
      option_comparison: [],
    }) as Record<string, any>;
    expect('robustness' in partial).toBe(false);
    expect(partial.option_comparison).toEqual([]);
  });

  it('a non-object robustness blob is dropped, never shipped uninspected', () => {
    // Same decision the sibling `decision_brief` branch already makes, for the
    // same reason: this is an untyped `z.record` passthrough (parent CLAUDE.md
    // hazard 2) and we cannot show what we cannot inspect.
    const out = projectTransportEnrichmentForWithheldClaim({
      robustness: 'fragile',
      option_comparison: [],
    }) as Record<string, any>;
    expect(out.robustness).toBeUndefined();
    expect(out.option_comparison).toBeDefined();
  });
});
