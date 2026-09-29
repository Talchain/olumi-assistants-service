/**
 * ⭐⭐ OFFER SUFFICIENCY — DO NOT MINT A CHIP THE RESUMER MUST REFUSE.
 *
 * ── THE WITNESS (CEE staging `8e4efce0`, reported 2026-09-14) ─────────────
 * A user stated a churn limit, was offered "Add this limit", said so again,
 * and was offered "Add this limit" a SECOND time. "do it" then produced
 * "I have more than one change waiting for your go-ahead... 1) Add this limit
 * 2) Add this limit" with the graph hash UNCHANGED: two identical strings and
 * no way to choose between them.
 *
 * ── WHY THERE WERE TWO, DERIVED AT THE BYTES ──────────────────────────────
 * The `prop_<hex>` handle is NOT content-derived (`CHIP_COPY` is a per-intent
 * CONSTANT, so the copy cannot vary). `computeProposalId` hashes
 * `{scenario_id, intent, params, graph_hash, target_entity_ids}`, and
 * `preconditions.graph_hash` is that same hash, so a proposal minted at a
 * MOVED graph is dropped by the carry-forward's hash rule. Two survivors at
 * one graph hash therefore differ in `params` — and nothing else can make
 * them differ.
 *
 * The reported second offer described its bound as "at or below THAT LEVEL".
 * `formatBound` returns exactly that string, and only that string, when the
 * value is not a finite number. So the second proposal carried NO USABLE
 * `value` — which is why it had different `params`, a different id, and could
 * never have been applied: `add_constraint` throws PARAMETER_INVALID without
 * one (`tools/handlers/add-constraint.ts`, "add_constraint requires a
 * \"value\" parameter.").
 *
 * `validateToolCall` cannot catch this. Its own comment says so
 * (`routing/validator.ts`): the loop iterates the parameters that ARE
 * present and "required-parameter enforcement" is explicitly deferred. So a
 * value-less proposal passes validation, mints a chip, persists a pending,
 * and fails at apply time.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * The same rule the demotion gate already carries TWICE — the
 * registry-executable precondition ("a chip would promise a change the
 * resumer could never honour") and the target-kind precondition. This is the
 * third sibling, and it asks the remaining question: are the PARAMETERS ones
 * the handler accepts?
 *
 * ⚠ IT IS NOT A SUPERSEDE RULE, DELIBERATELY. Superseding would have to
 * choose between two live consent-expecting pendings, and the consent
 * doctrine forbids that. This gate only removes offers the resumer MUST
 * refuse, so it cannot collapse two genuinely different proposals — the
 * negative control below holds by construction, not by tuning.
 *
 * ── THE ORACLE IS THE HANDLER, NEVER THIS FILE ────────────────────────────
 * `offer-sufficiency-handler-biconditional.test.ts` pins the required-
 * parameter table against the REAL handlers by executing them, in BOTH
 * directions. This file pins the offer path's behaviour.
 */
import { describe, it, expect } from 'vitest';

import {
  buildWarrantDemotion,
  findInsufficientOfferParameters,
  buildIncompleteOfferRefusalText,
  OFFER_REQUIRED_PARAMETERS,
} from '../warrant-demotion.js';
import { tryShortConfirmResume } from '../../routing/deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { ProposalAction } from '../../routing/types.js';

function action(
  handlerId: string,
  parameters: readonly { name: string; value: unknown }[],
  entity?: Partial<{ id: string; kind: string; label: string }>,
): ProposalAction {
  return {
    handler_id: handlerId,
    entity: {
      id: entity?.id ?? 'f-churn',
      kind: entity?.kind ?? 'node',
      label: entity?.label ?? 'Churn Rate',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: parameters.map((p) => ({ ...p, source: 'user_explicit' })),
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

describe('offer sufficiency — the gate', () => {
  it('REFUSES to offer an add_constraint whose value is ABSENT (the witnessed second proposal)', () => {
    const built = buildWarrantDemotion(
      action('add_constraint', [{ name: 'constraint_type', value: 'at_most' }]),
      [],
    );
    expect(built.ok).toBe(false);
    if (built.ok || built.reason !== 'required_parameter_missing') {
      throw new Error(`expected required_parameter_missing, got ${JSON.stringify(built)}`);
    }
    expect(built.parameterName).toBe('value');
  });

  it('REFUSES to offer an add_constraint whose value is present but NOT A FINITE NUMBER', () => {
    // `formatBound` renders both of these as "that level"; the handler
    // refuses both. Absence and unusability are one class here.
    for (const bad of ['seven', null, {}, Number.POSITIVE_INFINITY, Number.NaN]) {
      const built = buildWarrantDemotion(
        action('add_constraint', [
          { name: 'constraint_type', value: 'at_most' },
          { name: 'value', value: bad },
        ]),
        [],
      );
      expect(built.ok, `value=${String(bad)}`).toBe(false);
    }
  });

  it('REFUSES to offer an add_constraint whose constraint_type is absent or not an accepted kind', () => {
    for (const params of [
      [{ name: 'value', value: 7 }],
      [
        { name: 'constraint_type', value: 'threshold' },
        { name: 'value', value: 7 },
      ],
    ]) {
      const built = buildWarrantDemotion(action('add_constraint', params), []);
      expect(built.ok).toBe(false);
      if (built.ok || built.reason !== 'required_parameter_missing') {
        throw new Error(`expected required_parameter_missing, got ${JSON.stringify(built)}`);
      }
      expect(built.parameterName).toBe('constraint_type');
    }
  });

  it('REFUSES to offer a set_factor_value with no value, and an adjust_edge_strength with no strength', () => {
    const noValue = buildWarrantDemotion(action('set_factor_value', []), []);
    expect(noValue.ok).toBe(false);
    if (noValue.ok || noValue.reason !== 'required_parameter_missing') {
      throw new Error(`expected required_parameter_missing, got ${JSON.stringify(noValue)}`);
    }
    expect(noValue.parameterName).toBe('value');

    const noStrength = buildWarrantDemotion(
      action('adjust_edge_strength', [], { id: 'a→b', kind: 'edge' }),
      [],
    );
    expect(noStrength.ok).toBe(false);
    if (noStrength.ok || noStrength.reason !== 'required_parameter_missing') {
      throw new Error(`expected required_parameter_missing, got ${JSON.stringify(noStrength)}`);
    }
    expect(noStrength.parameterName).toBe('strength');
  });

  it('REFUSES an adjust_edge_strength whose strength is outside the range the handler accepts', () => {
    const built = buildWarrantDemotion(
      action('adjust_edge_strength', [{ name: 'strength', value: 30 }], {
        id: 'a→b',
        kind: 'edge',
      }),
      [],
    );
    expect(built.ok).toBe(false);
  });
});

describe('offer sufficiency — the NEGATIVE CONTROL (a fix that suppresses real offers is worse than the defect)', () => {
  it('STILL offers a complete add_constraint, unchanged, with its params intact', () => {
    const built = buildWarrantDemotion(
      action('add_constraint', [
        { name: 'constraint_type', value: 'at_most' },
        { name: 'value', value: 7 },
        { name: 'unit', value: '%' },
      ]),
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(built.changeDescription).toBe('a limit keeping "Churn Rate" at or below 7%');
    expect(built.proposal.params).toEqual({
      constraint_type: 'at_most',
      value: 7,
      unit: '%',
    });
  });

  it('STILL offers when only the OPTIONAL parameters are missing', () => {
    // `label` and `unit` are optional at the handler; a proposal without them
    // is complete. Requiring them would suppress legitimate offers.
    const built = buildWarrantDemotion(
      action('add_constraint', [
        { name: 'constraint_type', value: 'at_most' },
        { name: 'value', value: 7 },
      ]),
      [],
    );
    expect(built.ok).toBe(true);
  });

  it('STILL offers a complete set_factor_value and adjust_edge_strength', () => {
    expect(
      buildWarrantDemotion(action('set_factor_value', [{ name: 'value', value: 0.4 }]), []).ok,
    ).toBe(true);
    expect(
      buildWarrantDemotion(
        action('adjust_edge_strength', [{ name: 'strength', value: 0.7 }], {
          id: 'a→b',
          kind: 'edge',
        }),
        [],
      ).ok,
    ).toBe(true);
  });

  it('STILL offers a set_factor_value carrying the STRUCTURED value object the round-trip produces', () => {
    const built = buildWarrantDemotion(
      action('set_factor_value', [{ name: 'value', value: { value: 7, unit: '%' } }]),
      [],
    );
    expect(built.ok).toBe(true);
  });

  it('leaves the not-a-proposable-mutation refusal reason untouched', () => {
    const built = buildWarrantDemotion(action('add_factor', [{ name: 'label', value: 'x' }]), []);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('unreachable');
    expect(built.reason).toBe('not_a_proposable_mutation');
  });
});

describe('offer sufficiency — the refusal copy is honest AND executable', () => {
  it('discloses that nothing changed, does not promise the change, and asks for the missing thing', () => {
    const text = buildIncompleteOfferRefusalText('value', 'Churn Rate');
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    // ⛔ The generic demotion copy ends "Say the word and I will make it." —
    // a promise with NO chip behind it. This branch must never borrow it.
    expect(text).not.toContain('Say the word');
    // The move it names must be one the user can actually make.
    expect(text).toContain("Tell me the number you want and I'll set it.");
    expect(text).toContain('"Churn Rate"');
  });

  it('names the missing parameter in the USER\'s words, never the schema key', () => {
    for (const name of ['value', 'constraint_type', 'strength']) {
      const text = buildIncompleteOfferRefusalText(name, 'Churn Rate');
      expect(text, name).not.toContain(name);
    }
  });

  it('degrades safely when the entity has no label', () => {
    const text = buildIncompleteOfferRefusalText('value', undefined);
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    expect(text).toContain('that part of the model');
  });
});

/**
 * ⛔ THE CONSENT DOCTRINE MUST SURVIVE THIS CHANGE UNTOUCHED.
 *
 * A fix that collapsed two genuinely different proposals would be far worse
 * than the defect: the product would silently pick one of two changes the
 * user can tell apart. The consent-clarity amendment (Paul, 2026-07-11)
 * forbids exactly that.
 *
 * This gate cannot do it — it only ever declines to MINT an offer the resumer
 * must refuse, and never touches a live pending — but "cannot by
 * construction" is an argument, and an argument is not a guard. So the
 * property is asserted directly, against the real resumer.
 */
function livePending(chipId: string, params: Record<string, unknown>): PendingAction {
  return {
    id: `pa-${chipId}`,
    scenario_id: 'scn',
    chip_id: chipId,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: chipId,
      inline_patch: { handler_id: 'add_constraint', params, target_entity_ids: ['f-churn'] },
      public_label: 'Add this limit',
      public_message: 'Add that limit to my model.',
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-09-14T12:00:00.000Z',
  };
}

describe('offer sufficiency — the CONSENT DOCTRINE is untouched', () => {
  it('two genuinely different live proposals are BOTH still offered, and still require the user to choose', () => {
    const out = tryShortConfirmResume({
      message: 'do it',
      pendingActions: [
        livePending('prop_aaaaaaaaaaaa', { constraint_type: 'at_most', value: 7 }),
        livePending('prop_bbbbbbbbbbbb', { constraint_type: 'at_most', value: 5 }),
      ],
      currentTurnIndex: 1,
      nowMs: Date.parse('2026-09-14T12:01:00.000Z'),
    });

    expect(out.matched).toBe(true);
    if (!out.matched) throw new Error('unreachable');
    // NOT `pending_action`: a bare confirmation must not silently resolve one
    // of two live consent-expecting pendings.
    expect(out.dispatch).toBe('recovery_ambiguous');
    if (out.dispatch !== 'recovery_ambiguous') throw new Error('unreachable');
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates.map((c) => c.chip_id).sort()).toEqual([
      'prop_aaaaaaaaaaaa',
      'prop_bbbbbbbbbbbb',
    ]);
  });

  it('DISCRIMINATING TWIN — a single live proposal still resumes directly, so the listing is not universal', () => {
    // Without this, the case above would pass just as well if the resumer had
    // been broken into always returning `recovery_ambiguous` (trap 13b).
    const out = tryShortConfirmResume({
      message: 'do it',
      pendingActions: [livePending('prop_aaaaaaaaaaaa', { constraint_type: 'at_most', value: 7 })],
      currentTurnIndex: 1,
      nowMs: Date.parse('2026-09-14T12:01:00.000Z'),
    });
    expect(out.matched).toBe(true);
    if (!out.matched) throw new Error('unreachable');
    expect(out.dispatch).toBe('pending_action');
  });
});

describe('offer sufficiency — the required-parameter table', () => {
  it('covers every proposable intent, so no intent is silently ungated', () => {
    expect(Object.keys(OFFER_REQUIRED_PARAMETERS).sort()).toEqual([
      'add_constraint',
      'adjust_edge_strength',
      'set_factor_value',
    ]);
    for (const [intent, required] of Object.entries(OFFER_REQUIRED_PARAMETERS)) {
      expect(required.length, intent).toBeGreaterThan(0);
    }
  });

  it('returns null for an action it has no authority over, rather than refusing blind', () => {
    expect(findInsufficientOfferParameters(action('add_factor', []))).toBeNull();
  });
});
