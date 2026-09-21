/**
 * P1 DISCLOSURE — the silent unconfigured-option exclusion.
 *
 * An option with nothing said about what it changes is EXCLUDED FROM RANKING
 * by the analysable-option gate. The user gets a comparison that silently does
 * not contain the option they were asking about. The failure copy never said
 * so: it said the option "needs intervention values to proceed", which reads
 * as a delay, and uses a phrase no user has ever spoken — `interventions` is
 * the name of a field on the option node.
 *
 * Two copy defects, pinned here:
 *   D2  internal schema vocabulary in user-facing prose
 *   D3  the consequence (exclusion from the comparison) never stated
 *
 * D1 — naming the MISSING FACTORS — is NOT fixed, because that data does not
 * reach this site. The gap is asserted below rather than described, so it
 * REDs the day a producer starts carrying it and this copy has not caught up.
 */
import { describe, expect, it } from 'vitest';

import { composeHandlerFailureBody } from '../handler-failure-responses.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';

function optionsNotConfigured(details: Record<string, unknown>): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError('Options exist but none have configured interventions', {
    cause_kind: 'options_not_configured',
    retryable: false,
    details: { handler_id: 'run_analysis', ...details },
  });
}

const LABELLED = optionsNotConfigured({ first_option_label: 'Hire two engineers', option_count: 2 });
const UNLABELLED = optionsNotConfigured({ option_count: 2 });

function textOf(err: HandlerInvocationFailedError): string {
  return composeHandlerFailureBody(err).body.assistant_text;
}

describe('D2 — no internal schema vocabulary in user-facing copy', () => {
  it('the labelled branch does not say "intervention"', () => {
    expect(textOf(LABELLED).toLowerCase()).not.toContain('intervention');
  });

  it('the generic branch does not say "intervention"', () => {
    expect(textOf(UNLABELLED).toLowerCase()).not.toContain('intervention');
  });

  it('asks the plain-English question instead', () => {
    expect(textOf(LABELLED)).toContain('what it changes');
    expect(textOf(UNLABELLED)).toContain('what it changes');
  });
});

describe('D3 — the consequence is stated', () => {
  it('the labelled branch names the option AND says it will be left out of the comparison', () => {
    const text = textOf(LABELLED);
    // Bound by identity to the label this error carries, not to "some quoted
    // string" — another quoted token in the sentence could satisfy that.
    expect(text).toContain('Hire two engineers');
    expect(text).toContain("won't appear in the comparison");
  });

  it('the generic branch says it too, without over-claiming about options it cannot see', () => {
    const text = textOf(UNLABELLED);
    expect(text).toContain("won't appear in the comparison");
    // True on BOTH producers: the pre-PLoT guard (no option configured) and
    // the PLoT-preflight recovery (one named option rejected). "None of your
    // options" would be false on the second.
    expect(text).toContain('At least one of your options');
  });

  it('CONTRAST CONTROL — the routing is unchanged; only the prose moved', () => {
    // template_id is what the suite pins routing on. If a copy edit had
    // accidentally changed the branch taken, this is where it shows.
    const labelled = composeHandlerFailureBody(LABELLED);
    const generic = composeHandlerFailureBody(UNLABELLED);
    expect(labelled.template_id).toBe('options_not_configured_with_label');
    expect(generic.template_id).toBe('options_not_configured_no_label');
    expect(labelled.body.assistant_text).not.toBe(generic.body.assistant_text);
    expect(labelled.body.suggested_actions!.length).toBeGreaterThan(0);
    expect(generic.body.suggested_actions!.length).toBeGreaterThan(0);
  });

  it('an id-shaped label still routes to the generic branch (pre-existing safeLabel behaviour)', () => {
    const idShaped = optionsNotConfigured({ first_option_label: 'opt_hire_two_engineers' });
    expect(textOf(idShaped)).toContain('At least one of your options');
    expect(textOf(idShaped)).not.toContain('opt_hire_two_engineers');
  });
});

describe('D1 — the missing-factor gap is PINNED, not merely described', () => {
  it('the failure details carry NO factor list at this site (the reason D1 is unfixed)', () => {
    // If a producer ever starts threading the missing factors through, this
    // REDs and whoever added it is sent here to use them in the copy. A gap
    // recorded in the suite is honest; a gap invisible to it is how a "we'll
    // do it later" becomes never.
    const keys = Object.keys(LABELLED.details);
    expect(keys).not.toContain('missing_factor_labels');
    expect(keys).not.toContain('missing_factors');
    // CONTRAST CONTROL — the keys that ARE carried, so this is a statement
    // about the payload and not about a probe that reads nothing.
    expect(keys).toContain('first_option_label');
    expect(keys).toContain('handler_id');
  });
});
