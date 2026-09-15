/**
 * ⭐⭐⭐ THE DELIBERATE-EDIT COMPONENT'S JOINED ACCEPTANCE — RED-first.
 *
 *   *An ordinary, clear revision to an option's effect WORKS — and its
 *    ambiguous and wrong-entity counterparts CANNOT mutate anything.*
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
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from '../configure-option-intent.js';
import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';
import { decideOptionInterventionWrite } from '../option-intervention-write-guard.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_id: OPTION_ID,
  option_label: OPTION_LABEL,
  factor_id: FACTOR_ID,
  turn_message: MESSAGE,
} = CAPTURE.provenance;

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/**
 * The SECOND option from the same live draft (commit `a3132acf`'s battery:
 * *"Hold Pro Plan Monthly Price at £49 is `is_baseline: true`; Raise It to £59
 * is not"*). Used only by arm F, so the ambiguity case is a shape the producer
 * really emits rather than one invented here (trap 16 — a fixture you wrote
 * yourself is not evidence about the wire).
 */
const SECOND_OPTION_ID = 'a1c2e3f4';
const SECOND_OPTION_LABEL = 'Raise It to £59';

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

/** F — a two-option graph, so a message naming BOTH is genuinely ambiguous. */
function twoOptionGraph(): Graph {
  const graph = clone(CAPTURE.before);
  graph.nodes.push({
    id: SECOND_OPTION_ID,
    kind: 'option',
    label: SECOND_OPTION_LABEL,
    interventions: {
      [FACTOR_ID]: {
        value: 0.59,
        raw_value: 59,
        unit: '£',
        source: 'brief_extraction',
        target_match: { node_id: FACTOR_ID, match_type: 'exact_id', confidence: 'high' },
        value_confidence: 'high',
      },
    },
    provenance: 'ai_inferred',
  });
  graph.edges.push({
    from: SECOND_OPTION_ID,
    to: FACTOR_ID,
    strength: { mean: 1, std: 0.01 },
    exists_probability: 1,
    effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis' },
  });
  return graph;
}

/**
 * The graph the user is left holding.
 *
 * ONE rule, and it is the dispatcher's: a `withhold` clears
 * `effectiveAppliedMutation`, so nothing persists and the PRE-edit graph
 * stands. See the file header for why that linkage is cited rather than
 * re-modelled.
 */
function storedGraph(before: unknown, after: unknown, message: string): unknown {
  const verdict = decideOptionInterventionWrite({
    message,
    before,
    after,
    appliedMutation: true,
  });
  return verdict.verdict === 'withhold' ? before : after;
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
// HALF ONE — THE ORDINARY REVISION WORKS.
// ---------------------------------------------------------------------------

describe('ACCEPTANCE half 1 — an ordinary, clear revision WORKS', () => {
  it('ARM A: the option’s own effect value moves, and the user keeps it', () => {
    const after = revisionLanded();

    // The component recognises it, by identity, as a SUCCESS.
    const verdict = evaluateConfigureOptionOutcome({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
    });
    expect(verdict.status).toBe('honoured');
    expect(verdict.status === 'honoured' && verdict.optionId).toBe(OPTION_ID);

    // And the write is not touched.
    const write = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('allow');

    // AT THE STORED OBJECT: the value the user asked for is what they hold.
    const stored = storedGraph(CAPTURE.before, after, MESSAGE);
    expect(optionInterventionValue(stored, OPTION_ID, FACTOR_ID)).toBe(0.79);
  });
});

// ---------------------------------------------------------------------------
// HALF TWO — THE WRONG-ENTITY COUNTERPARTS CANNOT MUTATE.
// ---------------------------------------------------------------------------

describe('ACCEPTANCE half 2 — the wrong-entity counterparts CANNOT mutate', () => {
  /**
   * ARM B — THE LIVE CAPTURE, VERBATIM. `exists_probability` 1 → 0.79 on
   * `32b7e30c → 6d9a37f3`: *"this causal link exists with 79% probability"*,
   * a different claim from *"this option's effect is 0.79"*.
   */
  it('ARM B: an EDGE `exists_probability` write is withheld, and nothing moves', () => {
    const write = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after: CAPTURE.after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('withhold');
    expect(write.verdict === 'withhold' && write.optionId).toBe(OPTION_ID);
    expect(write.verdict === 'withhold' && write.optionLabel).toBe(OPTION_LABEL);

    const stored = storedGraph(CAPTURE.before, CAPTURE.after, MESSAGE);
    expect(edgeField(stored, OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(1);
    expect(optionInterventionValue(stored, OPTION_ID, FACTOR_ID)).toBe(0.49);
  });

  /**
   * ARM C — THE ORIGINALLY-WITNESSED 2.427 SHAPE, still live today.
   * `configure-option-outcome.ts`'s header records exactly this write.
   */
  it('ARM C: an EDGE `strength.mean` write is withheld, and nothing moves', () => {
    const after = edgeStrengthWrite();
    const write = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('withhold');
    expect(write.verdict === 'withhold' && write.optionId).toBe(OPTION_ID);

    const stored = storedGraph(CAPTURE.before, after, MESSAGE);
    expect(edgeField(stored, OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(1);
    expect(optionInterventionValue(stored, OPTION_ID, FACTOR_ID)).toBe(0.49);
  });

  /**
   * ARM D — the 2.1266 node-baseline shape, reached on a REVISION. The node arm
   * already exists; what was missing was any verdict to gate it.
   */
  it('ARM D: a shared FACTOR baseline write is withheld, and nothing moves', () => {
    const after = factorBaselineWrite();
    const write = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('withhold');
    expect(write.verdict === 'withhold' && write.baselineNodeIds).toEqual([FACTOR_ID]);

    const stored = storedGraph(CAPTURE.before, after, MESSAGE);
    expect(observedValue(stored, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(stored, OPTION_ID, FACTOR_ID)).toBe(0.49);
  });

  /**
   * ⭐ AND THE PRODUCT SAYS NOTHING UNTRUE WHILE DOING IT. The verdict that
   * protects the write is `not_honoured_no_copy`, which carries NO
   * `factorLabels` — so `edit-graph-dispatch.ts`'s `=== 'not_honoured'` text
   * replacement cannot fire and no consumer can compose *"this option has no
   * effect values yet"*, which is false of a revision. The user is told
   * plainly that nothing was saved, by `formatWithheldWriteNotice`, and
   * nothing more.
   */
  it('the protecting verdict carries no copy material for any wrong-entity arm', () => {
    for (const [arm, after] of [
      ['B', CAPTURE.after as unknown],
      ['C', edgeStrengthWrite()],
      ['D', factorBaselineWrite()],
    ] as const) {
      const verdict = evaluateConfigureOptionOutcome({
        message: MESSAGE,
        before: CAPTURE.before,
        after,
      });
      expect(verdict.status, `arm ${arm}`).toBe('not_honoured_no_copy');
      expect(JSON.stringify(verdict), `arm ${arm}`).not.toContain('factorLabels');
    }
  });
});

// ---------------------------------------------------------------------------
// DISCRIMINATION CONTROLS — the guard must not stop discriminating.
// ---------------------------------------------------------------------------

describe('the guard still DISCRIMINATES (controls, not acceptance)', () => {
  /**
   * ARM E — no option named. No option-scoped promise was made, so there is
   * nothing to betray and nothing to withhold. A guard that fired here would
   * discard the measured W1 class of correct, explicitly-requested edits.
   */
  it('ARM E: names no option ⇒ no verdict, and the write is ALLOWED (residual)', () => {
    const after = edgeStrengthWrite();
    // ⚠⚠ RE-GROUNDED. This arm previously used *"Set the effect to 79%."*,
    // which the shipped detector does NOT match at all — so the verdict was
    // `not_configure_intent` and the case never reached option resolution.
    // **It asserted `not_applicable` and passed while pinning a different
    // residual than the one its name claims** (a true measurement of an
    // irrelevant thing). This phrasing is the CAPTURE'S OWN trigger family
    // (`option_value_set`) with the option's name removed, so intent matches,
    // resolution IS attempted, and the decline is the one this arm is about.
    const SUBJECTLESS = "Change the option's Pro Plan Monthly Price to 79%";

    // PRECONDITION: the turn really does reach the component.
    expect(
      detectConfigureOptionIntent(
        SUBJECTLESS,
        projectOptionLabels(CAPTURE.before.nodes as never),
      ).matched,
      'precondition: intent must match, or this measures the detector',
    ).toBe(true);
    // PRECONDITION: no option label is present, which is what makes it subjectless.
    expect(SUBJECTLESS).not.toContain(OPTION_LABEL);

    const verdict = evaluateConfigureOptionOutcome({
      message: SUBJECTLESS,
      before: CAPTURE.before,
      after,
    });
    expect(verdict.status).toBe('not_applicable');
    // THE RESIDUAL, NAMED: resolution was attempted and found no option.
    expect(verdict.status === 'not_applicable' && verdict.reason).toBe('option_not_identified');

    const write = decideOptionInterventionWrite({
      message: SUBJECTLESS,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('allow');
    // Bound by IDENTITY: nothing here is attributed to the option.
    expect(JSON.stringify(write)).not.toContain(OPTION_ID);
  });

  /**
   * ⭐ THE INTENT-LEVEL CONTROL, kept separately and labelled for what it is.
   * *"Set the effect to 79%."* is not recognised as configure intent at all, so
   * it declines one layer EARLIER. Two different facts, two different names —
   * collapsing them is what made ARM E claim more than it measured.
   */
  it('a message that is not configure intent declines earlier, and says so', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: 'Set the effect to 79%.',
      before: CAPTURE.before,
      after: edgeStrengthWrite(),
    });
    expect(verdict).toEqual({ status: 'not_applicable', reason: 'not_configure_intent' });
  });

  /**
   * ARM F — TWO options named. The resolver must decline rather than pick one:
   * guessing is the confident-wrong-answer this whole component exists to
   * remove, and picking one would attribute a write to an option the user may
   * not have meant.
   */
  it('ARM F: names TWO options ⇒ declines by AMBIGUITY, never by guessing', () => {
    const before = twoOptionGraph();
    const after = clone(before);
    const edge = after.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
    edge.strength = { ...(edge.strength as object), mean: 0.79 };

    const namesBoth = `Change the ${OPTION_LABEL} option's ${SECOND_OPTION_LABEL} effect to 79%`;

    // PRECONDITIONS: both labels really are present, and both options really
    // exist in the graph — otherwise this asserts nothing about ambiguity.
    expect(namesBoth).toContain(OPTION_LABEL);
    expect(namesBoth).toContain(SECOND_OPTION_LABEL);
    expect(before.nodes.filter((n) => n.kind === 'option').map((n) => n.id).sort()).toEqual(
      [OPTION_ID, SECOND_OPTION_ID].sort(),
    );

    const verdict = evaluateConfigureOptionOutcome({ message: namesBoth, before, after });
    expect(verdict.status).toBe('not_applicable');
    expect(verdict.status === 'not_applicable' && verdict.reason).toBe('option_label_ambiguous');
  });

  /**
   * ⭐⭐ THE OPPOSITE-DIRECTION TWIN OF ARM F, and it is what proves the
   * ambiguity decline is a DISCRIMINATION rather than a blanket refusal on
   * two-option graphs: the SAME graph, a message naming only ONE option,
   * resolves and protects.
   */
  it('ARM F-TWIN: on the SAME two-option graph, naming ONE option still resolves', () => {
    const before = twoOptionGraph();
    const after = clone(before);
    const edge = after.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
    edge.strength = { ...(edge.strength as object), mean: 0.79 };

    const verdict = evaluateConfigureOptionOutcome({ message: MESSAGE, before, after });
    expect(verdict.status).toBe('not_honoured_no_copy');
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionId).toBe(OPTION_ID);

    const stored = storedGraph(before, after, MESSAGE);
    expect(edgeField(stored, OPTION_ID, FACTOR_ID, 'strength.mean')).toBe(1);
  });

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

    const write = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('allow');
    expect(write.verdict === 'allow' && write.reason).toBe('no_baseline_write');

    // AT THE STORED OBJECT: the user keeps the edit they made.
    const stored = storedGraph(CAPTURE.before, after, MESSAGE);
    expect(edgeField(stored, FACTOR_ID, '94fa174b', 'strength.mean')).toBe(0.79);
  });

  /**
   * ⭐ A NESTED LABEL READING IS ONE READING, NOT TWO CANDIDATES.
   *
   * With `readiness.options` read WHOLE, substring matching can make a short
   * label match inside a longer one. *"Hold Price at £49"* sits inside *"Hold
   * Price at £49 (Status Quo)"*, so a message naming the longer option matches
   * both — and a naive count would call that ambiguous and abstain, silently
   * un-protecting the commonest real graph shape.
   *
   * The opposite-direction twin of ARM F: F proves two GENUINELY distinct
   * labels decline; this proves a nested pair does NOT.
   */
  it('a SHORTER label nested inside the named one does not manufacture ambiguity', () => {
    const before = clone(CAPTURE.before);
    before.nodes.push({
      id: 'b2d4f6a8',
      kind: 'option',
      label: 'Hold Price at £49',
      interventions: {
        [FACTOR_ID]: {
          value: 0.44,
          source: 'brief_extraction',
          target_match: { node_id: FACTOR_ID, match_type: 'exact_id', confidence: 'high' },
        },
      },
      provenance: 'ai_inferred',
    });
    before.edges.push({
      from: 'b2d4f6a8',
      to: FACTOR_ID,
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis' },
    });

    // PRECONDITION: the two labels really are nested, and both really match.
    expect(OPTION_LABEL.includes('Hold Price at £49')).toBe(true);
    expect(MESSAGE).toContain('Hold Price at £49');

    const after = clone(before);
    const edge = after.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
    edge.strength = { ...(edge.strength as object), mean: 0.79 };

    const verdict = evaluateConfigureOptionOutcome({ message: MESSAGE, before, after });
    // The LONGER label is the user's reading, and it is the one that binds.
    expect(verdict.status).toBe('not_honoured_no_copy');
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionId).toBe(OPTION_ID);
  });

  /**
   * ⛔⛔ F2/a — A WRONG-**FACTOR** WRITE IS `honoured` AND COMMITS.
   *
   * The user names the option AND a factor; the edit writes an effect value on
   * the SAME option but a DIFFERENT factor. `interventionsWriteLandedFor` is
   * bound to the OPTION by identity and asks only *"did this option gain or
   * change any key?"* — so a write to the wrong factor satisfies it, the
   * verdict is `honoured`, and the mutation commits.
   *
   * ⚠ THIS IS NOT COVERED BY THIS LANE AND IS PINNED, NOT FIXED. Closing it
   * means resolving WHICH FACTOR the user named — a second natural-language
   * referring-expression predicate, which is precisely the class this estate
   * has ruled unwinnable by better rules (trap 22f). The exit is to ask, not to
   * widen.
   *
   * Pinned exactly so the suite REDs if the class GROWS or SHRINKS. A gap
   * recorded in the suite is honest; a gap invisible to it is how the
   * wrong-entity write survived two guards written against it.
   */
  it('RESIDUAL F2/a: a wrong-FACTOR write on the named option is honoured and COMMITS', () => {
    const after = clone(CAPTURE.before);
    const node = after.nodes.find((n) => n.id === OPTION_ID)!;
    // The user asked about FACTOR_ID; the edit writes a different factor key.
    (node.interventions as Record<string, { value: number }>)['a9f8b0b7'] = { value: 0.79 };

    // PRECONDITIONS: the factor the user NAMED did not move, and a different
    // one did — without both, this is not the wrong-factor shape.
    expect(optionInterventionValue(after, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(after, OPTION_ID, 'a9f8b0b7')).toBe(0.79);
    expect(MESSAGE).toContain('Pro Plan Monthly Price');

    expect(
      evaluateConfigureOptionOutcome({ message: MESSAGE, before: CAPTURE.before, after }).status,
    ).toBe('honoured');
    expect(
      decideOptionInterventionWrite({
        message: MESSAGE, before: CAPTURE.before, after, appliedMutation: true,
      }).verdict,
    ).toBe('allow');
    // AT THE STORED OBJECT: the wrong factor's value is what the user keeps.
    expect(optionInterventionValue(storedGraph(CAPTURE.before, after, MESSAGE), OPTION_ID, 'a9f8b0b7'))
      .toBe(0.79);
  });

  /**
   * ⛔⛔ F2/b — A WRONG-**OPTION** WRITE REACHES A PROTECTING VERDICT AND STILL
   * COMMITS.
   *
   * The outcome verdict is correct — `not_honoured_no_copy` for the option the
   * user named, which gained nothing. The WRITE guard then allows it, because
   * `anyInterventionWriteLanded` is true: an effect value landed SOMEWHERE.
   *
   * ⚠ PINNED, NOT FIXED, AND THE CONJUNCT IS DELIBERATE. The module header
   * states why: *"if an interventions write DID land somewhere, the turn
   * accomplished a real option edit and discarding it would be a new harm."*
   * Removing it would withhold legitimate multi-option edits wholesale — the
   * W1 direction, which destroys user work. Changing that conjunct is a
   * judgement with a blast radius beyond this lane, so it is disclosed.
   */
  it('RESIDUAL F2/b: a wrong-OPTION write is protected in the verdict but COMMITS', () => {
    const before = twoOptionGraph();
    const after = clone(before);
    const other = after.nodes.find((n) => n.id === SECOND_OPTION_ID)!;
    (other.interventions as Record<string, { value: number }>)[FACTOR_ID] = { value: 0.79 };

    // PRECONDITIONS: the NAMED option gained nothing; a DIFFERENT option did.
    expect(optionInterventionValue(after, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(after, SECOND_OPTION_ID, FACTOR_ID)).toBe(0.79);

    // The verdict is right — it is about the option the user named.
    const verdict = evaluateConfigureOptionOutcome({ message: MESSAGE, before, after });
    expect(verdict.status).toBe('not_honoured_no_copy');
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionId).toBe(OPTION_ID);

    // The write is allowed anyway, for the stated reason.
    const write = decideOptionInterventionWrite({
      message: MESSAGE, before, after, appliedMutation: true,
    });
    expect(write.verdict).toBe('allow');
    expect(write.verdict === 'allow' && write.reason).toBe('interventions_write_landed');
    // AT THE STORED OBJECT: the other option's value persists.
    expect(optionInterventionValue(storedGraph(before, after, MESSAGE), SECOND_OPTION_ID, FACTOR_ID))
      .toBe(0.79);
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

    const write = decideOptionInterventionWrite({
      message: MESSAGE, before: CAPTURE.before, after, appliedMutation: true,
    });
    expect(write.verdict).toBe('withhold');
    expect(write.verdict === 'withhold' && write.optionEdgeKeys)
      .toEqual([`${OPTION_ID}->${FACTOR_ID}`]);

    // AT THE STORED OBJECT: the link survives.
    expect(edgeField(storedGraph(CAPTURE.before, after, MESSAGE), OPTION_ID, FACTOR_ID, 'strength.mean'))
      .toBe(1);
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
  it('KNOWN COST: an explicit link-strength edit naming the option is ALSO withheld', () => {
    const after = edgeStrengthWrite();
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

    const write = decideOptionInterventionWrite({
      message: explicitLinkEdit,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(write.verdict).toBe('withhold');
  });
});
