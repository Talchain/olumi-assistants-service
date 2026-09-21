/**
 * ROADMAP 2.281 — THE ENRICHER IS THE ONLY MINT OF `goal_threshold`.
 *
 * ── THE DEFECT THIS CLOSES, MEASURED LIVE ─────────────────────────────────
 * The whole goal-frame train shipped (schemas 0.31.0 · ISL level→delta
 * converter · PLoT frame forwarding · CEE frame stamp #786 · CEE baseline
 * extraction #787) and staging STILL rendered no goal probability. Root cause,
 * pinned across three briefs on 2026-08-01
 * (PHASE0-EVIDENCE-2026-07-28/witness-2258-goal-probability-live.md §5.1/§7.1):
 * on the live draft path THE MODEL minted `goal_threshold` itself.
 *
 * The enricher's redirect — the ONLY code that stamps `goal_threshold_frame`
 * and extracts the goal node's baseline — is gated on
 * `goal_threshold === undefined` (factor-extraction/enricher.ts:652). A
 * model-authored `0.8` closes that gate, so:
 *   · `goal_threshold_frame` was never stamped        (measured: absent, 3/3)
 *   · the goal node got no `observed_state` baseline  (measured: absent, 3/3)
 *   · ISL refused GOAL_THRESHOLD_FRAME_UNSPECIFIED    (measured: fired,  3/3)
 *   · the stated current level was filed as a separate factor node
 *     (`fac_current_revenue`) instead of the goal's baseline
 * #786's and #787's machinery was CORRECT AND UNREACHED. So this is not more
 * machinery — it removes the model's ability to reach past it.
 *
 * ── THE TWO LAYERS, AND WHY NEITHER IS REDUNDANT ──────────────────────────
 * 1. GRAMMAR (cee/draft/anthropic-graph-schema.ts, v15): the quad is removed
 *    from the SENT schema. `nodes.items` is `additionalProperties: false`, so
 *    the key is UNEMITTABLE under constrained decoding, not merely unrequired.
 *    LIMIT: only applies when the grammar is sent. Structured outputs is gated
 *    on CEE_ANTHROPIC_STRUCTURED_OUTPUTS (config default FALSE), a model
 *    allowlist, thinking being off, and no so_reject fallback — and the OpenAI
 *    adapter sends no schema at all (`response_format: json_object`).
 * 2. INGRESS STRIP (adapters/llm/normalisation.ts): removes any model-authored
 *    goal contract at the DRAFT seam, on every real provider, whatever the
 *    structured-outputs posture.
 * Layer 1 stops the tokens; layer 2 stops the persistence. "The enricher is the
 * only mint" is true because of BOTH. Section D proves each independently.
 *
 * ── POSITIVE CONTROLS (trap 13) ───────────────────────────────────────────
 * Every absence assertion here is paired with a run of the SAME predicate over
 * the pre-fix state, which must show the presence. A test that cannot see the
 * defect is not evidence that the defect is gone.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ANTHROPIC_DRAFT_GRAPH_SCHEMA,
  ENRICHER_OWNED_GOAL_KEYS,
  buildDraftGraphSchema,
} from '../../src/cee/draft/anthropic-graph-schema.js';
import {
  CEE_MINTED_GOAL_FIELDS,
  stripModelAuthoredGoalThreshold,
} from '../../src/adapters/llm/normalisation.js';
import { projectDraftRecords } from '../../src/cee/draft/records/index.js';
import { enrichGraphWithFactorsAsync } from '../../src/cee/factor-extraction/enricher.js';
import { CEE_GOAL_THRESHOLD_FRAME } from '../../src/utils/goal-threshold-cap.js';
import type { GraphT } from '../../src/schemas/graph.js';

type AnyRec = Record<string, any>;

/** `nodes.items` on a given draft schema — where the goal quad is declared. */
function nodeItems(schema: AnyRec): AnyRec | undefined {
  return schema?.properties?.nodes?.items;
}

/**
 * THE LIVE SHAPE. A draft response as the witness measured it on staging:
 * the model minted the threshold quad on the goal node itself, and filed the
 * stated current level as a SEPARATE factor node. Reproduced field-for-field so
 * the regression proof is against the real defect, not a convenient stand-in.
 */
function modelAuthoredDraftResponse(): AnyRec {
  return {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we grow revenue?' },
      // The witness's `fac_current_revenue` — the stated level, misfiled.
      {
        id: 'fac_current_revenue',
        kind: 'factor',
        label: 'Current Annual Revenue',
        data: { value: 0.53, extractionType: 'stated', factor_type: 'revenue' },
      },
      {
        id: 'goal_revenue',
        kind: 'goal',
        label: 'Grow Annual Revenue to £6,000,000',
        // ⚠ THE DEFECT: model-authored, unattested, NO frame.
        goal_threshold: 0.8,
        goal_threshold_raw: 6_000_000,
        goal_threshold_unit: '£',
        goal_threshold_cap: 7_500_000,
      },
    ],
    edges: [],
  };
}

/** A minimal graph with a bare goal node — the post-strip ingress shape. */
function graphWithBareGoal(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow Annual Revenue to £6,000,000' },
      { id: 'dec_pricing', kind: 'decision', label: 'How should we grow revenue?' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

/** The same graph, but carrying the model's unattested threshold (pre-fix). */
function graphWithModelAuthoredThreshold(): GraphT {
  const g = graphWithBareGoal() as AnyRec;
  Object.assign(g.nodes[0], {
    goal_threshold: 0.8,
    goal_threshold_raw: 6_000_000,
    goal_threshold_unit: '£',
    goal_threshold_cap: 7_500_000,
  });
  return g as GraphT;
}

const WORKED_BRIEF = 'Grow revenue from 4000000 to a target of 6000000 this year.';
const NO_LEVEL_BRIEF = 'Grow revenue to a target of 6000000 this year.';

// ─────────────────────────────────────────────────────────────────────────
// A. THE GRAMMAR CUT — the model CANNOT emit the quad when the grammar is sent
// ─────────────────────────────────────────────────────────────────────────

describe('2.281 A — the SENT draft grammar cannot emit a goal-threshold quad', () => {
  it('no enricher-owned goal key appears in the SENT grammar', () => {
    const items = nodeItems(buildDraftGraphSchema() as unknown as AnyRec);
    expect(items, 'nodes.items must still exist').toBeTruthy();

    for (const key of ENRICHER_OWNED_GOAL_KEYS) {
      expect(
        Object.keys(items!.properties),
        `${key} must be absent from the SENT grammar — while it is declared, the model ` +
          `can mint an unattested threshold and close the enricher's redirect`,
      ).not.toContain(key);
      expect(items!.required ?? []).not.toContain(key);
    }
  });

  it('UNEMITTABLE, not merely unrequired — additionalProperties:false is the mechanism', () => {
    // This is the whole cannot-emit claim. v9 demoted these fields to OPTIONAL
    // and the model kept emitting them anyway (measured live, 3/3 runs), which
    // is precisely why "optional" is not a fix and removal is.
    const items = nodeItems(buildDraftGraphSchema() as unknown as AnyRec);
    expect(
      items!.additionalProperties,
      'additionalProperties:false is what turns a removed key into an ungrammatical one',
    ).toBe(false);
  });

  it('ANCHOR — every key is present on the BASE object, so the removal removes something', () => {
    // Trap 12 (hand-maintained mirror): if a key were renamed in the base
    // object, the builder would filter a name that is not there — a silent
    // no-op that leaks the field straight back into the sent grammar.
    const baseItems = nodeItems(ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as AnyRec);
    expect(ENRICHER_OWNED_GOAL_KEYS.length).toBe(4);
    for (const key of ENRICHER_OWNED_GOAL_KEYS) {
      expect(
        Object.keys(baseItems!.properties),
        `ANCHOR: '${key}' must exist on the BASE nodes.items object`,
      ).toContain(key);
    }
  });

  it('POSITIVE CONTROL — the absence predicate can SEE a presence', () => {
    // Trap 13. Run the identical predicate over a schema that still carries the
    // quad; it must find it. Without this, section A could pass by testing
    // nothing (e.g. if `nodeItems` silently returned undefined).
    const control = JSON.parse(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA));
    expect(Object.keys(nodeItems(control)!.properties)).toContain('goal_threshold');

    const sent = nodeItems(buildDraftGraphSchema() as unknown as AnyRec);
    expect(Object.keys(sent!.properties)).not.toContain('goal_threshold');
  });

  it('the BASE object is untouched — CEE still TOLERATES the quad at ingress', () => {
    // A stored graph, a repair response, or a prompt-only draft may legitimately
    // carry these fields. Only the SENT grammar loses them.
    const before = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    buildDraftGraphSchema();
    buildDraftGraphSchema();
    expect(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(before);
    for (const key of ENRICHER_OWNED_GOAL_KEYS) {
      expect(Object.keys(nodeItems(ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as AnyRec)!.properties))
        .toContain(key);
    }
    // Idempotent: two builds are byte-identical.
    expect(JSON.stringify(buildDraftGraphSchema())).toBe(JSON.stringify(buildDraftGraphSchema()));
  });

  it('the v13 node-data cut still lands — the two cuts compose, neither overwrites the other', () => {
    // The v15 edit rebuilds the same node-item properties object the v13 cut
    // writes. If it were applied to the pre-v13 object, display_value would
    // silently return to the grammar and the runaway fix would be undone.
    const items = nodeItems(buildDraftGraphSchema() as unknown as AnyRec);
    const data = items!.properties.data?.anyOf?.[0];
    expect(Object.keys(data.properties)).not.toContain('display_value');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B. THE INGRESS STRIP — covers the prompt-only path the grammar cannot reach
// ─────────────────────────────────────────────────────────────────────────

describe('2.281 B — the draft ingress strip', () => {
  it('removes every CEE-minted goal field the model wrote', () => {
    const response = modelAuthoredDraftResponse();
    const result = stripModelAuthoredGoalThreshold(response);

    const goal = response.nodes.find((n: AnyRec) => n.kind === 'goal');
    for (const field of CEE_MINTED_GOAL_FIELDS) {
      expect(goal, `${field} must not survive the draft ingress`).not.toHaveProperty(field);
    }
    expect(result.nodeIds).toEqual(['goal_revenue']);
    expect(result.fields).toContain('goal_threshold');
  });

  it('strips a model-authored FRAME — a fabricated attestation is the worst case', () => {
    // `goal_threshold_frame` is a CODE CONSTANT set on the branch that computes
    // raw/cap. A model-written frame would look attested and be worthless, so
    // the strip covers it even though no LLM output schema declares it.
    const response: AnyRec = {
      nodes: [{
        id: 'g1', kind: 'goal', label: 'G',
        goal_threshold: 0.9, goal_threshold_frame: 'delta',
        goal_baseline: 0.4, goal_baseline_raw: 4,
      }],
    };
    stripModelAuthoredGoalThreshold(response);
    expect(response.nodes[0]).not.toHaveProperty('goal_threshold_frame');
    expect(response.nodes[0]).not.toHaveProperty('goal_baseline');
    expect(response.nodes[0]).not.toHaveProperty('goal_baseline_raw');
  });

  it('strips an explicit null and a legitimate ZERO threshold alike', () => {
    // `in`-based, not truthiness-based: the old nullable grammar taught the
    // model to write explicit nulls, and 0 is a valid threshold that a
    // truthiness check would skip — leaving a model-authored 0 to close the
    // enricher's gate, which is the exact defect.
    const response: AnyRec = {
      nodes: [
        { id: 'g1', kind: 'goal', label: 'A', goal_threshold: null },
        { id: 'g2', kind: 'goal', label: 'B', goal_threshold: 0 },
      ],
    };
    const result = stripModelAuthoredGoalThreshold(response);
    expect(response.nodes[0]).not.toHaveProperty('goal_threshold');
    expect(response.nodes[1]).not.toHaveProperty('goal_threshold');
    expect(result.nodeIds).toEqual(['g1', 'g2']);
  });

  it('touches nothing else — other nodes, other fields, and non-goal nodes are preserved', () => {
    const response = modelAuthoredDraftResponse();
    stripModelAuthoredGoalThreshold(response);

    const factor = response.nodes.find((n: AnyRec) => n.id === 'fac_current_revenue');
    expect(factor.data.value).toBe(0.53);
    expect(response.nodes.find((n: AnyRec) => n.id === 'dec_pricing')).toBeTruthy();
    expect(response.nodes.find((n: AnyRec) => n.kind === 'goal').label)
      .toBe('Grow Annual Revenue to £6,000,000');
  });

  it('no-ops safely on absent / malformed input', () => {
    expect(stripModelAuthoredGoalThreshold(undefined).nodeIds).toEqual([]);
    expect(stripModelAuthoredGoalThreshold({}).nodeIds).toEqual([]);
    expect(stripModelAuthoredGoalThreshold({ nodes: 'not-an-array' }).nodeIds).toEqual([]);
    expect(stripModelAuthoredGoalThreshold({ nodes: [null, 3] }).nodeIds).toEqual([]);
    // A clean draft (post-grammar-cut) reports nothing stripped, so the log line
    // fires only on a real model-authored contract.
    expect(stripModelAuthoredGoalThreshold({
      nodes: [{ id: 'g1', kind: 'goal', label: 'G' }],
    }).nodeIds).toEqual([]);
  });

  /**
   * ⭐⭐ THE CLASS THIS FILE'S CORPUS COULD NOT SEE — and that omission is why a
   * purely-destructive strip survived on the Anthropic path for a whole cutover.
   *
   * Every other fixture here is `modelAuthoredDraftResponse()`: a graph the
   * MODEL wrote. Swept with a contrast control,
   * `applyStatedGoalTarget|projectDraftRecords|projectRecordsToGraph` occurred
   * ZERO times in this file against `modelAuthoredDraftResponse` → 4. So the
   * corpus contained no CEE-MINTED input at all, and a predicate that cannot
   * tell the two apart looked perfectly correct against it (trap 22: a corpus
   * drawn from the author's head cannot see the class the author did not
   * imagine).
   *
   * This case is deliberately NOT an assertion that the strip spares a projected
   * value — it does not, and cannot, because it keys on presence alone. It pins
   * the SHAPE the strip is indifferent to, so the next reader of this file meets
   * the distinction the code does not make, and any future attempt to give the
   * strip a provenance-aware exemption has a fixture to write against.
   */
  it('CANNOT DISTINGUISH a CEE-minted target from a model-authored one — presence is its only test', () => {
    // Produced by the REAL projector through its exported entry point, not
    // hand-typed, so this fixture cannot drift into describing a shape CEE no
    // longer mints (trap 16-inverse: a self-authored input encodes the author's
    // model of the producer rather than the producer).
    const seam = projectDraftRecords({
      stated_items: [
        { kind: 'goal', source_quote: 'Reach £30k MRR Within 18 Months', value: 30_000, unit: '£', role: 'target' },
        { kind: 'option', source_quote: 'hire two AEs' },
        { kind: 'option', source_quote: 'launch self-serve' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Sales capacity', basis: [0], category: 'controllable' },
        { claim_kind: 'causal_link', label: 'capacity drives MRR', basis: [0], from_claim: 0, to_stated: 0, effect: 'positive' },
      ],
    }, 'We need to reach £30k MRR within 18 months.');
    expect(seam.ok, seam.ok ? '' : `projection failed: ${JSON.stringify(seam)}`).toBe(true);
    if (!seam.ok) return;

    const graph: AnyRec = { ...seam.projection.graph };
    const goal: AnyRec = graph.nodes.find((n: AnyRec) => n.kind === 'goal');

    // The projector minted the quintet from ONE derivation…
    expect(goal.goal_threshold_raw).toBe(30_000);
    expect(goal.goal_threshold_unit).toBe('£');
    expect(goal.goal_threshold_frame).toBe(CEE_GOAL_THRESHOLD_FRAME);

    const result = stripModelAuthoredGoalThreshold(graph);

    // …and the strip deletes it exactly as it deletes a model's. This is the
    // MEASURED behaviour, not the desired one: on the ANTHROPIC draft path this
    // input is the ONLY input the strip can receive, which is why that call site
    // was removed rather than the function. `openai.ts` still calls it, and there
    // the model genuinely is the only possible author.
    expect(result.nodeIds).toEqual([goal.id]);
    for (const field of CEE_MINTED_GOAL_FIELDS) {
      if (field.startsWith('goal_baseline')) continue; // never minted by the projector
      expect(goal).not.toHaveProperty(field);
    }
  });

  it('the field list covers every goal_* field the node schema declares (trap 12)', async () => {
    // DERIVED, not mirrored. If someone adds a new `goal_*` field to
    // schemas/graph.ts and forgets this list, the new field silently becomes
    // model-writable — the exact defect class this whole change exists to close.
    const graphSrc = readFileSync(
      fileURLToPath(new URL('../../src/schemas/graph.ts', import.meta.url)),
      'utf8',
    );
    const declared = new Set<string>();
    for (const m of graphSrc.matchAll(/^\s{2}(goal_[a-z_]+):\s*(?:z\.|Goal)/gm)) {
      declared.add(m[1]);
    }
    // SET EQUALITY, both directions — not "every found field is listed".
    // A one-directional check passes vacuously if the scan under-matches (the
    // pattern assumes the file's 2-space field indentation); asserting equality
    // means a regex that silently stops finding fields REDs here instead of
    // quietly certifying a list it never really checked. Trap 13, applied to
    // this test's own control rather than only to the product.
    expect(
      [...declared].sort(),
      'the scan must recover EXACTLY the CEE-minted field set — if these diverge, either a new ' +
        'goal_* field was added without deciding whether a model may author it, or this scan ' +
        'has stopped seeing the declarations it claims to check',
    ).toEqual([...CEE_MINTED_GOAL_FIELDS].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// C. END-TO-END — the worked example mints, attests, and carries a baseline
// ─────────────────────────────────────────────────────────────────────────

describe('2.281 C — the worked example, from model response to persisted graph', () => {
  it('THE REGRESSION PROOF: model-authored draft → strip → enricher mints an ATTESTED threshold', async () => {
    // The full live scenario, composed exactly as the draft path composes it:
    // the adapter strips the model's contract, then Stage 3 enriches.
    const response = modelAuthoredDraftResponse();
    stripModelAuthoredGoalThreshold(response);

    const graph = graphWithBareGoal() as AnyRec;
    graph.nodes[0].label = response.nodes.find((n: AnyRec) => n.kind === 'goal').label;

    const out = await enrichGraphWithFactorsAsync(graph as GraphT, WORKED_BRIEF);
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as AnyRec;

    // Brief: "from 4000000 to a target of 6000000".
    //   cap  = 6,000,000 × 1.25 (25% headroom, no '%', no existing cap) = 7,500,000
    //   thr  = 6,000,000 / 7,500,000 = 0.8
    //   base = 4,000,000 / 7,500,000 = 0.5333…   ← THE SAME DENOMINATOR
    expect(goal.goal_threshold).toBeCloseTo(0.8, 10);
    expect(goal.goal_threshold_raw).toBe(6_000_000);
    expect(goal.goal_threshold_cap).toBe(7_500_000);
    expect(goal.goal_threshold_frame).toBe(CEE_GOAL_THRESHOLD_FRAME);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_baseline).toBeCloseTo(4_000_000 / 7_500_000, 10);
    expect(goal.goal_baseline_raw).toBe(4_000_000);

    // The two operands share ONE denominator — ISL's `threshold − baseline`
    // is only meaningful if they do, and a mismatch yields a confident WRONG
    // probability rather than an error.
    expect(goal.goal_threshold_raw / goal.goal_threshold_cap).toBeCloseTo(goal.goal_threshold, 10);
    expect(goal.goal_baseline_raw / goal.goal_threshold_cap).toBeCloseTo(goal.goal_baseline, 10);
  });

  it('POSITIVE CONTROL / RED-FIRST — WITHOUT the strip the gate stays shut and NOTHING is attested', async () => {
    // This is the pre-fix world, run through the identical assertions. It
    // reproduces the live witness exactly: the 0.8 survives, but it is the
    // MODEL's 0.8 — no frame, no baseline — so ISL refuses.
    //
    // This control is what makes the test above evidence rather than theatre:
    // remove the strip from the draft adapter and this state is what ships.
    const out = await enrichGraphWithFactorsAsync(graphWithModelAuthoredThreshold(), WORKED_BRIEF);
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as AnyRec;

    expect(goal.goal_threshold).toBe(0.8);            // indistinguishable on its own…
    expect(goal.goal_threshold_frame).toBeUndefined(); // …but UNATTESTED — the live defect
    expect(goal.goal_baseline).toBeUndefined();
    expect(goal.goal_baseline_raw).toBeUndefined();
  });

  it('ABSENCE CONTROL — no stated level ⇒ threshold + frame, but NO baseline (honest refusal downstream)', async () => {
    const out = await enrichGraphWithFactorsAsync(graphWithBareGoal(), NO_LEVEL_BRIEF);
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as AnyRec;

    expect(goal.goal_threshold).toBeCloseTo(0.8, 10);
    expect(goal.goal_threshold_frame).toBe('level');
    // No baseline was STATED, so none is invented. ISL then declines to produce
    // a probability rather than guessing one — which is the honest behaviour.
    expect(goal.goal_baseline).toBeUndefined();
    expect(goal.goal_baseline_raw).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D. WIRING — the strip is called on the DRAFT seam and NOT on the repair seam
// ─────────────────────────────────────────────────────────────────────────

describe('2.281 D — the strip is wired to draft ingress only', () => {
  // Read as UTF-8 rather than grepped: CEE carries deliberate NUL sentinels in
  // some sources and plain grep is silently blind to those files (trap 17).
  const adapterSrc = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../src/adapters/llm/${name}`, import.meta.url)), 'utf8');

  /**
   * ⚠⚠ THIS EXPECTATION MOVED DELIBERATELY, AND THE ASYMMETRY IS THE FINDING.
   *
   * It used to loop over BOTH adapters asserting `callSites.length === 1`. That
   * was right when both adapters handed the strip the MODEL's own JSON. It is no
   * longer right for `anthropic.ts`, because the records cutover put a CEE MINT
   * above the strip on that path:
   *
   *     projectDraftRecords(rawJson, brief)      ← applyStatedGoalTarget mints
   *   → rawJson = { ...activeProjection.graph }
   *   → stripModelAuthoredGoalThreshold(rawJson) ← deleted what CEE just minted
   *
   * The strip's own premise — "at this seam no legitimate, attested threshold
   * can exist yet" — was FALSE there, so it removed 100 % CEE-minted values and
   * 0 % model-authored ones, and the user's stated target vanished from the
   * canvas. `openai.ts` has no projection seam (swept with a contrast control:
   * `projectDraftRecords|activeProjection|projectRecordsToGraph` → 0, against
   * `rawJson` → 15 in the same file, same run), so its premise still holds and
   * its call site STAYS.
   *
   * The defect was CALL-SITE-SCOPED, not function-scoped. The behavioural
   * discriminating pair lives in
   * `src/adapters/llm/__tests__/projector-goal-target-survives-draft.test.ts`;
   * what THIS test still owns is the wiring — so it now asserts the two adapters
   * SEPARATELY rather than pretending they answer the same question (trap 21).
   */
  it('openai.ts: strips exactly once, and BEFORE the draft normalisation', () => {
    const src = adapterSrc('openai.ts');
    const callSites = [...src.matchAll(/\bstripModelAuthoredGoalThreshold\(/g)];
    const normSites = [...src.matchAll(/\bnormaliseDraftResponse\(/g)];

    // ONE normalisation site. There used to be two (draft, then repair);
    // ROADMAP 2.763 retired the LLM repair seam entirely, so the repair site is
    // gone. If a repair seam is ever re-introduced, this REDs at 2 and the
    // reviewer must re-decide where the strip belongs.
    expect(normSites.length, 'expected exactly the draft site (repair seam retired, 2.763)').toBe(1);
    // Exactly ONE strip — the draft one. Historically a second would have hit
    // the repair path, which ran at Stage 4 AFTER Stage 3 had enriched, and
    // would have deleted a threshold the enricher had already minted.
    expect(
      callSites.length,
      'the strip must be wired to the OpenAI draft seam exactly once — this path ' +
        'has no projection above it, so the model IS the only possible author',
    ).toBe(1);
    // …and it must run before the draft normalisation, so the degenerate-cap
    // repair below it can never "repair" a quad that is about to be deleted.
    expect(callSites[0].index!).toBeLessThan(normSites[0].index!);
  });

  it('anthropic.ts: does NOT strip — the projector mints above this seam', () => {
    const src = adapterSrc('anthropic.ts');
    const callSites = [...src.matchAll(/\bstripModelAuthoredGoalThreshold\(/g)];
    expect(
      callSites.length,
      'the strip must not run after the projection seam: on this path its only ' +
        'possible input is CEE-minted, so it can delete nothing else',
    ).toBe(0);

    // ⭐ PRECONDITION PINNED IN-TEST, so this is not a vacuous zero. The claim
    // is "no strip AFTER A PROJECTION", not "no strip anywhere" — if the
    // projection seam were removed from this adapter, a bare 0 would silently
    // start certifying an unprotected path (trap 13b).
    expect(
      [...src.matchAll(/\bprojectDraftRecords\(/g)].length,
      'the projection seam is what makes the strip wrong here — if it is gone, ' +
        'this test is asserting the wrong thing and the strip must be re-decided',
    ).toBe(1);
  });

  it('the strip itself is still exported and still wired somewhere — not quietly deleted', () => {
    // The fix was to remove ONE call site, never the function. Without this,
    // deleting `stripModelAuthoredGoalThreshold` outright would leave every
    // assertion above green while the OpenAI path lost its only defence.
    const openai = adapterSrc('openai.ts');
    expect(openai).toContain('stripModelAuthoredGoalThreshold');
    expect(typeof stripModelAuthoredGoalThreshold).toBe('function');
  });
});
