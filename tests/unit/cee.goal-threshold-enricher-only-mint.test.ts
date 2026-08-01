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
    expect(declared.size, 'the scan must find the goal fields, or it proves nothing').toBeGreaterThan(0);
    for (const field of declared) {
      expect(
        CEE_MINTED_GOAL_FIELDS as readonly string[],
        `schemas/graph.ts declares '${field}' but CEE_MINTED_GOAL_FIELDS does not list it — ` +
          `a model could author it and CEE would persist it unattested`,
      ).toContain(field);
    }
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

  for (const adapter of ['anthropic.ts', 'openai.ts']) {
    it(`${adapter}: strips exactly once, and BEFORE the draft normalisation`, () => {
      const src = adapterSrc(adapter);
      const callSites = [...src.matchAll(/\bstripModelAuthoredGoalThreshold\(/g)];
      const normSites = [...src.matchAll(/\bnormaliseDraftResponse\(/g)];

      // Two normalisation sites exist per adapter: draft, then repair.
      expect(normSites.length, 'expected a draft site and a repair site').toBe(2);
      // Exactly ONE strip — the draft one. A second would hit the repair path,
      // which runs at Stage 4 AFTER Stage 3 has enriched, and would delete a
      // threshold the enricher had already minted and attested.
      expect(
        callSites.length,
        'the strip must NOT be wired to the repair seam — it would destroy an attested threshold',
      ).toBe(1);
      // …and it must run before the draft normalisation, so the degenerate-cap
      // repair below it can never "repair" a quad that is about to be deleted.
      expect(callSites[0].index!).toBeLessThan(normSites[0].index!);
    });
  }
});
