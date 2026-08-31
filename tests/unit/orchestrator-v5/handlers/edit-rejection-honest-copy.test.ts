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
  EDIT_REJECTION_CODES,
  type EditRejectionCode,
} from '../../../../src/orchestrator/tools/edit-graph.js';

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
  // Outage — the analysis service could not be reached at all.
  { code: 'PLOT_UNAVAILABLE', reason: 'service_unavailable', blame: 'system' },
  // System-side failures: our own synthesis or reconciliation broke.
  { code: 'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS', reason: 'internal_failure', blame: 'system' },
  { code: 'SYNTHESIZED_GRAPH_INVALID', reason: 'internal_failure', blame: 'system' },
  { code: 'APPLIED_GRAPH_UNAVAILABLE', reason: 'internal_failure', blame: 'system' },
  { code: 'OPERATION_DID_NOT_LAND', reason: 'internal_failure', blame: 'system' },
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
    expect(CODE_TABLE.length).toBe(9);
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
