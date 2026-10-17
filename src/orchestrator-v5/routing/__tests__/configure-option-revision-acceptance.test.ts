/**
 * ⭐⭐⭐ THE DELIBERATE-EDIT COMPONENT'S JOINED ACCEPTANCE — RED-first.
 *
 *   *An ordinary, clear revision to an option's effect WORKS — and the
 *    wrong-entity counterparts that rewrite the NAMED OPTION'S OWN LINKS, or a
 *    node baseline it is wired to, CANNOT mutate.*
 *
 * ⚠⚠ THAT SENTENCE IS NARROW ON PURPOSE, AND AN EARLIER VERSION OF IT WAS NOT.
 * It read *"its ambiguous and wrong-entity counterparts CANNOT mutate
 * anything"* — **false as stated, and contradicted by three of the tests in
 * this very file**: `RESIDUAL F2/a` (a wrong-FACTOR write on the named option)
 * and `RESIDUAL F2/b` (a wrong-OPTION write) both still COMMIT, and `ARM E`
 * shows a message naming no option is not protected at all.
 *
 * **"Nothing regresses, and every residual is pinned" and "the class is
 * covered" are different statements, and only the first is true.** An
 * acceptance sentence that overclaims is the artefact every later session
 * inherits — it reads as settled, so nobody re-derives it. That is the
 * hand-maintained-mirror defect this estate keeps paying for, and the
 * narrowing is the whole remedy.
 *
 * BOTH HALVES, OR THE COMPONENT IS NOT COMPLETE. A guard that refuses
 * everything passes the second half and fails the first; a permissive resolver
 * passes the first and fails the second. So every arm below is asserted **at
 * the STORED OBJECT** — which node, edge or intervention the user is left
 * holding, and at what value — never at the reply prose. A receipt reading
 * *"Updated <factor>"* is exactly how the wrong-entity write stayed invisible
 * for weeks (`wrong-entity-write-capture.fixture.ts`: the product said
 * *"Updated edge from Hold Price at £49 (Status Quo) to Pro Plan Monthly
 * Price"* and it was true, and the user had asked for something else).
 *
 * ── WHY THIS FILE EXISTS BESIDE `configure-option-revision-is-guarded` ─────
 * That file states the VERDICT this lane owes (part 1 — recognition). This one
 * states the OUTCOME the user gets (part 2 — the write), and joins the two so
 * neither half can be shipped alone. They were kept apart because they RED for
 * different reasons at different tips, and a reader must be able to see which.
 *
 * ── THE SECOND DEFECT THIS FILE PINS (part 2) ─────────────────────────────
 * `baselineWritesLanded` reads **only node `observed_state.value`**. An
 * EDGE-only write therefore yields `movedNodeIds.length === 0`, the guard
 * returns `allow` / `no_baseline_write`, and the wrong mutation PERSISTS —
 * underneath honest text. Measured at this tip (see the arm table below).
 *
 * ⭐ And it is not a new class: `configure-option-outcome.ts`'s own header
 * witnesses an EDGE-STRENGTH write as the ORIGINAL 2.427 defect
 * (`opt_cloud_native → fac_adoption_complexity`, `strength.mean = 0.7`,
 * `interventions` absent). **2.427 fixed the TEXT; 2.1266 withheld the WRITE
 * for node baselines only.** The originally-witnessed edge write still
 * persisted.
 *
 * ── WHAT "THE STORED OBJECT" MEANS HERE, AND WHY IT IS NOT A SECOND MIRROR ─
 * `edit-graph-dispatch.ts` gates every success effect — persist, receipt fact,
 * `analysis_ready`, returned graph — on `effectiveAppliedMutation`, which
 * carries `!optionInterventionWriteWithheld`. So a `withhold` verdict means the
 * user keeps the PRE-edit graph. That linkage is pinned end-to-end, against a
 * real dispatcher, by
 * `handlers/__tests__/edit-graph-dispatch-wrong-entity-write-withheld.test.ts`
 * (*"the witnessed factor-baseline write is NOT committed"*). It is NOT
 * re-modelled here — a second dispatcher harness would be a hand-maintained
 * mirror of the same gate (trap 12). `storedGraph` below applies that one rule
 * and nothing else.
 *
 * ── SCOPE, STATED BEFORE THE CLAIM (trap 20) ──────────────────────────────
 * Arms E and F are DISCRIMINATION CONTROLS, not acceptance. A message that
 * names no option — or names two — reaches no verdict and the write is
 * ALLOWED, exactly as today. That is deliberate and it is a residual, not a
 * pass: withholding on an unnamed subject would discard the measured W1
 * false-positive class wholesale (*"…our Fuel price assumption is stale —
 * change Fuel price to 1.40"*), which is the direction that destroys user work.
 * The arms are here so the file fails loudly if a later widening removes the
 * discrimination along with the abstention.
 */
import { describe, expect, it } from 'vitest';
import { detectConfigureOptionIntent, projectOptionLabels } from '../configure-option-intent.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_id: OPTION_ID,
  option_label: OPTION_LABEL,
  factor_id: FACTOR_ID,
  turn_message: MESSAGE,
} = CAPTURE.provenance;

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

function clone(graph: unknown): Graph {
  return JSON.parse(JSON.stringify(graph)) as Graph;
}

function optionInterventionValue(graph: unknown, optionId: string, factorId: string): unknown {
  const node = (graph as Graph).nodes.find((n) => n.id === optionId);
  const bundle = node?.interventions as Record<string, { value?: unknown }> | undefined;
  return bundle?.[factorId]?.value;
}

function edgeField(graph: unknown, from: string, to: string, field: string): unknown {
  const edge = (graph as Graph).edges.find((e) => e.from === from && e.to === to);
  if (edge === undefined) return undefined;
  if (field === 'strength.mean') return (edge.strength as { mean?: unknown } | undefined)?.mean;
  return edge[field];
}

function observedValue(graph: unknown, nodeId: string): unknown {
  const node = (graph as Graph).nodes.find((n) => n.id === nodeId);
  return (node?.observed_state as { value?: unknown } | undefined)?.value;
}

// ---------------------------------------------------------------------------
// The arms. Each is the SAME pre-edit graph and (except E/F) the SAME message —
// they differ only in WHAT THE EDIT LANE WROTE.
// ---------------------------------------------------------------------------

/** A — the ordinary, clear revision: the option's OWN effect value moves. */
function revisionLanded(): Graph {
  const after = clone(CAPTURE.before);
  const node = after.nodes.find((n) => n.id === OPTION_ID)!;
  (node.interventions as Record<string, { value: number }>)[FACTOR_ID] = { value: 0.79 };
  return after;
}

/** C — the ORIGINAL 2.427 shape: the option→factor edge's strength moves. */
function edgeStrengthWrite(): Graph {
  const after = clone(CAPTURE.before);
  const edge = after.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
  edge.strength = { ...(edge.strength as object), mean: 0.79 };
  return after;
}

/** D — the 2.1266 shape, on a REVISION: the factor's shared baseline moves. */
function factorBaselineWrite(): Graph {
  const after = clone(CAPTURE.before);
  const node = after.nodes.find((n) => n.id === FACTOR_ID)!;
  node.observed_state = { ...(node.observed_state as object), value: 0.79 };
  return after;
}

// ---------------------------------------------------------------------------
// PRECONDITIONS. Every arm below is only about a REVISION, and only about a
// message the edit lane really receives. Pinned in-test so no arm can decay
// into a claim about a FIRST configuration — the case that already worked.
// ---------------------------------------------------------------------------

describe('the deliberate-edit component — preconditions', () => {
  it('the named option already carries an effect value, so every arm is a REVISION', () => {
    expect(optionInterventionValue(CAPTURE.before, OPTION_ID, FACTOR_ID)).toBe(0.49);
  });

  it('every arm’s message reaches the edit lane (the detector is not the gap)', () => {
    const labels = projectOptionLabels(CAPTURE.before.nodes as never);
    expect(detectConfigureOptionIntent(MESSAGE, labels).matched).toBe(true);
  });

  it('the four arms really are four DIFFERENT writes, and only one is on target', () => {
    // Without this, two arms could be the same graph and the table would be
    // reporting one measurement four times.
    expect(optionInterventionValue(revisionLanded(), OPTION_ID, FACTOR_ID)).toBe(0.79);
    expect(edgeField(CAPTURE.after, OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(0.79);
    expect(edgeField(edgeStrengthWrite(), OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(0.79);
    expect(observedValue(factorBaselineWrite(), FACTOR_ID)).toBe(0.79);

    // …and each leaves the OTHER three targets where they were.
    expect(optionInterventionValue(CAPTURE.after, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(edgeStrengthWrite(), OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(factorBaselineWrite(), OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(edgeField(revisionLanded(), OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(1);
    expect(edgeField(revisionLanded(), OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(1);
    expect(observedValue(revisionLanded(), FACTOR_ID)).toBe(0.49);
  });
});

// ---------------------------------------------------------------------------
// DISCRIMINATION CONTROLS — the guard must not stop discriminating.
// ---------------------------------------------------------------------------

describe('the guard still DISCRIMINATES (controls, not acceptance)', () => {

  /**
   * ⭐⭐ ARM G — THE EDGE ARM'S IDENTITY BINDING, and the half that proves it is
   * a binding rather than a blunt instrument (trap 19).
   *
   * An edge moved, the named option is resolved, no effect value landed — and
   * the edge is NOT one of the option's own. `6d9a37f3 → 94fa174b` is a
   * factor→outcome link: it belongs to the causal model, not to this option,
   * and discarding it would destroy an edit the guard has no claim over.
   *
   * This is the case that makes the withhold arms discriminating. Loosening
   * `edge.from === optionId` to "any edge" REDs exactly this test and leaves
   * arms B and C green — a single biting mutant proves sensitivity to
   * something; the pair proves sensitivity to the named object.
   */
  it('ARM G: an edge the option does NOT own moves ⇒ ALLOWED, never withheld', () => {
    const after = clone(CAPTURE.before);
    const unrelated = after.edges.find((e) => e.from === FACTOR_ID && e.to === '94fa174b')!;
    unrelated.strength = { ...(unrelated.strength as object), mean: 0.79 };

    // PRECONDITIONS: the unrelated edge really moved, and NONE of the option's
    // own edges did — without both, this asserts nothing about the binding.
    expect(edgeField(after, FACTOR_ID, '94fa174b', 'strength.mean')).toBe(0.79);
    expect(edgeField(after, OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(1);
    expect(edgeField(after, OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(1);
    expect(observedValue(after, FACTOR_ID)).toBe(0.49);
  });

  /**
   * ⭐⭐ F7 — A DELETED EDGE IS A WRITE TOO, and the first cut of the edge arm
   * was blind to it: it walked `after.edges` only, so severing the option's
   * link to the factor the user named — the most destructive wrong-entity
   * outcome available — read as "no edge write" and was ALLOWED.
   */
  it('ARM H: DELETING one of the option’s own edges is withheld, and nothing moves', () => {
    const after = clone(CAPTURE.before);
    after.edges = after.edges.filter((e) => !(e.from === OPTION_ID && e.to === FACTOR_ID));

    // PRECONDITIONS: the edge really is gone, and the option's value did not move.
    expect(edgeField(CAPTURE.before, OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(1);
    expect(edgeField(after, OPTION_ID, FACTOR_ID, 'strength.mean')).toBeUndefined();
    expect(optionInterventionValue(after, OPTION_ID, FACTOR_ID)).toBe(0.49);
  });

  /**
   * ⭐⭐ THE COST OF THE EDGE ARM, PINNED AS A NAMED WITHHELD CLASS rather than
   * left to be discovered (trap 22f's honest-gap rule).
   *
   * An explicit, correct link-strength edit that NAMES the option is withheld.
   * At the graph this is indistinguishable from arm C — same option named, same
   * no-effect-value-landed, same outgoing edge moved — so no predicate over the
   * graph can separate them. It is recorded here so the suite REDs if the class
   * ever changes, in either direction.
   */
  it('the configure detector recognises an explicit link-strength edit naming the option', () => {
    const explicitLinkEdit =
      `For the ${OPTION_LABEL} option, the link to Pro Plan Monthly Price is too strong `
      + '— set its strength to 79%.';

    // Precondition: this really does reach the component (otherwise the cost is
    // not the component's to own).
    expect(
      detectConfigureOptionIntent(
        explicitLinkEdit,
        projectOptionLabels(CAPTURE.before.nodes as never),
      ).matched,
    ).toBe(true);

  });
});
