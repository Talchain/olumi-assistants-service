/**
 * THE PRECISE REFUSAL MUST SURVIVE THE ERROR BOUNDARY — WHOLE.
 *
 * `evaluateFactorValueProposal` authors eleven specific refusal sentences. The
 * handler threw with the matching one as the error's message AND a generic
 * `userGuidance` phrase. `error-boundary.ts` builds details as:
 *
 *     ...(err.userGuidance ? { specific_issue: err.userGuidance } : {}),
 *     ...(err.details ?? {}),
 *
 * `details` is spread second and wins — but the throw site never set the key,
 * so `specific_issue` became the GENERIC phrase and the composer served that
 * whole. The precise sentence never left the logs. It was not truncated; it was
 * REPLACED, one step before any length rule applies.
 *
 * ⚠ TWO DEFECTS, AND FIXING ONE ALONE MAKES THINGS WORSE. The moment the
 * precise sentence reaches the composer it is rendered through
 * `sanitiseForUser`, whose 100-character budget had never applied to these
 * strings. Three were over it — one at 109 characters with ZERO interpolations,
 * i.e. cut mid-word for every input. Recovering a sentence and truncating it in
 * the same change is not a fix, so the copy is shortened here too.
 *
 * ⚠ WHY THIS SPEC DRIVES THE WHOLE CHAIN. A spec that constructs the error and
 * calls the composer CANNOT see the overwrite: it happens in the boundary,
 * between the throw and the compose. Two specs in this estate missed exactly
 * this class that way. This one runs the REAL handler through `runD1Handler`
 * and asserts on the COMPOSED `assistant_text`, where the user reads.
 *
 * No expectation re-types product copy. Each case takes the sentence the
 * product produced and requires THAT string to appear whole, so a copy change
 * cannot leave this spec green against a stale sentence.
 */

import { describe, expect, it } from 'vitest';

import { composeHandlerFailure } from '../../../compose/handler-failure-responses.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import { evaluateFactorValueProposal } from '../d1-shared/evaluate-factor-value-proposal.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { SET_FACTOR_VALUE_USER_GUIDANCE } from '../d1-shared/user-guidance.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { ComposeContext, StageType } from '../../../compose/types.js';

/** The composer's own budget. Named here so the pin moves if the budget moves. */
const COMPOSER_BUDGET = 100;

function proposalFor(value: unknown, operator: 'set' | 'increase' = 'set'): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-quality', // { value: 0.7 } — no cap, no unit
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator, source: 'user_explicit' }],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

async function captureFailure(proposal: ProposalAction): Promise<HandlerInvocationFailedError> {
  try {
    await createSetFactorValueHandler()(
      buildHandlerInvocation({ proposal, graph: buildD1Fixture() }),
    );
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) return err;
    throw err;
  }
  throw new Error('expected the handler to refuse, but it returned an outcome');
}

/** Compose exactly as the turn does; return what the user would read. */
function userText(err: HandlerInvocationFailedError): string {
  return (
    composeHandlerFailure(err, {} as unknown as ComposeContext, 'act' as unknown as StageType)
      .response.assistant_text ?? ''
  );
}

/**
 * The assertion that catches BOTH defects, spelling no copy.
 *  - overwrite: the carried sentence would equal the generic guidance
 *  - truncation: the carried sentence would not appear whole in the output
 */
function expectPreciseAndWhole(err: HandlerInvocationFailedError, expectedReason: string): string {
  const details = err.details as Record<string, unknown>;
  expect(details.rejection_reason).toBe(expectedReason);

  const carried = details.specific_issue;
  expect(typeof carried).toBe('string');
  const sentence = carried as string;

  // NOT the generic phrase — this is what fails when the boundary overwrites.
  expect(sentence).not.toBe(SET_FACTOR_VALUE_USER_GUIDANCE);

  // Within the composer's budget, so it CAN survive. This is the regression pin
  // against re-lengthening the copy: a future edit past the budget fails here
  // rather than shipping a sentence the user reads half of.
  expect(sentence.length).toBeLessThanOrEqual(COMPOSER_BUDGET);

  const text = userText(err);
  expect(text).toContain(sentence); // WHOLE — fails on any truncation
  expect(text).not.toMatch(/\.\.\.$/); // no truncation marker
  return text;
}

describe('the precise refusal survives the error boundary, whole', () => {
  it('unit_redeclares_scale', async () => {
    const err = await captureFailure(proposalFor({ value: 0.9, unit: '%' }));
    const text = expectPreciseAndWhole(err, 'unit_redeclares_scale');
    expect(text).toContain('no unit recorded');
  });

  it('cap_redeclares_scale — the 109-char sentence that truncated for EVERY input', async () => {
    const err = await captureFailure(proposalFor({ value: 1.5, cap: 2 }));
    const text = expectPreciseAndWhole(err, 'cap_redeclares_scale');
    // The end of the sentence must be present: this is the byte the old copy lost.
    expect(text).toContain('rescale it.');
  });

  it('a redeclaring unit on a DELTA operator takes the same path', async () => {
    const err = await captureFailure(proposalFor({ value: 0.1, unit: 'x' }, 'increase'));
    expectPreciseAndWhole(err, 'unit_redeclares_scale');
  });

  it('a LONG unit does not truncate — the case a currency fixture hides', async () => {
    // "engineers" is 9 chars; the old 94-char skeleton went over at 7+.
    const err = await captureFailure(proposalFor({ value: 0.9, unit: 'engineers' }));
    const text = expectPreciseAndWhole(err, 'unit_redeclares_scale');
    expect(text).toContain('engineers');
    expect(text).toContain('what it measures.');
  });

  it('a DELTA overshooting the cap renders a clean number, not a float artifact', () => {
    // Driven at the predicate, because no fixture node carries a cap WITHOUT a
    // unit and `bare_number_outside_cap` requires exactly that combination.
    // (An earlier draft of this spec used a node id the fixture does not have;
    // it passed while exercising nothing, which is why the reason is asserted.)
    //
    // 0.7 + 0.6 is 1.2999999999999998 in IEEE754. Before formatting, that is
    // 18 characters of noise interpolated straight into user copy.
    const r = evaluateFactorValueProposal({
      rawInput: 0.6,
      operator: 'increase',
      factorExistingRaw: 0.7,
      factorCap: 1,
      inputHasUnit: false,
    } as unknown as Parameters<typeof evaluateFactorValueProposal>[0]);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bare_number_outside_cap'); // the path under test, asserted

    // The artifact must not reach the user.
    expect(r.specific_issue).not.toMatch(/\d\.\d{6,}/);
    expect(r.specific_issue).toContain('1.3');
    // And it still fits the composer's budget, so it arrives whole.
    expect(r.specific_issue.length).toBeLessThanOrEqual(COMPOSER_BUDGET);
  });

  it('the generic fallback still applies where no specific sentence exists', () => {
    // A throw carrying only the guidance must keep it — the fix must not empty
    // the fallback for the throw sites that do not supply a precise sentence.
    const bare = new HandlerInvocationFailedError('internal detail nobody should read', {
      cause_kind: 'parameter_invalid_at_execute',
      retryable: false,
      details: { handler_id: 'set_factor_value', specific_issue: SET_FACTOR_VALUE_USER_GUIDANCE },
    } as unknown as ConstructorParameters<typeof HandlerInvocationFailedError>[1]);

    const text = userText(bare);
    expect(text).toContain(SET_FACTOR_VALUE_USER_GUIDANCE);
    expect(text).not.toContain('internal detail nobody should read');
  });
});
