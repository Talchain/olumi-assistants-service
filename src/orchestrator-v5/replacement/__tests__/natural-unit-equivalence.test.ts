/**
 * ⭐⭐⭐ MANDATORY REGRESSION 2 — NATURAL UNIT EQUIVALENCE.
 *
 * Paul's ruling, 21 Sep 2026: normal user expressions — **£59** for a
 * `£/month` factor, **50%** for a bounded unit-interval factor — must not be
 * rejected because internal unit strings differ.
 *
 * ── WHAT THIS FILE PINNED BEFORE, AND WHY IT IS NOW THE REAL CLAUSE ─────────
 * This file used to pin a GAP. `set_option_effect` takes a share in [0, 1],
 * and the model's view of the workspace (`read-tools.ts`) carried each
 * factor's value and unit but NOT its range — so the model was asked to
 * express £59 as a share of something it could not see. The only route to a
 * number was to guess the range, and a guessed range produces a confidently
 * wrong intervention WITH A RECEIPT: strictly worse than a refusal.
 *
 * Its final case asserted the range was absent and instructed whoever exposed
 * it to come back and write the real clause. This is that clause.
 *
 * ── WHAT CLOSED IT ──────────────────────────────────────────────────────────
 *   1. `factor-range.ts` — ONE range derivation, imported by the tool that
 *      WRITES and the view the model READS, so the range shown and the range
 *      accepted cannot drift apart.
 *   2. `read_workspace` shows each factor's range beside its value.
 *   3. `set_option_effect` takes `native_value` — the user's own figure — and
 *      does the conversion ITSELF, so nothing has to guess a range.
 *   4. The proposal names the user's figure AND the stored share, so consent
 *      is given to something the user can check.
 *
 * ⚠ AND WHAT THE CLAUSE DELIBERATELY DOES NOT DO. The conversion is confirmed
 * in the OFFER STRING by its two own numbers — what they said, what is stored
 * — and NOT by the range bounds, which are named only in the model's prose.
 * `namesANumberTheOfferDoesNot` admits a user's agreement only when every
 * digit run in their message appears in the offer, so a range bound in that
 * string would let "yes, make it 500000" accept an offer that stores 0.76.
 * That is pinned below, because it is the kind of thing a later tidy-up adds
 * back for readability.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { setOptionEffect, type EffectGraph } from '../set-option-effect.js';
import { createSetOptionEffectTool } from '../propose-tools.js';
import { createReadWorkspaceTool } from '../read-tools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const READ_TOOLS = readFileSync(join(HERE, '..', 'read-tools.ts'), 'utf8');
const SET_OPTION_EFFECT = readFileSync(join(HERE, '..', 'set-option-effect.ts'), 'utf8');

// ── THE FIXTURE ─────────────────────────────────────────────────────────────
// Paul's own example: a £/month factor. The SHAPE is the captured shape
// (`scale_frame` as the range maximum, `observed_state` carrying the native
// `raw_value` beside the normalised `value`); the digits are invented, because
// both repositories are public.
const OPT = 'opt_raise_price';
const PRICE = 'fac_plan_price';
const DECISION = 'dec_question';

/** £0–£500/month. £59 is 0.118 of it. Both numbers chosen to be unmistakable. */
function graph(): EffectGraph {
  return {
    nodes: [
      { id: DECISION, kind: 'decision', label: 'Question' },
      { id: OPT, kind: 'option', label: 'Raise the Plan Price' },
      {
        id: PRICE,
        kind: 'factor',
        label: 'Plan Price',
        scale_frame: 500,
        observed_state: { value: 0.098, raw_value: 49, unit: '£/month', source: 'cee_inference' },
      },
    ],
    edges: [{ from: DECISION, to: OPT }, { from: OPT, to: PRICE }],
  } as unknown as EffectGraph;
}

describe('MANDATORY REGRESSION 2 — natural unit equivalence', () => {
  it('the tool still demands a normalised share for the ENCODED value', () => {
    // The precondition for everything below, and the contract that must NOT
    // have been weakened to make the clause pass: a native magnitude in the
    // encoded slot corrupts the causal model.
    expect(SET_OPTION_EFFECT).toContain('Normalised effect in [0, 1]');
  });

  it('the model IS shown each factor’s value and unit', () => {
    // POSITIVE CONTROL for every source-level claim in this file: the probe
    // can see what the model is given, so a miss below is a real absence.
    expect(READ_TOOLS).toContain('the factors with their values and units');
  });

  // ── 1. THE RANGE IS EXPOSED ───────────────────────────────────────────────

  it('the workspace shows the factor’s RANGE, in its own units, beside its value', () => {
    const tool = createReadWorkspaceTool({ getGraph: () => graph() as never });
    const out = tool.execute({} as never) as { readonly content: string };

    // Bound by IDENTITY — the factor's own label and id — not by searching the
    // whole output for a number a sibling node could also carry (trap 19).
    const line = out.content.split('\n').find((l) => l.includes(`[${PRICE}]`));
    expect(line, 'the Plan Price factor must appear in the workspace view').toBeDefined();
    expect(line).toContain('Plan Price');
    expect(line).toContain('range 0 to 500 £/month');

    // And the NATIVE value, not the normalised one wearing a currency symbol —
    // which is what this line said before: "value 0.098 £/month" for £49.
    expect(line).toContain('value 49 £/month');
    expect(line).toContain('(model value 0.098)');
  });

  it('CONTRAST CONTROL: a factor with no stated range says so, and says what to ask for', () => {
    // The same probe, same run, on a factor that genuinely has no basis. If
    // this said "range …" too, the assertion above would be measuring the
    // renderer's enthusiasm rather than the factor's data.
    const g = graph() as unknown as { nodes: Record<string, unknown>[] };
    g.nodes.push({ id: 'fac_bare', kind: 'factor', label: 'Unbounded Thing' });
    const tool = createReadWorkspaceTool({ getGraph: () => g as never });
    const out = tool.execute({} as never) as { readonly content: string };

    const bare = out.content.split('\n').find((l) => l.includes('[fac_bare]'));
    expect(bare).toBeDefined();
    expect(bare).toContain('no range set');
    expect(bare).not.toContain('range 0 to');

    // …while the ranged factor in the SAME output still reports its range.
    const priced = out.content.split('\n').find((l) => l.includes(`[${PRICE}]`));
    expect(priced).toContain('range 0 to 500 £/month');
  });

  // ── 2. THE EQUIVALENCE CLAUSE ITSELF ──────────────────────────────────────

  it('⭐ "£59" on a £/month factor lands as the right share, and the user is shown both', () => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59 });

    expect(r.ok, 'a normal user expression must not be refused').toBe(true);
    if (!r.ok) return;

    // THE CONVERSION: £59 of a £0–£500 range. Not a guess — the same function
    // the workspace view rendered the range from.
    expect(r.value).toBe(0.118);
    expect(r.native_value).toBe(59);
    expect(r.native_unit).toBe('£/month');
    expect(r.range).toBe('0 to 500 £/month');

    // THE CONFIRMATION: the offer the user is asked to agree to names the
    // figure THEY said and the number that will be STORED. Consent to a
    // derivation you cannot check is not consent.
    expect(r.summary).toContain('59 £/month');
    expect(r.summary).toContain('0.118');
    expect(r.summary).toContain('Plan Price');

    // THE COMMITTED INTERVENTION MATCHES — and carries the SHARE, never the
    // native magnitude. Bound by path IDENTITY to this option and this factor.
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0]?.path).toBe(`/nodes/${OPT}/data/interventions/${PRICE}`);
    expect(r.operations[0]?.value).toEqual({ value: 0.118 });
  });

  it('⛔ the [0,1] contract is NOT weakened — the native figure never enters the encoded slot', () => {
    // The mutation this clause must never become: £59 written where the
    // engine reads a share. `routing/native-quantity-operation.ts` states the
    // harm in terms — a [0,1] intervention moved to 59 corrupts the model.
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const written = (r.operations[0]?.value as { value: number }).value;
    expect(written).toBeLessThanOrEqual(1);
    expect(written).toBeGreaterThanOrEqual(0);
    expect(written).not.toBe(59);
  });

  it('50% on an already-normalised factor is 0.5 — the other half of Paul’s ruling', () => {
    const g = graph() as unknown as { nodes: Record<string, unknown>[] };
    const NORM = 'fac_share';
    g.nodes.push({
      id: NORM,
      kind: 'factor',
      label: 'Conversion Share',
      observed_state: { value: 0.3, unit: 'scale', source: 'cee_inference' },
    });
    g.nodes.push({ from: OPT, to: NORM } as never);
    (g as unknown as { edges: unknown[] }).edges.push({ from: OPT, to: NORM });

    const r = setOptionEffect({ graph: g as never, optionId: OPT, factorId: NORM, nativeValue: 0.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(0.5);
    // `scale` is the producer's word for "already normalised", not a unit
    // anybody says — so the confirmation must not ask anyone to agree to
    // "0.5 scale".
    expect(r.summary).not.toContain('scale');
  });

  // ── 3. THE GUESS, REFUSED ─────────────────────────────────────────────────

  it('⛔ a share computed against an INVENTED range is refused, and told the real one', () => {
    // The defect this whole change exists to stop, reproduced deliberately: a
    // model that assumed £0–£100 would offer 0.59 for £59.
    const r = setOptionEffect({
      graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59, value: 0.59,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('share_disagrees_with_native_value');
    if (r.refusal.reason !== 'share_disagrees_with_native_value') return;
    expect(r.refusal.derived_value).toBe(0.118);
    expect(r.refusal.message).toContain('0 to 500 £/month');
  });

  it('a share that AGREES with the native figure passes — the guard is not blanket', () => {
    // Without this, the case above would pass just as well if the tool refused
    // every call carrying both numbers, which is a different behaviour with
    // the same green tick.
    const r = setOptionEffect({
      graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59, value: 0.118,
    });
    expect(r.ok).toBe(true);
  });

  it('⭐ when both are given, the TOOL’s arithmetic is what gets stored — not the model’s', () => {
    // FOUND BY A SURVIVING MUTANT, not by review. `effective = rounded` could
    // be rewritten to `value ?? rounded` and every other case in this file
    // stayed green, because they all supply a share that is EXACTLY equal to
    // the derived one — so nothing could tell which of the two was stored.
    //
    // The property is the whole point of the change: the layer that can read
    // the range is the authority on the conversion. A model's number that
    // merely passes the agreement check is still the model's number.
    const nudged = 0.118 + 4e-10; // inside the 1e-9 tolerance, so NOT refused
    expect(nudged).not.toBe(0.118);

    const r = setOptionEffect({
      graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59, value: nudged,
    });
    expect(r.ok, 'a share within tolerance must still be accepted').toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(0.118);
    expect(r.value).not.toBe(nudged);
    expect(r.operations[0]?.value).toEqual({ value: 0.118 });
  });

  it('⛔ an ignorance prior is NAMED as not-stated in the workspace, never shown as a range', () => {
    // `buildUnquantifiedPrior()` writes U(0,1) meaning "nobody has said". The
    // tool refuses it (pinned in `set-option-effect.test.ts`); this pins the
    // DISPLAY half, which was unguarded — showing "range 0 to 1" would hand
    // the model a fabrication to convert against, and showing nothing would
    // let it read the silence as "no range needed". Both were live failures.
    const g = graph() as unknown as { nodes: Record<string, unknown>[] };
    g.nodes.push({
      id: 'fac_placeholder',
      kind: 'factor',
      label: 'Unstated Thing',
      prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true },
    });
    const tool = createReadWorkspaceTool({ getGraph: () => g as never });
    const out = tool.execute({} as never) as { readonly content: string };

    const line = out.content.split('\n').find((l) => l.includes('[fac_placeholder]'));
    expect(line).toBeDefined();
    expect(line).toContain('NOT STATED');
    expect(line).not.toContain('range 0 to 1');

    // CONTRAST CONTROL, same output: the genuinely-ranged factor still reports
    // its range, so this is measuring the placeholder and not the renderer.
    expect(out.content.split('\n').find((l) => l.includes(`[${PRICE}]`)))
      .toContain('range 0 to 500 £/month');
  });

  it('⛔ a native figure outside the factor’s range is refused as a FRAME question', () => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 600 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // NOT `value_out_of_range`: the user's number is sensible and the frame
    // disagrees with it. Telling them to restate the figure would be wrong.
    expect(r.refusal.reason).toBe('native_value_outside_factor_range');
    expect(r.refusal.message).not.toContain('between 0 and 1');
  });

  // ── 4. THE OFFER STRING'S DIGIT SET, PINNED ───────────────────────────────

  it('⛔⛔ the offer names its OWN two numbers and NOT the range bounds', () => {
    // `namesANumberTheOfferDoesNot` admits a user's agreement only when every
    // digit run in their message appears in this summary. A held proposal
    // replays from its STORED patch and never re-reads the message, so a
    // range bound in the offer string would let "yes, make it 500" accept an
    // offer that stores 0.118 — saving MY number and discarding THEIRS, with
    // a receipt. Adding the range back here for readability reopens that.
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, nativeValue: 59 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.summary).toContain('59');      // what they said
    expect(r.summary).toContain('0.118');   // what gets stored
    expect(r.summary).not.toContain('500'); // the frame — mentioned, not agreed to

    // The range is not lost: it reaches the user through the model's own
    // sentence, via the tool's model-facing result.
    const tool = createSetOptionEffectTool({ getGraph: () => graph() });
    const outcome = tool.execute({
      option_id: OPT, factor_id: PRICE, native_value: 59,
    } as never) as { readonly type: string; readonly content: string; readonly summary: string };
    expect(outcome.type).toBe('proposed');
    expect(outcome.content).toContain('0 to 500 £/month');
    expect(outcome.content).toContain('TELL THEM BOTH');
    expect(outcome.summary).not.toContain('500');
  });

  // ── 5. THE DERIVATION IS SHARED, NOT MIRRORED ─────────────────────────────

  it('the range SHOWN and the range ACCEPTED come from the same function', () => {
    // The defect this file would otherwise become: two derivations of "what is
    // this factor's range", free to drift, with every symptom of the drift
    // looking exactly like the guessing the change was made to stop.
    expect(READ_TOOLS).toContain("from './factor-range.js'");
    expect(SET_OPTION_EFFECT).toContain("from './factor-range.js'");
    expect(READ_TOOLS).toContain('resolveFactorRange');
    expect(SET_OPTION_EFFECT).toContain('resolveFactorRange');
  });

  it('the captured graph carries real ranges, so this is the shape the wire sends', () => {
    // The argument the whole change rests on: the range was never missing from
    // the DATA, only from what the model was shown.
    const g = JSON.parse(
      readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
    ) as { nodes: Array<Record<string, unknown>> };
    const factors = g.nodes.filter((n) => n.kind === 'factor');
    const ranged = factors.filter(
      (n) => (n.prior as Record<string, unknown> | undefined)?.range_min !== undefined
        || typeof n.scale_frame === 'number',
    );
    expect(factors.length, 'the capture must carry factors at all').toBeGreaterThan(0);
    expect(ranged.length, 'the capture must carry factor ranges').toBe(factors.length);
  });
});
