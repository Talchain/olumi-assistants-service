/**
 * FOUR RECEIVING COUNTERPARTS for the coaching claim authorities.
 *
 * Witnessed failure (root's native check, request `23ab579d-5dda-4e5f-9ed9-a9eb889446f8`,
 * 8 Sep 2026): one response gives a comparative assessment — "The RudderStack lead is not yet
 * firm. It's ahead in 55% of runs against Segment's 36%" — while its own analysis block says
 * "No single option can be put forward yet" with `leading_option_id: null`.
 *
 * ⭐⭐ THE POPULATIONS, because getting this wrong reverses a ruling.
 *   · Paul, 7 Sep (relayed at `olumi-programme-docs#38` comment `5576895511`):
 *     `quantified_provisional` is **caveat, not withhold**.
 *   · #1254 (merged `9de184f1`): withhold where the options **cannot be separated**.
 * The captured run is `quantified_provisional` AND `separation: separated`, with a stated
 * percentage — Paul's population, not #1254's. So the repair is NOT to withhold from the coach,
 * and NOT to widen the prose classifier so both surfaces withhold. Either would apply #1254's
 * rule to the wrong population. Full disposition:
 * `output/olumi-codex-reactivation-20260908/contextual-research/SCOPE-DISPOSITION-f361-20260908.md`.
 *
 * `analysis_state.leader_claim` answers entitlement x separation; the admission gate answers
 * semantic mode. Neither is wrong — they were composed for this consumer WITHOUT the separation
 * term the ruling turns on, so the coach received leader fields with no signal to qualify them.
 *
 * These four counterparts are the receiving contract. (1) is the new behaviour; (2)-(4) pin the
 * behaviour that must NOT move.
 */
import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { analysisSummaryFixture } from './context-budget-fixtures.js';
import { underBudgetCompactGraph } from './context-budget-fixtures.js';
import {
  ANALYSIS_CONTEXT_INSTRUCTION,
  PROVISIONAL_FIGURES_INSTRUCTION,
  buildUserMessage,
} from '../../routing/route-with-tool-use.js';

const BASE_PAYLOAD = makeMessagePayload();

const COMMON = {
  payload: BASE_PAYLOAD,
  priorTurns: [],
  priorTurnsTotal: 0,
  priorFacts: [],
  graphContext: { status: 'canonical' as const },
  compactedGraph: underBudgetCompactGraph(),
  compactedConstraints: null,
  analysis: analysisSummaryFixture(),
  displayAnalysisSource: analysisSummaryFixture(),
};

/** The leader-bearing fields the withheld projection strips. */
function leaderFields(pack: ReturnType<typeof assembleContextPack>): {
  leading: unknown;
  runnerUp: unknown;
  margin: unknown;
} {
  const display = pack.display_analysis as Record<string, unknown> | null | undefined;
  return {
    leading: display?.['leading_option'],
    runnerUp: display?.['runner_up'],
    margin: display?.['margin'],
  };
}

describe('receiving counterparts for the coaching claim authorities', () => {
  it('(1) provisionally quantified AND genuinely separable — comparative information survives, QUALIFIED', () => {
    const pack = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: { status: 'qualified', mode: 'quantified_provisional' },
    });

    // Paul's ruling: caveat, NOT withhold. The comparative material the person
    // asked about must still reach the coach.
    const permitted = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: { status: 'permitted' },
    });
    expect(leaderFields(pack)).toEqual(leaderFields(permitted));

    // …and the coach must be TOLD it is provisional, or "caveat" is a hope, not
    // a contract. The marker and its instruction are emitted by one condition.
    expect(pack.analysis_context).toEqual({ status: 'provisional_figures' });
    // ⚠ BOUND BY IDENTITY to the exact instruction constants, not by a phrase.
    //   My first cut asserted the wording "could not be established", which an
    //   unrelated always-rendered graph-status instruction ALSO contains — so it
    //   could pass without either analysis instruction being emitted at all.
    const message = buildUserMessage(pack, BASE_PAYLOAD.message);
    expect(message).toContain(PROVISIONAL_FIGURES_INSTRUCTION);
    // The unavailable-analysis instruction must NOT be borrowed for this case:
    // the analysis IS established here, it is merely not settled.
    expect(message).not.toContain(ANALYSIS_CONTEXT_INSTRUCTION);
  });

  it('(2) not separable / unknown separation — no invented ordering reaches the coach', () => {
    const pack = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: {
        status: 'withheld',
        constraintVerdictState: 'unevaluated',
        provenance: 'scenario_fact',
      },
    });
    const fields = leaderFields(pack);
    expect(fields.leading).toBeUndefined();
    expect(fields.runnerUp).toBeUndefined();
    expect(fields.margin).toBeUndefined();
    // Never-silent: the withheld projection replaces what it removed.
    expect(pack.display_analysis).not.toBeNull();
  });

  it('(3) genuine constraint / identity / currentness restriction keeps its unavailable route', () => {
    const pack = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: {
        status: 'withheld',
        constraintVerdictState: null,
        provenance: 'fail_closed_unavailable',
      },
    });
    expect(pack.analysis_context).toEqual({ status: 'unavailable' });
    const message = buildUserMessage(pack, BASE_PAYLOAD.message);
    expect(message).toContain(ANALYSIS_CONTEXT_INSTRUCTION);
    expect(message).not.toContain(PROVISIONAL_FIGURES_INSTRUCTION);
  });

  it('(4) missing admission compatibility — legacy behaviour retained, no new policy', () => {
    const pack = assembleContextPack({ ...COMMON });
    const permitted = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: { status: 'permitted' },
    });
    // An absent input must not silently become either new state.
    expect(leaderFields(pack)).toEqual(leaderFields(permitted));
    expect(pack.analysis_context).toBeUndefined();
  });

  it('the three states are DISTINCT — qualified is neither permitted nor withheld', () => {
    // ⚠ Without this, a `qualified` that quietly aliased `permitted` would pass
    // (1) and (4) together while carrying no caveat at all.
    const qualified = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: { status: 'qualified', mode: 'quantified_provisional' },
    });
    const permitted = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: { status: 'permitted' },
    });
    const withheld = assembleContextPack({
      ...COMMON,
      modelFacingClaimSafety: {
        status: 'withheld',
        constraintVerdictState: 'unevaluated',
        provenance: 'scenario_fact',
      },
    });
    expect(qualified.analysis_context).not.toEqual(permitted.analysis_context);
    expect(leaderFields(qualified)).not.toEqual(leaderFields(withheld));
  });
});
