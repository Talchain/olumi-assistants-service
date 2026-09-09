/**
 * edit_graph rejection copy — TRUTHFULNESS over the WHOLE code domain.
 *
 * The defect this pins: `PLOT_UNAVAILABLE` (the analysis service was
 * unreachable — an outage) shared an arm with `structural_validation`, so the
 * product told the user *"I wasn't able to make that change safely. Can you
 * describe what you'd like to add or change in simpler terms?"* — i.e. it
 * blamed the user's own input for our infrastructure failure. The `default`
 * arm did the same, so five further codes, every one of them a SYSTEM-side
 * failure, inherited the same false accusation.
 *
 * ⭐ WHY THIS SUITE IS DOMAIN-SHAPED, NOT CASE-SHAPED (CLAUDE.md review
 * doctrine): a copy mapping is a claim about EVERY code that can reach it, not
 * about the one the bug report came in through. So the table below is the
 * complete domain, and a separate assertion proves the table is neither short
 * nor carrying dead rows against the exported `EDIT_REJECTION_CODES`.
 *
 * ⭐ ASSERTIONS BIND BY IDENTITY: exact code string → exact reason string →
 * exact user-visible sentence, spelled out here rather than imported from the
 * module under test. Importing the copy would make these tests agree with
 * whatever the module says, which is a guard agreeing with itself.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEditRejectionResponse,
  type EditRejectionReason,
} from '../../../../src/orchestrator-v5/handlers/edit-rejection-text.js';
import {
  mapCodeToRejectionReason,
  classifyPlotFailureCode,
  EDIT_REJECTION_CODES,
  type EditRejectionCode,
} from '../../../../src/orchestrator/tools/edit-graph.js';
import { PLoTError, PLoTTimeoutError } from '../../../../src/orchestrator/plot-client.js';

/** The accusation that must never be shown for a failure the user did not cause. */
const STRUCTURAL_ACCUSATION =
  "I wasn't able to make that change safely. " +
  "Can you describe what you'd like to add or change in simpler terms?";

const SERVICE_UNAVAILABLE_COPY =
  "I couldn't reach the analysis service, so nothing in your model has changed. " +
  'Try again in a moment.';

const INTERNAL_FAILURE_COPY =
  'Something went wrong on my side, so nothing in your model has changed. ' +
  'Try again in a moment — and if it keeps happening, describing the change a ' +
  'different way may help.';

const UNKNOWN_FAILURE_COPY =
  "I couldn't complete that change, and nothing in your model has changed. " +
  'Try again in a moment, or describe the change a different way.';

/**
 * THE COMPLETE DOMAIN. Derived by reading every `buildRejectionResult` call
 * site at CEE staging d0544243 — 11 sites, 9 distinct codes, plus `undefined`
 * (the parameter is optional).
 *
 * `userFault` records WHOSE failure this is, and is what makes the accusation
 * assertion below meaningful rather than decorative.
 */
const CODE_TABLE: ReadonlyArray<{
  code: EditRejectionCode;
  reason: EditRejectionReason;
  blame: 'user' | 'system' | 'mixed';
}> = [
  // The user's request genuinely was the problem — the accusation is TRUE here.
  { code: 'MAX_OPERATIONS_EXCEEDED', reason: 'too_many_operations', blame: 'user' },
  { code: 'STRUCTURAL_VALIDATION_FAILED', reason: 'structural_validation', blame: 'user' },
  { code: 'PLOT_SEMANTIC_REJECTED', reason: 'structural_validation', blame: 'user' },
  // Outage — PROVABLY no usable answer from the analysis service. Narrow: only
  // a timeout or a 5xx reaches this code (see `classifyPlotFailureCode`).
  { code: 'PLOT_UNAVAILABLE', reason: 'service_unavailable', blame: 'system' },
  // ⭐ PLoT ANSWERED, or we never sent, or the cause is not established. The
  // rest of the old catch-all domain lives here, and it must claim NOTHING: a
  // 400/413/429 or a malformed 200 means the service was reached, so "I
  // couldn't reach the analysis service" would be false; a pre-fetch payload
  // error means it was never sent; an abort means we gave up, not PLoT.
  { code: 'PLOT_REQUEST_FAILED', reason: 'unknown_failure', blame: 'mixed' },
  // System-side failures: our own synthesis or reconciliation broke.
  { code: 'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS', reason: 'internal_failure', blame: 'system' },
  { code: 'SYNTHESIZED_GRAPH_INVALID', reason: 'internal_failure', blame: 'system' },
  { code: 'APPLIED_GRAPH_UNAVAILABLE', reason: 'internal_failure', blame: 'system' },
  // ⭐ MIXED, and the one code here with a dated live witness (staging 9a0541b,
  // 3 Aug 2026): the edit LLM invents an operation that does not survive
  // canonicalisation, on an under-specified user turn. Proximate cause ours,
  // distal cause the turn — so `internal_failure` both over-attributes AND
  // leads with the retry this repo's own 2.11 diagnosis calls a loop.
  { code: 'OPERATION_DID_NOT_LAND', reason: 'unknown_failure', blame: 'mixed' },
  // ⭐ MIXED — one code, two opposite causes. `encode-option-interventions.ts`
  // emits an unresolved id both when the USER'S value is rejected by the
  // canonical guards (`deriveValue`'s catch: unit mismatch / out-of-range /
  // ambiguous bare number) and when OUR side cannot proceed (target factor
  // unresolvable, no cap, ambiguous factor edges, encoder threw). No specific
  // copy is true across it, so it must attribute nothing.
  { code: 'OPTION_INTERVENTIONS_UNRESOLVABLE', reason: 'unknown_failure', blame: 'mixed' },
];

describe('edit_graph rejection copy — honest over the whole code domain', () => {
  it('PLOT_UNAVAILABLE maps to service_unavailable, NOT to structural_validation', () => {
    expect(mapCodeToRejectionReason('PLOT_UNAVAILABLE')).toBe('service_unavailable');
    expect(mapCodeToRejectionReason('PLOT_UNAVAILABLE')).not.toBe('structural_validation');
  });

  it('service_unavailable copy names the outage, states nothing changed, and offers a way forward', () => {
    const { assistantText, suggestedActions } = buildEditRejectionResponse('service_unavailable');
    // Exact sentence — identity, not a "contains the word analysis" predicate
    // that a dozen other strings would satisfy.
    expect(assistantText).toBe(SERVICE_UNAVAILABLE_COPY);
    // Property 1: does not attribute the failure to the user's input.
    expect(assistantText).not.toBe(STRUCTURAL_ACCUSATION);
    expect(assistantText).not.toMatch(/simpler terms/i);
    // Property 2: states the actual state of the world.
    expect(assistantText).toMatch(/nothing in your model has changed/);
    // Property 3: offers a route forward.
    expect(assistantText).toMatch(/Try again/);
    expect(suggestedActions.length).toBeGreaterThanOrEqual(1);
  });

  it('maps every rejection code to its exact reason (complete domain)', () => {
    for (const row of CODE_TABLE) {
      expect(mapCodeToRejectionReason(row.code), `code ${row.code}`).toBe(row.reason);
    }
  });

  it('the domain table matches EDIT_REJECTION_CODES exactly — not short, no dead rows', () => {
    // Union assertion in BOTH directions (CLAUDE.md trap 12d): derivation stops
    // this table drifting from the module, and the module's own compile-time
    // guard stops the module drifting from the call sites.
    const tableCodes = [...CODE_TABLE.map((r) => r.code)].sort();
    const exported = [...EDIT_REJECTION_CODES].sort();
    expect(tableCodes).toEqual(exported);
    expect(CODE_TABLE.length).toBe(10);
  });

  it('an absent code maps to unknown_failure, never to a specific accusation', () => {
    expect(mapCodeToRejectionReason(undefined)).toBe('unknown_failure');
    expect(mapCodeToRejectionReason(undefined)).not.toBe('structural_validation');
    const { assistantText } = buildEditRejectionResponse('unknown_failure');
    expect(assistantText).toBe(UNKNOWN_FAILURE_COPY);
    expect(assistantText).not.toBe(STRUCTURAL_ACCUSATION);
    expect(assistantText).toMatch(/nothing in your model has changed/);
  });

  it('a MIXED-cause code attributes blame in NEITHER direction', () => {
    // The narrow regression this pins: mapping a mixed domain to
    // `internal_failure` takes the blame for a guard that worked correctly (a
    // unit-mismatched value IS the user's), and prescribes "try again in a
    // moment", which is futile for that half. Mapping it to
    // `structural_validation` blames the user for the system-side half. Both
    // are false over part of the domain, so the copy must claim neither.
    for (const row of CODE_TABLE.filter((r) => r.blame === 'mixed')) {
      const reason = mapCodeToRejectionReason(row.code);
      expect(reason, `${row.code} must not blame the user`).not.toBe('structural_validation');
      expect(reason, `${row.code} must not blame our side`).not.toBe('internal_failure');
      const text = buildEditRejectionResponse(reason).assistantText;
      expect(text).not.toMatch(/on my side/i);
      expect(text).not.toMatch(/simpler terms/i);
      // It must still tell the truth about the model, and offer BOTH routes —
      // retry for the system half, rephrase for the user half.
      expect(text).toMatch(/nothing in your model has changed/);
      expect(text).toMatch(/Try again/);
      expect(text).toMatch(/describe the change a different way/);
    }
  });

  it('no failure the user did not cause inherits the structural-validation accusation', () => {
    for (const row of CODE_TABLE.filter((r) => r.blame !== 'user')) {
      const text = buildEditRejectionResponse(mapCodeToRejectionReason(row.code)).assistantText;
      expect(text, `code ${row.code} still blames the user`).not.toBe(STRUCTURAL_ACCUSATION);
      expect(text, `code ${row.code} still asks for simpler terms`).not.toMatch(/simpler terms/i);
      // ...and every one of them tells the truth about the state of the model.
      expect(text, `code ${row.code} omits the state of the world`).toMatch(
        /nothing in your model has changed/,
      );
    }
  });

  it('a failure the user DID cause keeps its accurate, specific copy', () => {
    // The mirror-direction twin: fixing the lie must not flatten the honest
    // arms into a generic apology. A code whose cause really is the user's
    // request must still get the specific, actionable sentence.
    expect(
      buildEditRejectionResponse(mapCodeToRejectionReason('STRUCTURAL_VALIDATION_FAILED'))
        .assistantText,
    ).toBe(STRUCTURAL_ACCUSATION);
    expect(mapCodeToRejectionReason('MAX_OPERATIONS_EXCEEDED')).toBe('too_many_operations');
  });

  it('internal_failure copy is honest about whose failure it was', () => {
    const { assistantText, suggestedActions } = buildEditRejectionResponse('internal_failure');
    expect(assistantText).toBe(INTERNAL_FAILURE_COPY);
    expect(suggestedActions.length).toBeGreaterThanOrEqual(1);
  });

  it('every new reason emits at least one chip and no chip sets action_type', () => {
    const newReasons: EditRejectionReason[] = [
      'service_unavailable',
      'internal_failure',
      'unknown_failure',
    ];
    for (const reason of newReasons) {
      const { suggestedActions } = buildEditRejectionResponse(reason);
      expect(suggestedActions.length, `reason ${reason}`).toBeGreaterThanOrEqual(1);
      for (const chip of suggestedActions) {
        expect(chip.action_type, `reason ${reason}`).toBeUndefined();
      }
    }
  });
});

/**
 * ⭐⭐ THE SENTENCE'S TRUTH CONDITION OVER ITS *WHOLE* THROWABLE DOMAIN.
 *
 * The suite above pins code → reason → copy. It is structurally blind to the
 * defect this block exists for, and the blindness is worth naming: its `blame`
 * column is the author's classification of a CODE, and no assertion there
 * enumerates the CAUSE CLASSES BEHIND ONE CODE. `PLOT_UNAVAILABLE` used to be
 * assigned in a bare `catch (plotError)` covering the outbound payload check,
 * the fetch, AND our own handling of a SUCCESSFUL response — so the product said
 * "I couldn't reach the analysis service" on a 400, a 413, a 429, a malformed
 * 200, a request that was never sent, and an abort. A per-code table cannot see
 * that; only a per-CAUSE table can.
 *
 * ⚠ THESE CASES ARE WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE
 * (CLAUDE.md trap 13d). The spec is: *the outage sentence may be shown ONLY
 * where no usable answer was provably received.* Each row therefore records
 * `reachedPlot` — what actually happened in the world — and the assertion is
 * derived from THAT, not from the code we happen to return.
 */
describe('PLoT failure classification — the outage sentence over its whole domain', () => {
  const OUTAGE_FIRST_CLAUSE = "I couldn't reach the analysis service";

  /**
   * The complete set of classes that can reach `catch (plotError)`, derived at
   * `plot-client.ts` (`PLoTError` carries an HTTP `status`; `PLoTTimeoutError`
   * is thrown when the client gives up; `throwPayloadError` throws a plain
   * `Error` BEFORE any fetch) and at PLoT staging `d37c8cfd`
   * (`validate-patch.ts` 400, `createServer.ts` 413 over a 128KB body limit,
   * `rate-limit.ts` 429).
   */
  const CAUSE_TABLE: ReadonlyArray<{
    label: string;
    error: unknown;
    /** Did PLoT receive the request AND answer it? The ground truth. */
    reachedPlot: boolean;
    /** May the product say "I couldn't reach the analysis service"? */
    mayClaimUnreachable: boolean;
  }> = [
    {
      label: 'client timed out waiting — no answer',
      error: new PLoTTimeoutError('PLoT validate_patch timed out', 'validate_patch', 5000, 5001),
      reachedPlot: false,
      mayClaimUnreachable: true,
    },
    {
      label: 'PLoT 503 — the service says it is down',
      error: new PLoTError('Service Unavailable', 503, 'validate_patch', 12, 'req-1'),
      reachedPlot: true,
      // The one deliberate charity: PLoT answered, but it answered that it is
      // broken, and `plot-client.ts`'s own `isRetryableError` defines >=500 as
      // the transient class. "The analysis service is unavailable" is true of
      // the SERVICE, and the retry advice is right.
      mayClaimUnreachable: true,
    },
    {
      label: 'PLoT 400 INVALID_REQUEST — reached and answered deterministically',
      error: new PLoTError('INVALID_REQUEST', 400, 'validate_patch', 12, 'req-1'),
      reachedPlot: true,
      mayClaimUnreachable: false,
    },
    {
      label: 'PLoT 413 BAD_INPUT — deterministic in the size of the user graph',
      error: new PLoTError('Request entity too large', 413, 'validate_patch', 12, 'req-1'),
      reachedPlot: true,
      mayClaimUnreachable: false,
    },
    {
      label: 'PLoT 429 RATE_LIMIT — reached and answered',
      error: new PLoTError('RATE_LIMIT', 429, 'validate_patch', 12, 'req-1'),
      reachedPlot: true,
      mayClaimUnreachable: false,
    },
    {
      label: 'INTERNAL_PAYLOAD_ERROR — thrown before any fetch, never sent',
      error: Object.assign(new Error('PLoT validate_patch outbound validation failed'), {
        orchestratorError: { code: 'INTERNAL_PAYLOAD_ERROR' },
      }),
      reachedPlot: false,
      // We never sent it. The service's reachability is UNKNOWN, and the cause
      // is our own bug — so a specific claim about the service would be false.
      mayClaimUnreachable: false,
    },
    {
      label: 'turn abort — the caller/budget went, PLoT was fine',
      error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
      reachedPlot: false,
      mayClaimUnreachable: false,
    },
    {
      label: 'bare network error — cause not provable from the class',
      error: new Error('fetch failed'),
      reachedPlot: false,
      // DELIBERATE UNDER-CLAIM. This one really is an outage, but the only way
      // to say so is to match message substrings, which is how this estate has
      // repeatedly shipped a predicate too wide. Neutral-and-true beats
      // specific-and-guessed; the copy still never blames the user.
      mayClaimUnreachable: false,
    },
    {
      label: 'our own post-response handling threw — PLoT answered 200',
      error: new TypeError("Cannot read properties of undefined (reading 'nodes')"),
      reachedPlot: true,
      mayClaimUnreachable: false,
    },
  ];

  it('never shows the outage sentence for a failure where PLoT answered', () => {
    // The headline invariant, bound to ground truth rather than to the code.
    for (const row of CAUSE_TABLE.filter((r) => r.reachedPlot && !r.mayClaimUnreachable)) {
      const code = classifyPlotFailureCode(row.error);
      const text = buildEditRejectionResponse(mapCodeToRejectionReason(code)).assistantText;
      expect(text, `${row.label}: PLoT answered, so this sentence is false`).not.toContain(
        OUTAGE_FIRST_CLAUSE,
      );
    }
  });

  it('classifies every cause class to copy that is true of it', () => {
    for (const row of CAUSE_TABLE) {
      const code = classifyPlotFailureCode(row.error);
      const text = buildEditRejectionResponse(mapCodeToRejectionReason(code)).assistantText;
      if (row.mayClaimUnreachable) {
        expect(text, row.label).toContain(OUTAGE_FIRST_CLAUSE);
      } else {
        expect(text, row.label).not.toContain(OUTAGE_FIRST_CLAUSE);
      }
    }
  });

  it('blames the user on NO cause class, and states the model is untouched on all of them', () => {
    // The guarantee that must hold across the entire domain regardless of how
    // the classifier splits it — this is the PR's actual deliverable.
    for (const row of CAUSE_TABLE) {
      const code = classifyPlotFailureCode(row.error);
      const text = buildEditRejectionResponse(mapCodeToRejectionReason(code)).assistantText;
      expect(text, `${row.label} blames the user`).not.toBe(STRUCTURAL_ACCUSATION);
      expect(text, `${row.label} asks for simpler terms`).not.toMatch(/simpler terms/i);
      expect(text, `${row.label} omits the state of the model`).toMatch(
        /nothing in your model has changed/,
      );
    }
  });

  it('the two buckets are BOTH non-empty — the split actually discriminates', () => {
    // A classifier that collapsed to one answer would satisfy every "must not
    // contain" assertion above by accident. This is the discrimination check:
    // without it, `return 'PLOT_REQUEST_FAILED'` for everything reads GREEN.
    const codes = CAUSE_TABLE.map((r) => classifyPlotFailureCode(r.error));
    expect(new Set(codes).size, 'classifier collapsed to a single code').toBe(2);
    expect(codes).toContain('PLOT_UNAVAILABLE');
    expect(codes).toContain('PLOT_REQUEST_FAILED');
  });

  it('binds the outage code to the timeout class by IDENTITY, not to any Error', () => {
    // The exact over-breadth the review found: the old code assigned
    // PLOT_UNAVAILABLE inside a bare catch, so ANY throwable produced the
    // outage sentence. A bare Error must NOT reach the outage code.
    expect(
      classifyPlotFailureCode(
        new PLoTTimeoutError('timed out', 'validate_patch', 5000, 5001),
      ),
    ).toBe('PLOT_UNAVAILABLE');
    expect(classifyPlotFailureCode(new Error('PLoT timeout'))).toBe('PLOT_REQUEST_FAILED');
    // ...and the 5xx/4xx boundary is the producer's own transience threshold.
    expect(classifyPlotFailureCode(new PLoTError('x', 500, 'validate_patch', 1))).toBe(
      'PLOT_UNAVAILABLE',
    );
    expect(classifyPlotFailureCode(new PLoTError('x', 499, 'validate_patch', 1))).toBe(
      'PLOT_REQUEST_FAILED',
    );
  });

  it('IGNORED-BY-DESIGN set is exactly the unprovable classes, and it does not grow silently', () => {
    // An honest record of the known gap (CLAUDE.md trap 22f): these classes get
    // neutral copy though a human could argue for something more specific. The
    // set is pinned so the suite REDs if it GROWS or SHRINKS.
    const neutral = CAUSE_TABLE.filter(
      (r) => classifyPlotFailureCode(r.error) === 'PLOT_REQUEST_FAILED',
    ).map((r) => r.label);
    expect(neutral.sort()).toEqual(
      [
        'PLoT 400 INVALID_REQUEST — reached and answered deterministically',
        'PLoT 413 BAD_INPUT — deterministic in the size of the user graph',
        'PLoT 429 RATE_LIMIT — reached and answered',
        'INTERNAL_PAYLOAD_ERROR — thrown before any fetch, never sent',
        'turn abort — the caller/budget went, PLoT was fine',
        'bare network error — cause not provable from the class',
        'our own post-response handling threw — PLoT answered 200',
      ].sort(),
    );
  });
});
