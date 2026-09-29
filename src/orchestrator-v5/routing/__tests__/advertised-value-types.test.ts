/**
 * DERIVED GUARD — the `value` types the tool schema ADVERTISES to the model
 * must be a subset of the types the live acceptor chain ACCEPTS.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tool-schema.ts` tells Sonnet what a `parameters[].value` may look like.
 * `validator.ts` decides what it will actually take. Those two drifted: the
 * advert carried `boolean` and a string/boolean-valued object wrapper that
 * NO acceptor has ever accepted, and the product spent an 81% refusal rate
 * on `set_factor_value` (30 of 37 proposals, staging 30–31 Aug 2026)
 * refusing shapes it had itself invited.
 *
 * The estate's dominant defect is the hand-maintained mirror: a hand-copied
 * list of "types we advertise" would drift silently and the drift reads as
 * green. So BOTH SIDES of the assertion are derived at runtime:
 *
 *   • the ADVERTISED side is read out of the real exported `OLUMI_ACTION_TOOL`
 *     object — the same object handed to the Anthropic SDK;
 *   • the ACCEPTED side is measured by DRIVING the real acceptor chain
 *     (`resolveRelativeFactorDelta` then `validateToolCall`), exactly as
 *     `turn-executor.ts` does, and observing whether the SHAPE gate fired.
 *
 * WHAT DERIVATION CANNOT DO (CLAUDE.md rule 12d)
 * ----------------------------------------------
 * A derived guard proves AGREEMENT; it can never prove COMPLETENESS. It
 * cannot notice that the advertised `string` arm is accepted only for a
 * narrow SUB-LANGUAGE. So the derived assertions below are PAIRED with a
 * hand-written corpus of concrete strings a routing model plausibly emits,
 * pinned as an explicit KNOWN-DIVERGENCE set that REDs if it grows OR
 * shrinks (CLAUDE.md trap 22f — the honest way to ship a known gap).
 *
 * THE SHAPE GATE, PRECISELY
 * -------------------------
 * "Accepted" here means the value's SHAPE was understood. Two enums are
 * SHAPE refusals and everything else is semantic:
 *
 *   • `parameter_schema_mismatch` — the handler's declared Zod parameter
 *     schema refused the shape (validator.ts generic parameter loop). This
 *     runs FIRST and is what actually catches a string/boolean/null.
 *   • `missing_value` — the structural precheck
 *     (`preexecuteSetFactorValueStructural`), which runs AFTER the loop.
 *
 * A SEMANTIC refusal (cap, unit, finiteness) counts as ACCEPTED here: the
 * shape was parsed and only the meaning was refused. Binding to the enums
 * rather than to `valid === false` is what keeps this test measuring the
 * advertised-vs-accepted divergence and not the cap guards.
 */

import { describe, expect, it } from 'vitest';

import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { resolveRelativeFactorDelta } from '../resolve-relative-factor-delta.js';
import { OLUMI_ACTION_TOOL } from '../tool-schema.js';
import type { ProposalAction, ProposalParameter } from '../types.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';

// ---------------------------------------------------------------------------
// DERIVE the advertised arms from the REAL tool object
// ---------------------------------------------------------------------------

interface JsonSchemaNode {
  readonly type?: string;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly items?: JsonSchemaNode;
}

/**
 * Walk the ACTUAL exported tool object to the `parameters[].value` node.
 *
 * Throws loudly on any missing hop. This matters: if a refactor moved the
 * node and this returned `undefined`, every subset assertion below would
 * pass VACUOUSLY over an empty list — an instrument that cannot fail
 * (CLAUDE.md trap 13). The cardinality assertions in the first test are the
 * positive control for this walk.
 */
function advertisedValueNode(): JsonSchemaNode {
  const root = OLUMI_ACTION_TOOL.input_schema as unknown as JsonSchemaNode;
  const action = root.properties?.action;
  if (!action) throw new Error('tool schema: input_schema.properties.action is missing');
  const parameters = action.properties?.parameters;
  if (!parameters) throw new Error('tool schema: action.properties.parameters is missing');
  const items = parameters.items;
  if (!items) throw new Error('tool schema: parameters.items is missing');
  const value = items.properties?.value;
  if (!value) throw new Error('tool schema: parameters.items.properties.value is missing');
  return value;
}

/** The advertised top-level type tokens for `value`, derived, sorted. */
function advertisedValueTypes(): readonly string[] {
  const node = advertisedValueNode();
  const arms = node.anyOf;
  if (!arms || arms.length === 0) {
    throw new Error('tool schema: parameters.items.properties.value.anyOf is empty or absent');
  }
  return arms
    .map((a, i) => {
      if (typeof a.type !== 'string') {
        throw new Error(`tool schema: value.anyOf[${i}] has no concrete "type"`);
      }
      return a.type;
    })
    .slice()
    .sort();
}

/** The advertised type tokens for the INNER `{ value, unit?, cap? }` wrapper. */
function advertisedInnerValueTypes(): readonly string[] {
  const objectArm = advertisedValueNode().anyOf?.find((a) => a.type === 'object');
  if (!objectArm) throw new Error('tool schema: value.anyOf has no object arm');
  const inner = objectArm.properties?.value;
  if (!inner) throw new Error('tool schema: object arm has no inner "value" property');
  if (typeof inner.type === 'string') return [inner.type];
  const arms = inner.anyOf;
  if (!arms || arms.length === 0) {
    throw new Error('tool schema: inner value has neither a type nor a non-empty anyOf');
  }
  return arms
    .map((a, i) => {
      if (typeof a.type !== 'string') {
        throw new Error(`tool schema: inner value.anyOf[${i}] has no concrete "type"`);
      }
      return a.type;
    })
    .slice()
    .sort();
}

// ---------------------------------------------------------------------------
// MEASURE the acceptor by driving the REAL chain
// ---------------------------------------------------------------------------

function makeLookup(): GraphLookup {
  const graph = buildD1Fixture();
  const built = buildGraphLookup({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      observed_state: n.observed_state,
    })) as never,
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) as never,
  } as never);
  if (built.kind !== 'ok') throw new Error('Test fixture failed to build a GraphLookup');
  return built.lookup;
}

const GRAPH: GraphLookup = makeLookup();
/** `f-budget` in the D1 fixture: unit '£', cap 100000, with an existing value. */
const FACTOR_ID = 'f-budget';

function makeProposal(param: Partial<ProposalParameter> & { value: unknown }): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: FACTOR_ID,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        source: 'user_explicit',
        ...param,
      } as ProposalParameter,
    ],
    cited_context_fields: [],
  } as ProposalAction;
}

/**
 * Drive the live chain exactly as `turn-executor.ts` does: relative-delta
 * rewrite first (turn-executor.ts, STEP 1.5), then `validateToolCall`.
 * Returns the SHAPE verdict plus the rejection enum for diagnosis.
 */
const SHAPE_REFUSAL_REASONS: ReadonlySet<string> = new Set([
  'parameter_schema_mismatch',
  'missing_value',
]);

/**
 * ⚠⚠ THE ACCEPTED DIRECTION IS BOUND BY `valid`, NOT BY A NEGATION.
 *
 * This helper used to answer the accepted direction with
 *
 *   `rejectionReason === undefined || !SHAPE_REFUSAL_REASONS.has(rejectionReason)`
 *
 * so ANY validation failure carrying no `rejection_reason` — `ENTITY_NOT_FOUND`,
 * `ENTITY_KIND_MISMATCH`, `ENTITY_RESOLUTION_SUSPICIOUS` — read as ACCEPTED.
 * Asymmetric rigour (CLAUDE.md trap 22b): the REFUSED direction is
 * identity-bound (`toBe('parameter_schema_mismatch')`) while the accepted
 * direction was bound by a predicate any unrelated error satisfies. The
 * discrimination was real on the day it was written and unguarded at rest
 * (trap 13b) — nothing pinned the fixture that made it discriminate.
 *
 * MEASURED, not argued. With `f-budget` and its edge removed from
 * `buildD1Fixture()`, at the pre-fix tip the `number` and `object`
 * representatives still certified ACCEPTED against a target that does not
 * exist — only the `string` arm went red, and only incidentally (the delta
 * resolver needs the factor's existing value, so the string is never rewritten
 * and falls to `parameter_schema_mismatch`, which IS in the set above). Two of
 * the three advertised arms were measuring nothing.
 *
 * So `valid` is exposed and asserted directly, and `shapeAccepted` FAILS
 * CLOSED: an unrecognised or absent `rejection_reason` on a failed validation
 * is no longer evidence of acceptance. `errorCode` is carried so a non-shape
 * refusal is DIAGNOSED rather than silently rebadged — the reviewer's point
 * that a semantic refusal must be asserted as itself, not swallowed.
 */
function shapeVerdict(param: Partial<ProposalParameter> & { value: unknown }): {
  readonly valid: boolean;
  readonly shapeAccepted: boolean;
  readonly rejectionReason: string | undefined;
  readonly errorCode: string | undefined;
} {
  let action = makeProposal(param);
  const rel = resolveRelativeFactorDelta(action, GRAPH);
  if (rel.resolved) action = rel.action;
  const result = validateToolCall(action, GRAPH, HANDLER_VALIDATION_REGISTRY);
  if (result.valid) {
    return { valid: true, shapeAccepted: true, rejectionReason: undefined, errorCode: undefined };
  }
  const reason = result.error.details?.rejection_reason;
  const rejectionReason = typeof reason === 'string' ? reason : undefined;
  const rawCode: unknown = result.error.code;
  return {
    valid: false,
    // FAIL CLOSED — see the note above. A refusal is only "not a shape
    // refusal" when it NAMES a reason that is not one.
    shapeAccepted: rejectionReason !== undefined && !SHAPE_REFUSAL_REASONS.has(rejectionReason),
    rejectionReason,
    errorCode: typeof rawCode === 'string' ? rawCode : undefined,
  };
}

/** One representative value per advertised top-level arm. */
const REPRESENTATIVE: Readonly<Record<string, Partial<ProposalParameter> & { value: unknown }>> = {
  number: { value: 40000, operator: 'set', unit: '£' },
  object: { value: { value: 40000, unit: '£', cap: 100000 }, operator: 'set' },
  // The only string form the chain accepts: a SIGNED percent delta.
  string: { value: '+5%', operator: 'increase' },
};

// ---------------------------------------------------------------------------

describe('DERIVED GUARD — advertised `value` types ⊆ accepted `value` types', () => {
  it('the schema walk finds a non-empty, correctly-shaped advert (positive control)', () => {
    // POSITIVE CONTROL for every assertion below. If the walk silently
    // returned nothing, the subset test would pass over an empty set and
    // certify a divergence it never looked at.
    const types = advertisedValueTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types).toEqual(['number', 'object', 'string']);

    const inner = advertisedInnerValueTypes();
    expect(inner.length).toBeGreaterThan(0);
    // The `{ value, unit?, cap? }` wrapper: every consumer requires a
    // numeric inner value (set-factor-value.ts SetFactorValueValueSchema,
    // validator.ts parseValueParameter, resolve-relative-factor-delta.ts).
    expect(inner).toEqual(['number']);
  });

  it('every advertised top-level arm is accepted by the live acceptor chain', () => {
    const advertised = advertisedValueTypes();
  const unaccepted: Array<{
      type: string;
      rejectionReason: string | undefined;
      errorCode: string | undefined;
    }> = [];

    for (const type of advertised) {
      const representative = REPRESENTATIVE[type];
      // A newly-advertised arm with no representative is a FAILURE, not a
      // skip — otherwise adding an arm silently escapes this guard.
      expect(
        representative,
        `tool schema advertises value type "${type}" but this guard has no representative for it. ` +
          'Add one (and prove an acceptor takes it) — do not delete the arm from the advert ' +
          'without checking every handler first.',
      ).toBeDefined();
      const verdict = shapeVerdict(representative!);
      // ⚠ `valid`, not `shapeAccepted`. The advert is only honest if the live
      // chain actually TAKES the representative. Reading "not refused on
      // shape" as "accepted" let this loop certify two of the three arms
      // against a target that had been deleted from the fixture.
      if (!verdict.valid) {
        unaccepted.push({
          type,
          rejectionReason: verdict.rejectionReason,
          errorCode: verdict.errorCode,
        });
      }
    }

    expect(
      unaccepted,
      'The tool schema advertises a `value` type the live chain does not accept. ' +
        'A `parameter_schema_mismatch` / `missing_value` here is the advertised-vs-accepted ' +
        'divergence this guard exists for: the model is told to send something the product ' +
        'then rejects. ANY OTHER code (ENTITY_NOT_FOUND, ENTITY_KIND_MISMATCH, ' +
        'ENTITY_RESOLUTION_SUSPICIOUS) means the FIXTURE broke, not the advert — the guard ' +
        'is no longer measuring what it claims and must be repaired before it is believed.',
    ).toEqual([]);
  });

  it('`boolean` is NOT advertised — it has zero acceptors', () => {
    // Regression pin for the removed arm. No registered handler reads a
    // boolean out of `parameters[].value` (swept across all 7 handlers in
    // the registry, contrast-controlled against string/number hits in the
    // same files). Re-advertising it would recreate the divergence.
    expect(advertisedValueTypes()).not.toContain('boolean');
    expect(advertisedInnerValueTypes()).not.toContain('boolean');

    // And prove the claim rather than asserting it: a boolean IS refused
    // on shape, so the arm would be pure advertisement if restored.
    const verdict = shapeVerdict({ value: true, operator: 'set' });
    expect(verdict.shapeAccepted).toBe(false);
    // Caught by the handler's declared Zod parameter schema, not by the
    // structural precheck — the generic loop runs first.
    expect(verdict.rejectionReason).toBe('parameter_schema_mismatch');
  });
});

describe('KNOWN DIVERGENCE — the advertised `string` arm is accepted only as a percent delta', () => {
  /**
   * The `string` arm CANNOT be removed from the advert: it is load-bearing
   * for `add_constraint`, whose mandatory `constraint_type` parameter is a
   * z.enum(['at_least','at_most']) string routed through this same shared
   * `parameters[].value` schema (plus its `label` and `unit`). Narrowing
   * `value` to number-only makes a valid add_constraint call
   * unrepresentable in the advertised schema.
   *
   * So for `set_factor_value` the string arm is honest only for the
   * sub-language `resolve-relative-factor-delta.ts` implements. Everything
   * else is refused. That gap is REAL and is recorded here rather than left
   * invisible to the suite, which is how it shipped in the first place.
   *
   * ⚠ CORRECTED (#1283 review) — THE STRENGTH OF THIS PIN WAS OVERSTATED.
   * It said the pin "REDs if the set grows or shrinks". It does not. The
   * expected value is derived by FILTERING `REFUSED_STRINGS` and comparing to
   * that same array's own labels, so it bites on an EDIT TO THE ARRAY and is
   * blind to the refused LANGUAGE growing: a newly-refused string form nobody
   * has listed here changes nothing it can observe. That is the weak form of
   * the pattern (CLAUDE.md trap 12d — a derived guard proves agreement, never
   * completeness), and the honest claim is narrower: it pins that every
   * member of these two hand-written corpora still lands on the side this
   * file says it does. Only a corpus sourced from outside the author's head
   * could bound the language itself.
   */
  const ACCEPTED_STRINGS: ReadonlyArray<[string, Partial<ProposalParameter> & { value: unknown }]> =
    [
      ['signed increase', { value: '+5%', operator: 'increase' }],
      ['signed decrease', { value: '-10%', operator: 'decrease' }],
      ['signless percent WITH a delta operator', { value: '5%', operator: 'increase' }],
    ];

  const REFUSED_STRINGS: ReadonlyArray<[string, Partial<ProposalParameter> & { value: unknown }]> = [
    // A bare numeric string — the single most likely model output once the
    // advert says "string is fine".
    ['bare numeric string', { value: '40000', operator: 'set' }],
    // Signless percent WITHOUT a delta operator: "set to 5%" is absolute,
    // not relative. The resolver refuses to guess, and nothing else parses it.
    ['signless percent, operator set', { value: '5%', operator: 'set' }],
    ['unit-bearing string', { value: '£40k', operator: 'set' }],
    ['prose', { value: 'twenty thousand', operator: 'set' }],
    ['empty string', { value: '', operator: 'set' }],
  ];

  it.each(ACCEPTED_STRINGS)('ACCEPTED: %s', (_label, param) => {
    const verdict = shapeVerdict(param);
    // IDENTITY-BOUND, the same standard the refused direction already meets.
    // `shapeAccepted` alone was satisfiable by an error about something else
    // entirely — assert that the live chain actually took the value, and name
    // the code when it did not so a broken fixture cannot masquerade as a
    // passing advert.
    expect(verdict.valid, `refused with code=${verdict.errorCode} reason=${verdict.rejectionReason}`).toBe(
      true,
    );
    expect(verdict.rejectionReason).toBeUndefined();
  });

  it.each(REFUSED_STRINGS)('KNOWN-REFUSED: %s', (_label, param) => {
    const verdict = shapeVerdict(param);
    expect(verdict.shapeAccepted).toBe(false);
    expect(verdict.rejectionReason).toBe('parameter_schema_mismatch');
  });

  it('the known-refused set is pinned EXACTLY — it must not grow or shrink silently', () => {
    const refused = REFUSED_STRINGS.filter(([, p]) => !shapeVerdict(p).shapeAccepted).map(
      ([label]) => label,
    );
    expect(refused).toEqual([
      'bare numeric string',
      'signless percent, operator set',
      'unit-bearing string',
      'prose',
      'empty string',
    ]);
    const accepted = ACCEPTED_STRINGS.filter(([, p]) => shapeVerdict(p).valid).map(
      ([label]) => label,
    );
    expect(accepted).toEqual([
      'signed increase',
      'signed decrease',
      'signless percent WITH a delta operator',
    ]);
  });
});

describe('PARAMETER_INVALID is attributable from logs — the measured branch', () => {
  /**
   * ⭐ THE MEASUREMENT THIS GUARD EXISTS TO PROTECT.
   *
   * Production (staging `ac37890c`, 30 Aug 18:00Z – 31 Aug 16:00Z) logged
   * 27 PARAMETER_INVALID refusals on `set_factor_value`, splitting by
   * composer template into 12 `parameter_invalid_issue` + 9
   * `parameter_invalid_missing_value` + 6 `parameter_invalid_unit_unstated`.
   * The 9 are this class. EVERY ONE of the 27 carried the safe_details
   * key-set exactly {handler_id, parameter} — and, decisively, NONE carried
   * the key-set {parameter} alone. Those key-sets identify the emitter
   * uniquely, because the two producers thread DIFFERENT detail fields:
   *
   *   • the generic parameter loop threads NO `handler_id`
   *     → whitelisted safe_details is {parameter} only;
   *   • `preexecuteSetFactorValueStructural` threads `handler_id`
   *     → whitelisted safe_details is {handler_id, parameter}.
   *
   * So ZERO production refusals came from the generic loop — i.e. no
   * string or boolean `value` was refused on shape in the whole window —
   * and the 9 `missing_value` refusals came from the structural precheck.
   * Since the precheck's OTHER emit site is unreachable (see the last test
   * in this block), those 9 are all site 761: the model emitted a
   * `set_factor_value` proposal carrying NO `value` parameter at all.
   *
   * ⭐ THIS REFUTES THE STRING HYPOTHESIS. The advertised-vs-accepted type
   * divergence this file guards is REAL, but it caused none of the
   * measured refusals — the model was omitting `value`, not mis-typing it.
   * The narrowing above is therefore hygiene that closes a latent trap; the
   * fix aimed at the measured cause is the `value`-is-MANDATORY instruction
   * in the set_factor_value advert in `tool-schema.ts`.
   *
   * These tests pin the signatures that made that inference sound. If a
   * future change gives the generic loop a `handler_id`, or takes it off
   * the structural precheck, the two classes alias in logs and the
   * measurement becomes unrepeatable — so this REDs.
   */
  it('MEASURED BRANCH: no `value` parameter → missing_value + handler_id + value_param_present false', () => {
    const action = {
      handler_id: 'set_factor_value',
      entity: {
        id: FACTOR_ID,
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: [],
    } as unknown as ProposalAction;
    const result = validateToolCall(action, GRAPH, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error.details?.rejection_reason).toBe('missing_value');
    // The field that made this branch identifiable in production logs.
    expect(result.error.details?.handler_id).toBe('set_factor_value');
    // The explicit discriminator, so the next reader need not infer it
    // from an accident of which keys survive the whitelist.
    expect(result.error.details?.value_param_present).toBe(false);
  });

  it('the generic parameter loop threads NO handler_id — this is what disambiguates the two classes', () => {
    const result = validateToolCall(
      makeProposal({ value: 'twenty thousand', operator: 'set' }),
      GRAPH,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error.details?.rejection_reason).toBe('parameter_schema_mismatch');
    // ⚠ Load-bearing for the production measurement above. If this gains a
    // handler_id, both classes render as {handler_id, parameter} and the
    // 27-line reading can no longer be reproduced.
    expect(result.error.details).not.toHaveProperty('handler_id');
  });

  it('the structural precheck\'s "present but unparseable" branch is PRE-EMPTED at this tip', () => {
    // Honest record of a real limit: `preexecuteSetFactorValueStructural`
    // has a second emit site for "value present but shaped wrong", and it
    // is UNREACHABLE through validateToolCall today because the generic
    // parameter loop runs first and refuses those shapes. So
    // `value_param_present: true` cannot appear in production at this tip.
    // Pinned rather than deleted: if `parameter_schemas.value` is ever
    // loosened, that branch goes live and this test REDs to say so.
    for (const badShape of [
      'twenty thousand',
      true,
      null,
      { value: 'not-a-number' },
    ] as const) {
      const result = validateToolCall(
        makeProposal({ value: badShape, operator: 'set' }),
        GRAPH,
        HANDLER_VALIDATION_REGISTRY,
      );
      expect(result.valid).toBe(false);
      if (result.valid) continue;
      expect(result.error.details?.rejection_reason).toBe('parameter_schema_mismatch');
      expect(result.error.details).not.toHaveProperty('value_param_present');
    }
  });
});
