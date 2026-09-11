/**
 * ⭐⭐ A REFUSAL THAT HOLDS THE STRUCTURE TO NAME A GAP MUST NAME ONE.
 *
 * THE DEFECT, AND IT IS THE FIRST CLICK A COLLABORATOR MAKES. A fresh guest on
 * the seeded model presses the board's primary CTA "Run analysis". A turn IS
 * dispatched, the run is CORRECTLY refused, and the product settles on:
 *
 *   "Not ready for analysis yet — Olumi needs something more from this model
 *    before the next analysis. Ask in the chat and it will explain what is
 *    missing."
 *
 * That is the `unspecified` rung of the UI's `canvas/utils/composeBlockedReason.ts`,
 * whose FIRST line is `if (blockers.length === 0) return [unspecified]`. The rung
 * is CORRECT — it is the deliberate last resort for a verdict carrying nothing
 * nameable, and it must stay reachable. This verdict was not one.
 *
 * MEASURED ON CEE STAGING — 60 `cee.analysis_ready.built` events over two hours:
 * 8 returned `status: needs_user_mapping` with `blockerCount: 0` while carrying
 * `optionsNeedingMapping: 1` and `userQuestionCount: 2`.
 *
 * ⭐ AND NOTHING NEEDED DERIVING — CEE HAD ALREADY WRITTEN THE SENTENCE.
 * `appendSemanticIssues` (`orchestrator/tools/analysis-ready-helper.ts:941`)
 * walks every non-ready option that no blocker covers and authors
 * `OPTION_NEEDS_MAPPING` / `OPTION_NEEDS_ENCODING`. It writes them into
 * `readiness_issues`. The `analysis_state` composer read ONLY `blockers`, so
 * the one surface holding the answer was the one surface the UI could not see.
 * Measured at PRISTINE on the capture below: `analysisReady.blockers === []`
 * while `readiness_issues` carried
 *   `Choose which factor "Status Quo: Hold current strategy" changes and by how much.`
 *
 * So this is a ROUTING fix, not a new derivation. Nothing here authors copy.
 *
 * ⚠⚠ THE FIRST ATTEMPT MINTED A SECOND AUTHORITY AND THE SUITE CAUGHT IT.
 * Emitting fresh option-scoped blockers in `transforms/analysis-ready.ts` made
 * `payload.blockers` non-empty, which fed `appendSemanticIssues`' own
 * `coveredOptionIds` set and SUPPRESSED its better copy —
 * `option-status-connected-but-numberless.test.ts` REDed on its pinned
 * precondition ("an uncovered connected-but-numberless option is asked for the
 * VALUE"). That failure is why this file composes rather than produces.
 *
 * ⚠ FIXTURES ARE REAL CAPTURES (trap 16-inverse — *a fixture you wrote yourself
 * is not evidence about the wire*). The graph is a verbatim `draft_graph` from
 * the draws captured against deployed staging on 19 Aug 2026 (`POST
 * /proxy/v5/turn`, fresh anonymous guest), already in the repo at
 * `cee/transforms/__tests__/fixtures/sendable-variance-draws-2026-08-19.json`.
 * The readiness payload under test is CEE's own assessor's output for it — not
 * a hand-written object standing in for one.
 *
 * BINDING IS BY IDENTITY (trap 19): assertions name THE option id and THE
 * option label. No count stands in for a name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { AnalysisBlockerSchema } from '@talchain/schemas/boundary';
import { describe, it, expect } from 'vitest';

import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T, NodeV3T } from '../../../schemas/cee-v3.js';
import { composeAnalysisStateV1, issuesAsWireBlockers } from '../analysis-state-v1.js';

// ---------------------------------------------------------------------------
// The real capture
// ---------------------------------------------------------------------------

const DRAWS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../cee/transforms/__tests__/fixtures/sendable-variance-draws-2026-08-19.json',
        import.meta.url,
      ),
    ),
    'utf-8',
  ),
) as Record<string, { draft_graph: GraphV3T }>;

/** The mute-refusal option, by identity. Both constants are the capture's. */
const MUTE_OPTION_ID = 'e405d56a';
const MUTE_OPTION_LABEL = 'Status Quo: Hold current strategy';

/**
 * Draw-5 restricted to the one option the capture graded `needs_user_mapping`.
 * The option, its label and its (empty) interventions are all the capture's;
 * the restriction removes the OTHER options, whose factor-level blockers are
 * what stop the whole draw from showing the mute case.
 */
function mutedReadinessPayload() {
  const graph = JSON.parse(JSON.stringify(DRAWS['draw-5'].draft_graph)) as GraphV3T;
  const keptNodes = (graph.nodes as NodeV3T[]).filter(
    (n) => n.kind !== 'option' || (n as unknown as { id: string }).id === MUTE_OPTION_ID,
  );
  const keptIds = new Set(keptNodes.map((n) => (n as unknown as { id: string }).id));
  graph.nodes = keptNodes as never;
  graph.edges = (graph.edges as unknown as Array<{ from: string; to: string }>).filter(
    (e) => keptIds.has(e.from) && keptIds.has(e.to),
  ) as never;
  return assessCanonicalAnalysisReadiness(graph).analysisReady;
}

const canonical = {
  status: 'blocked',
  usableForProse: false,
  usableForChips: false,
  usableForFollowupContext: false,
  requiresRerun: false,
  blockedUnusable: false,
  contradictions: [],
  freshness: 'none',
} as never;

function composedReadiness(readiness: unknown) {
  const state = composeAnalysisStateV1({ canonical, readiness, rawRobustness: null } as never);
  return (state as unknown as { readiness: { blockers: unknown[] } }).readiness;
}

// ---------------------------------------------------------------------------

describe('PRECONDITION — the capture reproduces the staging row', () => {
  /**
   * A positive control (trap 13). An assertion that the composer now names a
   * gap is vacuous unless the payload it is given genuinely has the shape the
   * staging row had: NO stated blockers, but an issue that does name the gap.
   * If a future change starts populating `blockers` here, every assertion
   * below would be exercising the STATED path and would still pass — for the
   * wrong reason.
   */
  it('the assessor states NO blockers and DOES state a naming issue', () => {
    const readiness = mutedReadinessPayload();
    expect(readiness?.blockers ?? []).toHaveLength(0);

    const naming = (readiness?.readiness_issues ?? []).filter(
      (i) => i.option_id === MUTE_OPTION_ID,
    );
    expect(naming).toHaveLength(1);
    expect(naming[0].code).toBe('OPTION_NEEDS_MAPPING');
    expect(naming[0].message).toContain(MUTE_OPTION_LABEL);
  });
});

describe('THE REFUSAL NAMES THE GAP ON THE WIRE', () => {
  /** ⭐ THE RED-FIRST ASSERTION. At pristine this composed to `[]`. */
  it('the composed readiness carries at least one blocker', () => {
    expect(composedReadiness(mutedReadinessPayload()).blockers).not.toHaveLength(0);
  });

  it('the wire blocker is scoped to THE option, by id and by label', () => {
    const blockers = composedReadiness(mutedReadinessPayload()).blockers as Array<
      Record<string, unknown>
    >;
    const mine = blockers.filter((b) => b.option_id === MUTE_OPTION_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0].option_label).toBe(MUTE_OPTION_LABEL);
    expect(mine[0].message).toContain(MUTE_OPTION_LABEL);
  });

  /**
   * ⭐⭐ THE ASSERTION THAT MAKES THE REST MEAN ANYTHING.
   *
   * The contract's `AnalysisBlocker` is `.strict()`. A `CanonicalReadinessIssue`
   * carries `issue_id`, `provenance`, `obligation` and `waived_by_exclusion`
   * ON TOP of the eight permitted fields — every one of which would REJECT the
   * whole block at the consumer. Emitting a shape the consumer cannot read is
   * the EXACT defect this change fixes, so the wire shape is validated against
   * the shared schema itself rather than eyeballed.
   */
  it('every composed blocker validates against the STRICT contract schema', () => {
    const blockers = composedReadiness(mutedReadinessPayload()).blockers;
    expect(blockers.length).toBeGreaterThan(0);
    for (const blocker of blockers) {
      const parsed = AnalysisBlockerSchema.safeParse(blocker);
      // Surface the rejection rather than a bare `false`.
      expect(parsed.success ? null : JSON.stringify(parsed.error.issues)).toBeNull();
    }
  });

  it('the assessor-authored sentence is carried VERBATIM, not rewritten', () => {
    const readiness = mutedReadinessPayload();
    const authored = (readiness?.readiness_issues ?? []).find(
      (i) => i.option_id === MUTE_OPTION_ID,
    );
    const wire = (
      composedReadiness(readiness).blockers as Array<Record<string, unknown>>
    ).find((b) => b.option_id === MUTE_OPTION_ID);
    // CEE owns user-facing language; this seam carries it and must not compose
    // a substitute (the rule `blockerIssue`'s own header states).
    expect(wire?.message).toBe(authored?.message);
    expect(wire?.code).toBe(authored?.code);
  });
});

describe('`unspecified` STAYS REACHABLE — no blocker is invented', () => {
  /**
   * ⛔ THE HARD CONSTRAINT. A fix that made every refusal carry a blocker would
   * have removed the UI's only truthful answer for a verdict that genuinely
   * holds nothing nameable — trading a mute refusal for a fabricated one,
   * which is strictly worse.
   */
  it('a readiness with neither blockers nor issues composes to an EMPTY list', () => {
    expect(composedReadiness({ status: 'blocked' }).blockers).toHaveLength(0);
  });

  it('an issue list that names nothing usable composes to an EMPTY list', () => {
    // Missing the contract-required `category`/`repairability`: not renderable,
    // and inventing them would put a fabricated category in front of a user.
    expect(
      issuesAsWireBlockers([{ code: 'X', message: 'something' }, null, 'not an object']),
    ).toHaveLength(0);
  });
});

describe('THE FALLBACK IS A FALLBACK, NOT A MERGE', () => {
  /**
   * These are the SAME gaps seen from two sides. Appending both would show the
   * user one gap twice and inflate every downstream count.
   *
   * ⭐ A DISCRIMINATING FIXTURE: the stated blocker and the issue name
   * DIFFERENT options, so "stated wins" and "both appear" give different
   * answers. A fixture where they matched could not tell the two apart.
   */
  it('a stated blocker suppresses the issue fallback entirely', () => {
    const blockers = composedReadiness({
      status: 'needs_user_mapping',
      blockers: [
        {
          option_id: 'opt_stated',
          option_label: 'Stated Option',
          factor_id: 'f1',
          factor_label: 'Factor One',
          blocker_type: 'missing_value',
          message: 'Factor "Factor One" is currently 50,000. What should option "Stated Option" set it to?',
          suggested_action: 'add_value',
        },
      ],
      readiness_issues: [
        {
          issue_id: 'semantic_1',
          code: 'OPTION_NEEDS_MAPPING',
          category: 'option_mapping',
          message: 'Choose which factor "Other Option" changes and by how much.',
          repairability: 'human_input_required',
          option_id: 'opt_other',
          option_label: 'Other Option',
        },
      ],
    }).blockers as Array<Record<string, unknown>>;

    expect(blockers.map((b) => b.option_id)).toEqual(['opt_stated']);
  });
});

describe('WHAT IS CARRIED, AND WHAT IS NOT', () => {
  const issue = (over: Record<string, unknown>) => ({
    issue_id: 'semantic_1',
    code: 'OPTION_NEEDS_MAPPING',
    category: 'option_mapping',
    message: 'Choose which factor "X" changes and by how much.',
    repairability: 'human_input_required',
    option_id: 'opt_x',
    ...over,
  });

  /**
   * ⚠⚠ THIS CASE REVERSED THE FIRST IMPLEMENTATION, AND THE MEASUREMENT IS THE
   * REASON. `issuesAsWireBlockers` originally dropped `obligation: 'offered'`,
   * copying the rule the UI applies in `readinessAuthoredRefusalItems`.
   * Measured on the 19 Aug corpus, EVERY option-scoped issue is `'offered'` —
   * `provenance` is `unattributed` on a draft graph — INCLUDING the
   * `MISSING_OPTION_VALUE` issues whose blockers already ship on the wire via
   * `mapWireBlockers`, which applies no obligation filter at all. So the filter
   * left the mute refusal exactly as mute AND made the wire field mean
   * different things depending on which source populated it.
   *
   * This test pins the corrected rule so it cannot be "tidied" back.
   */
  it('an OFFERED issue is CARRIED — the demand/offer call is the consumer\'s', () => {
    expect(issuesAsWireBlockers([issue({ obligation: 'offered' })])).toHaveLength(1);
  });

  it('a REQUIRED issue, and an issue of an unknown class, are also carried', () => {
    expect(issuesAsWireBlockers([issue({ obligation: 'required' })])).toHaveLength(1);
    expect(issuesAsWireBlockers([issue({ obligation: 'some_future_class' })])).toHaveLength(1);
  });

  /**
   * ⚠ A DIFFERENT QUESTION FROM `obligation`, which is why it survives the
   * reversal above. `waived_by_exclusion` does not say how to RENDER a gap; it
   * says this gap is not what stands in the way, because the run will proceed
   * by excluding or holding that option. Naming it as the reason for a refusal
   * would name a non-reason.
   *
   * ⚠ STATED SCOPE: the field is `undefined` throughout the capture corpus, so
   * this branch is covered by this unit case and by nothing else.
   */
  it('an issue the run will step around is NOT named as the reason', () => {
    expect(issuesAsWireBlockers([issue({ waived_by_exclusion: true })])).toHaveLength(0);
  });

  it('the carried issue drops every field the strict contract forbids', () => {
    const [blocker] = issuesAsWireBlockers([
      issue({ obligation: 'required', provenance: 'user_authored', waived_by_exclusion: false }),
    ]);
    expect(AnalysisBlockerSchema.safeParse(blocker).success).toBe(true);
    expect(Object.keys(blocker)).not.toContain('issue_id');
    expect(Object.keys(blocker)).not.toContain('provenance');
    expect(Object.keys(blocker)).not.toContain('obligation');
    expect(Object.keys(blocker)).not.toContain('waived_by_exclusion');
  });
});
