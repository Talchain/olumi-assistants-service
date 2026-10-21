/**
 * edit_graph rejection codes — the PLoT failure classifier stays honest over its
 * WHOLE throwable domain.
 *
 * ⚠ 21 Oct 2026 — the host-written rejection copy
 * (`orchestrator-v5/handlers/edit-rejection-text.ts`) and the code → reason map
 * (`mapCodeToRejectionReason`) were retired as caller-less. Their copy rows went
 * with them. What stays asserts LIVE code in `orchestrator/tools/edit-graph.ts`:
 * the exported code set, and `classifyPlotFailureCode`. The copy claims are
 * restated at the classifier, where they are decided: the outage sentence was
 * reachable ONLY from `PLOT_UNAVAILABLE`, and the user was blamed ONLY by the
 * user-cause codes below.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPlotFailureCode,
  EDIT_REJECTION_CODES,
  type EditRejectionCode,
} from '../../../../src/orchestrator/tools/edit-graph.js';
import { PLoTError, PLoTTimeoutError } from '../../../../src/orchestrator/plot-client.js';

/**
 * THE COMPLETE DOMAIN, derived by reading every `buildRejectionResult` call
 * site at CEE staging d0544243, with WHOSE failure each code is.
 */
const CODE_TABLE: ReadonlyArray<{ code: EditRejectionCode; blame: 'user' | 'system' | 'mixed' }> = [
  { code: 'MAX_OPERATIONS_EXCEEDED', blame: 'user' },
  { code: 'STRUCTURAL_VALIDATION_FAILED', blame: 'user' },
  { code: 'PLOT_SEMANTIC_REJECTED', blame: 'user' },
  { code: 'PLOT_UNAVAILABLE', blame: 'system' },
  { code: 'PLOT_REQUEST_FAILED', blame: 'mixed' },
  { code: 'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS', blame: 'system' },
  { code: 'SYNTHESIZED_GRAPH_INVALID', blame: 'system' },
  { code: 'APPLIED_GRAPH_UNAVAILABLE', blame: 'system' },
  { code: 'OPERATION_DID_NOT_LAND', blame: 'mixed' },
  { code: 'OPTION_INTERVENTIONS_UNRESOLVABLE', blame: 'mixed' },
];

const USER_BLAME_CODES = new Set(CODE_TABLE.filter((r) => r.blame === 'user').map((r) => r.code));

describe('edit_graph rejection codes — the domain', () => {
  it('the domain table matches EDIT_REJECTION_CODES exactly — not short, no dead rows', () => {
    const tableCodes = [...CODE_TABLE.map((r) => r.code)].sort();
    const exported = [...EDIT_REJECTION_CODES].sort();
    expect(tableCodes).toEqual(exported);
    expect(CODE_TABLE.length).toBe(10);
  });
});

/**
 * ⭐⭐ THE SENTENCE'S TRUTH CONDITION OVER ITS *WHOLE* THROWABLE DOMAIN.
 *
 * The table above pins the code domain. It is structurally blind to the
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
  /** The only code whose (retired) copy carried that sentence. */
  const OUTAGE_CODE: EditRejectionCode = 'PLOT_UNAVAILABLE';

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

  it('never takes the outage code for a failure where PLoT answered', () => {
    // The headline invariant, bound to ground truth rather than to the code.
    for (const row of CAUSE_TABLE.filter((r) => r.reachedPlot && !r.mayClaimUnreachable)) {
      const code = classifyPlotFailureCode(row.error);
      expect(code, `${row.label}: PLoT answered, so "${OUTAGE_FIRST_CLAUSE}" is false`).not.toBe(
        OUTAGE_CODE,
      );
    }
  });

  it('classifies every cause class to a code that is true of it', () => {
    for (const row of CAUSE_TABLE) {
      const code = classifyPlotFailureCode(row.error);
      if (row.mayClaimUnreachable) {
        expect(code, row.label).toBe(OUTAGE_CODE);
      } else {
        expect(code, row.label).not.toBe(OUTAGE_CODE);
      }
    }
  });

  it('blames the user on NO cause class', () => {
    // The guarantee that must hold across the entire domain regardless of how
    // the classifier splits it — this is the PR's actual deliverable.
    expect(USER_BLAME_CODES.size).toBe(3); // positive control: the set is not empty
    for (const row of CAUSE_TABLE) {
      const code = classifyPlotFailureCode(row.error);
      expect(USER_BLAME_CODES.has(code), `${row.label} classified to user-blame code ${code}`).toBe(false);
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
