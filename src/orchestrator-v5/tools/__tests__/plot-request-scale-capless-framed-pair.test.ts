/**
 * ── THE CAPLESS FRAMED PAIR REACHES THE INTERVENTION SEAM UNRECOGNISED ─────
 *
 * THE USER-VISIBLE DEFECT (measured on deployed staging, 2026-08-29): a fresh
 * first draft of an ordinary brief is refused analysis with *"I can't run this
 * analysis safely … I don't have a step I can promise will clear it"* — a dead
 * end the user cannot act on, on a model they have not yet touched. Measured
 * rate: 2 of 8 fresh drafts that produced a graph, from ONE brief.
 *
 * THE MECHANISM, and it is a TWINS defect (CLAUDE.md trap 21), not a threshold:
 * the records projector (`cee/draft/records/projector.ts`) writes
 * magnitude-scaled factors as CAPLESS FRAMED PAIRS by design — `value` is the
 * level, `raw_value` is the user's magnitude, and the frame is deliberately not
 * persisted. `recoverScaleFrame` (`d1-shared/scale-frame.ts`) is this estate's
 * ONE OWNER of the question "does this pair encode a frame?", and it recovers
 * it as `raw_value / value`.
 *
 * The BASELINE gate already consults that owner and correctly rules such a
 * factor COMPUTES (see `findScaleIncoherentBaselineFactorIds`' header, the
 * PAIR-ENCODED-FRAME class). The INTERVENTION path — `scaleNumeric`'s rule 1 —
 * never asks it. With no cap it can prove no `unitIntervalEquivalent`, so the
 * pair is UNDEMOTABLE, the request is unresolvably mixed, and `run_analysis`
 * refuses — naming a factor whose value the product itself framed.
 *
 * Two gates, one concept, one owner, and only one of them consults it.
 *
 * WHAT THE FIX IS NOT. It does not relax the gate: the postcondition still
 * asserts `[0,1]` on the emitted payload, and every shape whose pair does NOT
 * encode a frame is still refused (the TWINS below). It does not add a
 * threshold. It wires the second consumer to the owner the estate already
 * designated — the smallest change that removes the inconsistency.
 *
 * ── PROVENANCE OF THE CORPUS ───────────────────────────────────────────────
 * `fixtures/staging-capless-framed-pair-captures-2026-08-29.json` is EIGHT
 * REAL CAPTURES from deployed staging (signed-in, fresh scenario per run, one
 * brief), each carrying the factor/option nodes, the options mirror, and the
 * verdict the DEPLOYED product returned. It is evidence, not a fixture anyone
 * wrote: `observedBlockedReason` is what staging said, not what this file
 * wants. Append-only (trap 14b).
 *
 * ⚠ SCOPE, STATED RATHER THAN BURIED. Replaying the captures through the
 * production sequence reproduces the deployed verdict on 7 of 8. Capture
 * `20260829T171505-vs12-977dfc` deployed-blocked and replays as NOT blocked —
 * its persisted-graph read and its analysis were separate requests and some
 * input this replay cannot see differed. It is therefore carried in the corpus
 * but EXCLUDED BY NAME from the reproduction assertion, rather than quietly
 * dropped or asserted about. The acceptance below binds to
 * `20260829T171257-vs20-b4bfff`, where the reproduction is exact.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { gateAnalysableOptions } from '../handlers/analysable-option-gate.js';
import { recoverScaleFrame } from '../handlers/d1-shared/scale-frame.js';
import {
  buildFactorScaleMap,
  decideAnalysisScaleBlock,
  findScaleIncoherentBaselineFactorIds,
  projectRequestInterventionsToWireScale,
} from '../plot-intervention-scale.js';

interface Capture {
  capture: string;
  provenance: string;
  note?: string;
  observedAnalysisReadyStatus: string | null;
  observedBlockedReason: string | null;
  graphNodes: Array<Record<string, unknown>>;
  options: Array<Record<string, unknown>>;
}

const CAPTURES = JSON.parse(
  readFileSync(
    new URL('./fixtures/staging-capless-framed-pair-captures-2026-08-29.json', import.meta.url),
    'utf8',
  ),
) as Capture[];

/** The one capture whose deployed block this replay reproduces exactly. */
const BLOCKED_CAPTURE_ID = '20260829T171257-vs20-b4bfff';
/** "Raw development headcount" — the factor staging named in its refusal. */
const FRAMED_PAIR_FACTOR_ID = '63e58ac1';
/** The drafter's own framed level for that intervention, as persisted. */
const FRAMED_LEVEL = 0.4;
/** The display magnitude beside it ("2 developers"). */
const DISPLAY_MAGNITUDE = 2;
/** See the scope note in the header. */
const NOT_REPRODUCED_BY_REPLAY = new Set(['20260829T171505-vs12-977dfc']);

/**
 * The EXACT production sequence `run_analysis` runs (derived at
 * `handlers/run-analysis.ts:511-545`): gate → per-option raw objects +
 * synthesised markers → request projection → baseline gate → one verdict.
 * Replicated rather than approximated: a reconstruction that skipped
 * `gateAnalysableOptions` did NOT reproduce the deployed block at all, because
 * the stranded unit-scale siblings are the HOLD values that gate synthesises.
 */
function runProductionScaleSequence(c: Capture) {
  const graph = { nodes: c.graphNodes, options: c.options };
  const gate = gateAnalysableOptions({
    options: c.options,
    graph,
    rawPersistedGraph: graph,
    scaleNetEnabled: true,
  } as unknown as Parameters<typeof gateAnalysableOptions>[0]);
  const submitted = gate.options as ReadonlyArray<Record<string, unknown>>;
  const rawObjectsPerOption = submitted.map((o) =>
    o.interventions !== null && typeof o.interventions === 'object'
      ? (o.interventions as Record<string, unknown>)
      : {},
  );
  const heldByOptionId = new Map<string, ReadonlySet<string>>();
  for (const rec of gate.held) heldByOptionId.set(rec.option_id, new Set(rec.factor_ids));
  const EMPTY: ReadonlySet<string> = new Set<string>();
  const synthesisedByOption = submitted.map((o) => {
    const id =
      typeof o.option_id === 'string' && o.option_id.length > 0
        ? o.option_id
        : typeof o.id === 'string' && o.id.length > 0
          ? o.id
          : null;
    return (id !== null ? heldByOptionId.get(id) : undefined) ?? EMPTY;
  });
  const projection = projectRequestInterventionsToWireScale(
    rawObjectsPerOption,
    buildFactorScaleMap(c.graphNodes),
    synthesisedByOption,
  );
  const baselineIds = findScaleIncoherentBaselineFactorIds(
    c.graphNodes,
    rawObjectsPerOption,
    synthesisedByOption,
  );
  return { verdict: decideAnalysisScaleBlock(projection, baselineIds), projection };
}

const captureById = (id: string): Capture => {
  const c = CAPTURES.find((x) => x.capture === id);
  // Bind by IDENTITY, and fail loud if the corpus ever stops carrying it —
  // a `find` that silently returns undefined would make every assertion below
  // vacuous (trap 13).
  if (c === undefined) throw new Error(`corpus no longer carries capture ${id}`);
  return c;
};

describe('the corpus is real evidence and this replay reproduces it', () => {
  it('carries the deployed verdict for every capture, and both directions are present', () => {
    expect(CAPTURES.length).toBe(8);
    const blocked = CAPTURES.filter((c) => c.observedBlockedReason === 'mixed_scale_unresolved');
    const ran = CAPTURES.filter((c) => c.observedAnalysisReadyStatus === 'ready');
    // A corpus with only one direction cannot see the opposite harm (trap 22b).
    expect(blocked.length).toBeGreaterThan(0);
    expect(ran.length).toBeGreaterThan(0);
    expect(blocked.length + ran.length).toBe(CAPTURES.length);
  });

  /**
   * ⚠ WHY THIS ASSERTS OVER THE COMPUTED CAPTURES ONLY, AND WHAT REPLACES THE
   * OTHER HALF. At pristine this replay reproduced the deployed verdict on 7 of
   * 8 — INCLUDING the block on `20260829T171257-vs20-b4bfff`, with the recorded
   * signature `expected [ 0.5, 2 ] to include 0.4`: the wire carried the
   * stranded hold baseline and the display magnitude, never the drafter's own
   * level. That reproduction is the RED this change was written against, and
   * this change DELIBERATELY flips it — so it cannot also stand as a permanent
   * assertion, or the suite would be pinning the defect.
   *
   * What survives here is the half that must never move: every capture that
   * COMPUTED on staging must still compute. What replaces the flipped half is
   * the discriminating mutant pair, which proves the block is still reachable
   * and still bound to this factor.
   */
  it('replays every capture that COMPUTED on staging to the same verdict', () => {
    const disagreements: string[] = [];
    let asserted = 0;
    for (const c of CAPTURES) {
      if (NOT_REPRODUCED_BY_REPLAY.has(c.capture)) continue;
      if (c.observedAnalysisReadyStatus !== 'ready') continue;
      asserted += 1;
      const { verdict } = runProductionScaleSequence(c);
      if (verdict.blocked) disagreements.push(`${c.capture}: computed on staging, replay blocks`);
    }
    expect(disagreements).toEqual([]);
    // A loop that asserted nothing would pass identically (trap 13).
    expect(asserted).toBe(6);
  });

  it('the blocked capture carries the capless framed pair the projector writes by design', () => {
    const c = captureById(BLOCKED_CAPTURE_ID);
    const option = c.options.find(
      (o) =>
        o.interventions !== null &&
        typeof o.interventions === 'object' &&
        FRAMED_PAIR_FACTOR_ID in (o.interventions as Record<string, unknown>),
    );
    expect(option, 'the capture must carry the intervention the refusal named').toBeDefined();
    const iv = (option!.interventions as Record<string, Record<string, unknown>>)[
      FRAMED_PAIR_FACTOR_ID
    ];
    expect(iv.value).toBe(FRAMED_LEVEL);
    expect(iv.raw_value).toBe(DISPLAY_MAGNITUDE);
    // Capless BY DESIGN — the projector deliberately persists no cap.
    const factor = c.graphNodes.find((n) => n.id === FRAMED_PAIR_FACTOR_ID);
    expect(factor, 'the named factor must be in the capture').toBeDefined();
    expect(buildFactorScaleMap(c.graphNodes).get(FRAMED_PAIR_FACTOR_ID)?.cap).toBeUndefined();
    // And the OWNER recognises the pair. This is the whole claim: the evidence
    // needed to demote was already recoverable, by a function already imported
    // into this module for the baseline gate.
    expect(recoverScaleFrame({ value: iv.value, raw_value: iv.raw_value })).toBe(
      DISPLAY_MAGNITUDE / FRAMED_LEVEL,
    );
  });
});

describe('ACCEPTANCE — a model the product framed itself is analysable', () => {
  it('does not refuse the fresh first draft staging refused', () => {
    const { verdict } = runProductionScaleSequence(captureById(BLOCKED_CAPTURE_ID));
    expect(verdict.blocked).toBe(false);
  });

  it("sends the drafter's own framed level, never the display magnitude", () => {
    const { projection } = runProductionScaleSequence(captureById(BLOCKED_CAPTURE_ID));
    // Bound BY IDENTITY (the factor id staging named), never by a value
    // predicate another factor could satisfy (trap 19).
    const emitted = projection.perOption
      .map((o) => o[FRAMED_PAIR_FACTOR_ID])
      .filter((v): v is number => typeof v === 'number');
    expect(emitted).toContain(FRAMED_LEVEL);
    expect(emitted).not.toContain(DISPLAY_MAGNITUDE);
    // The postcondition the gate exists to protect still holds on the payload.
    expect(projection.allWithinUnitInterval).toBe(true);
    expect(projection.postconditionViolated).toBe(false);
    expect(projection.demoted).toBe(true);
  });

  it('leaves every capture that already computed exactly as it was', () => {
    // The opposite harm: a fix that unblocks must not change a working answer.
    for (const c of CAPTURES) {
      if (c.observedAnalysisReadyStatus !== 'ready') continue;
      const { verdict } = runProductionScaleSequence(c);
      expect(verdict.blocked, `${c.capture} computed on staging and must still compute`).toBe(false);
    }
  });
});

describe('TWINS — a model that genuinely should be refused is still refused', () => {
  /**
   * Each twin takes the REAL blocked capture and changes ONE thing: the pair on
   * the named factor. Everything else — the graph, the options, the hold
   * synthesis, the stranded siblings — is the live capture. Labelled synthetic,
   * never presented as an observation.
   */
  const withPair = (value: unknown, raw: unknown): Capture => {
    const c = captureById(BLOCKED_CAPTURE_ID);
    const clone = JSON.parse(JSON.stringify(c)) as Capture;
    for (const o of clone.options) {
      const ivs = o.interventions as Record<string, Record<string, unknown>> | null;
      if (ivs !== null && typeof ivs === 'object' && FRAMED_PAIR_FACTOR_ID in ivs) {
        ivs[FRAMED_PAIR_FACTOR_ID] = { ...ivs[FRAMED_PAIR_FACTOR_ID], value, raw_value: raw };
      }
    }
    return clone;
  };

  it('a bare magnitude with NO framed level beside it is still refused', () => {
    // `{value: 2, raw_value: 2}` — the unframed writers' shape. `raw > value`
    // fails, so the owner recovers no frame and there is no unit form to demote
    // to. This is the shape the refusal was written for and it must survive.
    const { verdict } = runProductionScaleSequence(withPair(DISPLAY_MAGNITUDE, DISPLAY_MAGNITUDE));
    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked && verdict.reason_code).toBe('mixed_scale_unresolved');
    expect(verdict.blocked && verdict.unresolvedFactorIds).toContain(FRAMED_PAIR_FACTOR_ID);
  });

  it('a zero level is still refused — zero is scale-ambiguous', () => {
    // The owner refuses zero pairs BY CONSTRUCTION (0 == 0/anything), and this
    // consumer must not be more permissive than the owner it consults.
    const { verdict } = runProductionScaleSequence(withPair(0, DISPLAY_MAGNITUDE));
    expect(verdict.blocked).toBe(true);
  });

  it('a negative pair is still refused', () => {
    // Sign-symmetric with PLoT's own gate. A negative is never a framed
    // producer state, since frames divide positives.
    const { verdict } = runProductionScaleSequence(withPair(-FRAMED_LEVEL, -DISPLAY_MAGNITUDE));
    expect(verdict.blocked).toBe(true);
  });

  it('an OVER-FRAME level outside the unit interval is still refused', () => {
    // `{value: 5, raw_value: 500000}` recovers a frame (the owner allows a
    // level above 1 — an over-frame edit is honest), but 5 is NOT a unit-interval
    // representation, so it cannot serve as `unitIntervalEquivalent` without
    // violating that field's own contract and the payload postcondition.
    // The consumer needs BOTH conditions, not just the owner's verdict.
    expect(recoverScaleFrame({ value: 5, raw_value: 500000 })).toBeDefined();
    const { verdict } = runProductionScaleSequence(withPair(5, 500000));
    expect(verdict.blocked).toBe(true);
  });
});
