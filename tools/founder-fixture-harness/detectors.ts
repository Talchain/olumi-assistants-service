/**
 * The instruments, and the controls that prove they can see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY DETECTOR HERE IS IMPORTED FROM ITS PRODUCER. NONE IS RE-IMPLEMENTED.
 *
 * The vocabularies below have each been got wrong at least once by a second
 * hand-kept copy (CLAUDE.md trap 12, and `process-narration.ts`'s own header
 * records `strip-planning-preamble.ts` having its copies deleted for exactly
 * this). So:
 *
 *   narration      ← src/orchestrator-v5/compose/process-narration.ts
 *   leader claims  ← src/orchestrator-v5/compose/leading-option-egress-guard.ts
 *   ordinal keys   ← src/orchestrator-v5/compose/withheld-claim-projection.ts
 *   standing /
 *   robustness keys← src/orchestrator-v5/compose/unrequested-analysis-confinement.ts
 *   claim vocab    ← tools/v5-journey-replay/assurance/blocked-claim-fields.ts
 *   admission rank ← src/orchestrator-v5/admission/analysis-admission.ts
 *   coherence      ← DecisionGuideAI src/lib/coherence/ (a different repo — see below)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AND EVERY DETECTOR RUNS TWO CONTROLS BEFORE ITS VERDICT IS BELIEVED.
 *
 * CLAUDE.md trap 13: "Any test proving an ABSENCE must first prove it can SEE
 * a PRESENCE." Four of the six criteria are absence claims — no narration, no
 * leader designation, no contradiction, no misroute. A blind instrument returns
 * a perfect, confident zero for all of them.
 *
 * So each detector is exercised on a case it MUST flag (positive) and a case it
 * MUST NOT (negative). A detector whose positive control does not fire is
 * reported UNAVAILABLE and its criterion is NOT_ASSESSED — never PASS.
 * A detector whose negative control DOES fire is stuck on, and is likewise
 * unavailable: an alarm that always rings decides nothing either.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { findProcessNarrationHit } from '../../src/orchestrator-v5/compose/process-narration.js';
import {
  findLeaderClaims,
  keyDesignatesLeadingOption,
  textNamesLeadingOption,
} from '../../src/orchestrator-v5/compose/leading-option-egress-guard.js';
import { keyDesignatesOrdinalPosition } from '../../src/orchestrator-v5/compose/withheld-claim-projection.js';
import {
  keyStatesComparativeStanding,
  keyStatesRobustnessVerdict,
} from '../../src/orchestrator-v5/compose/unrequested-analysis-confinement.js';
import { findBlockedClaimMatches } from '../v5-journey-replay/assurance/blocked-claim-fields.js';
import type { DetectorStatus } from './types.js';

// ---------------------------------------------------------------------------
// Control corpora — pinned literals, never "whatever is current".
// ---------------------------------------------------------------------------

/**
 * The narration positive control is a LIVE CAPTURE, not an invention.
 * `process-narration.ts`'s own header quotes it verbatim from debug bundle
 * `olumi-debug-f2e2df1b-20260903.json` (UI build `86786efb`) — and the turn it
 * was captured on IS this fixture's turn 7. The instrument's control and the
 * criterion's subject are the same sentence, which is the strongest form of
 * "the probe is pointed at the thing".
 *
 * CLAUDE.md trap 12b: a control pinned to a HISTORICAL artefact, never to
 * "whatever the module currently emits".
 */
export const NARRATION_POSITIVE_CONTROL =
  'This is a question about existing analysis results, not a model edit request.';

/** Ordinary product prose. Must not trip the narration scanner. */
export const NARRATION_NEGATIVE_CONTROL =
  'Hiring a sales team reaches the goal in more of the simulated futures than founder-led selling does.';

export const LEADER_POSITIVE_CONTROL = 'Hire a sales team currently leads.';
export const LEADER_NEGATIVE_CONTROL =
  'Both routes reach the goal in some futures; nothing separates them yet.';

/**
 * `blocked-claim-fields.ts` states its own false-positive boundary: `robustness`
 * matches the metric noun but NOT the adjective "robust". The negative control
 * pins that boundary, so a future widening that starts eating ordinary English
 * shows up here rather than as a mystery C1 failure.
 */
export const CLAIM_VOCAB_POSITIVE_CONTROL = 'The robustness of this ranking is high.';
export const CLAIM_VOCAB_NEGATIVE_CONTROL = 'That looks like a robust plan to me.';

// ---------------------------------------------------------------------------
// Coherence — the one detector that lives in another repo.
// ---------------------------------------------------------------------------

/**
 * `evaluateCrossSurfaceCoherence` + `adaptCapture` live in the UI repo
 * (`DecisionGuideAI src/lib/coherence/`). They are NOT copied here.
 *
 * Loading them needs a UI checkout WITH ITS DEPENDENCIES INSTALLED, because
 * `captureAdapter.ts` value-imports `AnalysisStateV1Schema` from
 * `@talchain/schemas/boundary` and Node resolves that bare specifier from the
 * IMPORTING file's directory — i.e. from the UI checkout, not from this one.
 *
 * When the checkout is absent or unresolvable, C4 is NOT_ASSESSED and the
 * resolution error is printed verbatim so the operator knows exactly what to
 * fix. It is never silently skipped, and it never degrades into a hand-rolled
 * substitute detector: a second implementation of a six-pair contradiction
 * gate would be the mirror defect, and its disagreements with the real one
 * would be invisible.
 */
export interface CoherenceModule {
  readonly evaluate: (capture: unknown) => readonly { pair: string; code?: string; detail?: string }[];
}

export interface DetectorBundle {
  readonly narration: {
    readonly findHit: (text: string) => string | null;
    readonly status: DetectorStatus;
  };
  readonly leaderClaim: {
    readonly findClaims: typeof findLeaderClaims;
    readonly textNames: (text: string) => boolean;
    readonly keyDesignatesLeader: (key: string) => boolean;
    readonly keyDesignatesOrdinal: (key: string) => boolean;
    readonly keyStatesStanding: (key: string) => boolean;
    readonly keyStatesRobustness: (key: string) => boolean;
    readonly status: DetectorStatus;
  };
  readonly claimVocabulary: {
    readonly findMatches: (text: string) => readonly string[];
    readonly status: DetectorStatus;
  };
  readonly coherence: {
    readonly module: CoherenceModule | undefined;
    readonly status: DetectorStatus;
  };
}

function narrationStatus(): DetectorStatus {
  const positive = findProcessNarrationHit(NARRATION_POSITIVE_CONTROL);
  const negative = findProcessNarrationHit(NARRATION_NEGATIVE_CONTROL);
  const positiveControl = positive !== null ? 'fired' : 'did-not-fire';
  const negativeControl = negative === null ? 'silent' : 'fired';
  return {
    id: 'narration',
    available: positiveControl === 'fired' && negativeControl === 'silent',
    positiveControl,
    negativeControl,
    source: 'src/orchestrator-v5/compose/process-narration.ts (findProcessNarrationHit)',
    reason:
      positiveControl === 'fired' && negativeControl === 'silent'
        ? `positive control matched marker ${JSON.stringify(positive)}`
        : `positive=${JSON.stringify(positive)} negative=${JSON.stringify(negative)}`,
  };
}

function leaderStatus(): DetectorStatus {
  const positive = findLeaderClaims({ assistant_text: LEADER_POSITIVE_CONTROL, blocks: [] } as never);
  const negative = findLeaderClaims({ assistant_text: LEADER_NEGATIVE_CONTROL, blocks: [] } as never);
  // The key predicates get their own discriminating pair: a key that IS an
  // ordinal and a key that deliberately is NOT (`priority_rank` ranks CARDS,
  // not options — the producer's `^`-anchor exists for exactly that).
  const keyPositive =
    keyDesignatesLeadingOption('leading_option_id') &&
    keyDesignatesOrdinalPosition('rank') &&
    keyStatesRobustnessVerdict('robustness_verdict');
  const keyNegative =
    !keyDesignatesLeadingOption('win_probability') && !keyDesignatesOrdinalPosition('priority_rank');
  const positiveControl = positive.length > 0 && keyPositive ? 'fired' : 'did-not-fire';
  const negativeControl = negative.length === 0 && keyNegative ? 'silent' : 'fired';
  return {
    id: 'leader-claim',
    available: positiveControl === 'fired' && negativeControl === 'silent',
    positiveControl,
    negativeControl,
    source:
      'src/orchestrator-v5/compose/leading-option-egress-guard.ts (findLeaderClaims, keyDesignatesLeadingOption) + ' +
      'withheld-claim-projection.ts (keyDesignatesOrdinalPosition) + ' +
      'unrequested-analysis-confinement.ts (keyStatesComparativeStanding, keyStatesRobustnessVerdict)',
    reason: `prose hits=${positive.length}/${negative.length}, key predicates positive=${keyPositive} negative=${keyNegative}`,
  };
}

function claimVocabStatus(): DetectorStatus {
  const positive = findBlockedClaimMatches(CLAIM_VOCAB_POSITIVE_CONTROL);
  const negative = findBlockedClaimMatches(CLAIM_VOCAB_NEGATIVE_CONTROL);
  const positiveControl = positive.length > 0 ? 'fired' : 'did-not-fire';
  const negativeControl = negative.length === 0 ? 'silent' : 'fired';
  return {
    id: 'claim-vocabulary',
    available: positiveControl === 'fired' && negativeControl === 'silent',
    positiveControl,
    negativeControl,
    source: 'tools/v5-journey-replay/assurance/blocked-claim-fields.ts (findBlockedClaimMatches)',
    reason: `positive=${JSON.stringify(positive)} negative=${JSON.stringify(negative)}`,
  };
}

/**
 * Load the cross-surface coherence detector from a UI checkout and prove it
 * can see.
 *
 * The positive control is a CX5 contradiction — one factor that
 * `flip_thresholds` says cannot flip the winner and `conditional_winners` says
 * does. It is built from the pair's own declared inputs, needs no
 * `AnalysisStateV1` (so no schema-validation coupling), and its expressibility
 * is `'envelope'`, i.e. the detector's own contract says the wire can carry it.
 */
export async function loadCoherence(
  uiRepoPath: string | undefined,
): Promise<{ module: CoherenceModule | undefined; status: DetectorStatus }> {
  const source = 'DecisionGuideAI src/lib/coherence/{captureAdapter,crossSurfaceCoherence}.ts';
  if (uiRepoPath === undefined || uiRepoPath.trim().length === 0) {
    return {
      module: undefined,
      status: {
        id: 'cross-surface-coherence',
        available: false,
        positiveControl: 'not-run',
        negativeControl: 'not-run',
        source,
        reason:
          'no --ui-repo given. C4 is NOT ASSESSED. The detector is not re-implemented here on purpose: ' +
          'a second copy of a six-pair contradiction gate would drift from the real one silently.',
      },
    };
  }

  const adapterUrl = pathToFileURL(join(uiRepoPath, 'src/lib/coherence/captureAdapter.ts')).href;
  const gateUrl = pathToFileURL(join(uiRepoPath, 'src/lib/coherence/crossSurfaceCoherence.ts')).href;

  let gate: Record<string, unknown>;
  try {
    // Loaded for its side-effect-free exports only.
    await import(adapterUrl);
    gate = (await import(gateUrl)) as Record<string, unknown>;
  } catch (err) {
    return {
      module: undefined,
      status: {
        id: 'cross-surface-coherence',
        available: false,
        positiveControl: 'not-run',
        negativeControl: 'not-run',
        source,
        reason:
          `could not import from ${uiRepoPath}: ${String(err)}. ` +
          'The UI checkout needs its dependencies installed — `captureAdapter.ts` value-imports ' +
          '`@talchain/schemas/boundary`, which Node resolves from THAT checkout, not this one. ' +
          'Run `pnpm install` there, or accept C4 as NOT ASSESSED.',
      },
    };
  }

  const evaluate = gate.evaluateCrossSurfaceCoherence as
    | ((input: unknown) => readonly { pair: string }[])
    | undefined;
  const makeInput = gate.coherenceInput as ((partial: unknown) => unknown) | undefined;
  if (typeof evaluate !== 'function' || typeof makeInput !== 'function') {
    return {
      module: undefined,
      status: {
        id: 'cross-surface-coherence',
        available: false,
        positiveControl: 'not-run',
        negativeControl: 'not-run',
        source,
        reason:
          'module loaded but does not export evaluateCrossSurfaceCoherence + coherenceInput. ' +
          'The UI checkout is at a tip this harness does not know how to drive.',
      },
    };
  }

  const positiveInput = makeInput({
    enrichment: {
      flip_thresholds: [{ factor_id: 'fac_control', factor_label: 'Control', no_flip_in_range: true }],
      conditional_winners: [
        {
          factor_id: 'fac_control',
          factor_label: 'Control',
          winner_flips: true,
          low_bucket: { winner_id: 'opt_a', winner_label: 'A' },
          high_bucket: { winner_id: 'opt_b', winner_label: 'B' },
        },
      ],
    },
  });
  const negativeInput = makeInput({
    enrichment: {
      flip_thresholds: [{ factor_id: 'fac_control', factor_label: 'Control', no_flip_in_range: true }],
      conditional_winners: [
        { factor_id: 'fac_control', factor_label: 'Control', winner_flips: false },
      ],
    },
  });

  let positive: readonly { pair: string }[];
  let negative: readonly { pair: string }[];
  try {
    positive = evaluate(positiveInput);
    negative = evaluate(negativeInput);
  } catch (err) {
    return {
      module: undefined,
      status: {
        id: 'cross-surface-coherence',
        available: false,
        positiveControl: 'not-run',
        negativeControl: 'not-run',
        source,
        reason: `detector threw on its own control input: ${String(err)}`,
      },
    };
  }

  const positiveControl = positive.some((v) => v.pair === 'CX5') ? 'fired' : 'did-not-fire';
  const negativeControl = negative.length === 0 ? 'silent' : 'fired';
  const available = positiveControl === 'fired' && negativeControl === 'silent';

  return {
    module: available
      ? {
          evaluate: (capture: unknown) =>
            evaluate(capture) as readonly { pair: string; code?: string; detail?: string }[],
        }
      : undefined,
    status: {
      id: 'cross-surface-coherence',
      available,
      positiveControl,
      negativeControl,
      source: `${source} @ ${uiRepoPath}`,
      reason: `CX5 control violations=${JSON.stringify(positive.map((v) => v.pair))}, negative=${negative.length}`,
    },
  };
}

/** Also exported so the caller can adapt a raw turn body into a coherence input. */
export async function loadCaptureAdapter(
  uiRepoPath: string,
): Promise<((raw: unknown) => unknown) | undefined> {
  try {
    const mod = (await import(
      pathToFileURL(join(uiRepoPath, 'src/lib/coherence/captureAdapter.ts')).href
    )) as Record<string, unknown>;
    const fn = mod.adaptCapture;
    return typeof fn === 'function' ? (fn as (raw: unknown) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

export async function buildDetectors(uiRepoPath: string | undefined): Promise<DetectorBundle> {
  const coherence = await loadCoherence(uiRepoPath);
  return {
    narration: { findHit: findProcessNarrationHit, status: narrationStatus() },
    leaderClaim: {
      findClaims: findLeaderClaims,
      textNames: textNamesLeadingOption,
      keyDesignatesLeader: keyDesignatesLeadingOption,
      keyDesignatesOrdinal: keyDesignatesOrdinalPosition,
      keyStatesStanding: keyStatesComparativeStanding,
      keyStatesRobustness: keyStatesRobustnessVerdict,
      status: leaderStatus(),
    },
    claimVocabulary: { findMatches: findBlockedClaimMatches, status: claimVocabStatus() },
    coherence: { module: coherence.module, status: coherence.status },
  };
}
