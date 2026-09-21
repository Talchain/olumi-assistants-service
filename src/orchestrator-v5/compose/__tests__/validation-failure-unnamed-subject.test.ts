/**
 * ⭐ A REFUSAL MAY NOT DESCRIBE A MESSAGE IT NEVER READ.
 *
 * Bound to a real session, not to an imagined one. 3 Sep 2026, deployed CEE
 * `f4c8f50` / UI `86786efb`, bundle
 * `olumi-programme-docs artefacts/manual-test-2026-09-03/olumi-debug-f2e2df1b-20260903.json`:
 *
 *   14:01:16Z  user  "Why are all of the outcome and risk strengths 50%?"
 *                    (50 characters — the `user_actions` entry's own
 *                     `message_length`, which is how this turn is identified)
 *   turn 2     CEE   "I wasn't sure what you meant by that item.
 *                     Did you mean one of these?"
 *
 * The user named no item and was perfectly clear. The product told them
 * otherwise and offered four things to disambiguate between. They re-asked at
 * 14:02:01Z and again at 14:03:02Z before getting an answer.
 *
 * This is the same defect class CEE #1315 closed for the structure-answer
 * composer — a refusal whose VERDICT is correct and whose WORDS diagnose a
 * comprehension failure that did not happen — reached through a different
 * composer, which is why closing #1315's instance did not close this one.
 * Enumerated rather than instance-fixed: both sentence sites in this module
 * that interpolate an unnameable subject are covered below.
 *
 * Every case here binds by IDENTITY — exact assistant text, exact template id
 * — never by a substring another sentence could satisfy (trap 19). And every
 * unnamed case is paired with its NAMED twin, so a fix that closed the false
 * sentence by flattening the true one would RED (trap 22b).
 */

import { describe, expect, it } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import type { ComposeContext } from '../types.js';
import type { GraphLookup, HandlerValidationRegistry, ValidationError } from '../../routing/validator.js';

const REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};

/** The three options carried by the capture's model, so the chip arm fires. */
const CAPTURE_OPTIONS = [
  { id: '94b13741', label: 'Continue With Founder-Led Sales', kind: 'option' },
  { id: 'a1', label: 'Hire a Dedicated Sales Team', kind: 'option' },
  { id: 'a2', label: 'Part-Time SDR', kind: 'option' },
];

function graphWith(entities: Array<{ id: string; label: string; kind: string }>): GraphLookup {
  return {
    findEntityById(id) {
      const m = entities.find((e) => e.id === id);
      return m ? { id: m.id, kind: m.kind as never, label: m.label } : null;
    },
    listEntitiesByKind(kind) {
      return entities.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.label }));
    },
  };
}

const CTX_WITH_GRAPH: ComposeContext = {
  handlerRegistry: REGISTRY,
  graph: graphWith(CAPTURE_OPTIONS),
};

function composeFor(error: ValidationError, ctx: ComposeContext) {
  return composeValidationFailure(error, ctx, 'analyse');
}

describe('ENTITY_KIND_MISMATCH with siblings — the exact shape the capture hit', () => {
  it('no longer tells the user they were unclear about an item they never named', () => {
    const { response, template_id } = composeFor(
      {
        code: 'ENTITY_KIND_MISMATCH',
        message: 'mismatch',
        details: { proposed_kind: 'node', accepted_kinds: ['option'] },
      },
      CTX_WITH_GRAPH,
    );

    expect(template_id).toBe('kind_mismatch_with_siblings');
    // The sentence the capture recorded, gone by identity.
    expect(response.assistant_text).not.toBe(
      "I wasn't sure what you meant by that item. Did you mean one of these?",
    );
    expect(response.assistant_text).toBe(
      "I couldn't match that to anything in your model. Did you mean one of these?",
    );
    // The affordance is unchanged: the user still gets the options to pick from.
    expect(response.suggested_actions.map((a) => a.label)).toEqual([
      'Continue With Founder-Led Sales',
      'Hire a Dedicated Sales Team',
      'Part-Time SDR',
    ]);
  });

  it('NAMED twin: a subject we can quote still gets the informative sentence', () => {
    const { response, template_id } = composeFor(
      {
        code: 'ENTITY_KIND_MISMATCH',
        message: 'mismatch',
        details: {
          proposed_kind: 'node',
          proposed_label: 'Runway Depletion Risk',
          accepted_kinds: ['option'],
        },
      },
      CTX_WITH_GRAPH,
    );
    expect(template_id).toBe('kind_mismatch_with_siblings');
    expect(response.assistant_text).toBe(
      "I wasn't sure what you meant by Runway Depletion Risk. Did you mean one of these?",
    );
  });

  it('an ID-SHAPED label is unnameable too, and must not fall back to the false sentence', () => {
    // `safeLabel` rejects id-shaped strings so an id can never reach the user.
    // That rejection lands on the SAME fallback as "no label at all", so the
    // honesty fix has to cover it — a target we refuse to quote is still a
    // target we cannot name.
    const { response } = composeFor(
      {
        code: 'ENTITY_KIND_MISMATCH',
        message: 'mismatch',
        details: {
          proposed_kind: 'node',
          proposed_label: '9f2c1d4e-1111-4222-8333-444455556666',
          accepted_kinds: ['option'],
        },
      },
      CTX_WITH_GRAPH,
    );
    expect(response.assistant_text).toBe(
      "I couldn't match that to anything in your model. Did you mean one of these?",
    );
    expect(response.assistant_text).not.toContain('9f2c1d4e');
  });

  it('RESOLVED but unnameable says we cannot make the change, not that we found nothing', () => {
    // Two questions under one fallback. When the graph DID resolve the target,
    // "I couldn't match that to anything" would be false — so the unnamed arm
    // splits rather than sharing one sentence.
    const { response, template_id } = composeFor(
      {
        code: 'ENTITY_KIND_MISMATCH',
        message: 'mismatch',
        details: { proposed_kind: 'node', resolved_kind: 'goal', accepted_kinds: ['option'] },
      },
      CTX_WITH_GRAPH,
    );
    expect(template_id).toBe('kind_mismatch_resolved_with_siblings');
    expect(response.assistant_text).toBe(
      "I found what that change was aimed at, but I can't make that change to it. Did you mean one of these?",
    );
  });
});

describe('ENTITY_NOT_FOUND — the sibling site of the same class', () => {
  it('an unnameable target is not reported as an "item" the user named', () => {
    const { response, template_id } = composeFor(
      { code: 'ENTITY_NOT_FOUND', message: 'not found', details: {} },
      CTX_WITH_GRAPH,
    );
    expect(template_id).toBe('entity_not_found_no_siblings');
    expect(response.assistant_text).not.toBe("I can't find that item in your model.");
    expect(response.assistant_text).toBe("I couldn't match that to anything in your model.");
  });

  it('NAMED twin: a quotable label keeps the specific, useful sentence', () => {
    const { response, template_id } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: 'not found',
        details: { entity_kind: 'option', entity_label: 'Outsourced Closer' },
      },
      CTX_WITH_GRAPH,
    );
    expect(template_id).toBe('entity_not_found_with_siblings');
    expect(response.assistant_text).toBe(
      "I can't find Outsourced Closer in your model. Did you mean one of these?",
    );
  });

  it('KIND-ONLY twin: a known kind is still nameable and must NOT degrade', () => {
    // The middle rung of `safeLabel`. "that option" quotes a category the
    // payload really carries, so it stays — the honesty fix must fire on the
    // BARE fallback only, or it would strip real information from a working
    // path. This is the discriminating case for `isUnnamedSubject`.
    const { response } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: 'not found',
        details: { entity_kind: 'option' },
      },
      CTX_WITH_GRAPH,
    );
    expect(response.assistant_text).toBe(
      "I can't find that option in your model. Did you mean one of these?",
    );
  });
});
