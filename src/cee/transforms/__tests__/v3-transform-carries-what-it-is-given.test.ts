/**
 * ⭐⭐⭐ THE COMPLETENESS CHECK A WHITELIST LACKS BY CONSTRUCTION.
 *
 * `transformNodeToV3` / `transformEdgeToV3` rebuild each record from an
 * ENUMERATED object literal. Anything not named is dropped, and **nothing REDs**
 * — there is no exhaustiveness check over a fresh object literal, so the loss is
 * invisible to the compiler, to every existing test, and to code review.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN THE DEFENCE THAT WAS ALREADY THERE ──────
 * `schema-v2.ts`'s `V1Node` states the mechanism THREE times in its own
 * comments — *"the transform rebuilds each node field-by-field and drops
 * anything it does not name"* — and names a defence:
 *
 *     "⭐ The typecheck is the mechanism here, not the documentation. Adding the
 *      carry in schema-v3.ts without this line fails to compile."
 *
 * ⛔ **THAT DEFENCE DOES NOT HOLD, AND EDGE `id` IS THE PROOF.** `V1Edge`
 * DECLARES `id?: string` (`schema-v2.ts:157`) and `transformEdgeToV3` drops it
 * anyway. The typecheck only bites in one direction: it stops you CARRYING a
 * field the input type does not declare. It cannot notice a declared field you
 * FAIL to carry, because the output is a fresh literal, the input field is
 * optional, and nothing relates the two. **Measured consequence: 2 of 242,731
 * live edges carry an id.**
 *
 * ── ⛔⛔ AND WHY THE FIXTURE IS DERIVED FROM THE INTERFACE, NOT TYPED OUT ─────
 * The first version of this file hand-wrote the fixtures and claimed they were
 * *"built from V1Edge's declaration"*. **A hand-written fixture is the very
 * hand-maintained mirror this check exists to abolish, and it had ALREADY
 * drifted on the day it was written: `FULL_V1_NODE` omitted `data`, so the one
 * field its own `NODE_RESHAPED` set excused could not be observed at all.** A
 * field absent from the fixture cannot be seen being dropped — the check reads
 * green about a field it never sent.
 *
 * ⭐ So the declared field set is **derived at runtime from `schema-v2.ts`
 * itself**, via the TypeScript compiler API, and the fixture is asserted to
 * cover it. Add a field to `V1Node`/`V1Edge` and this file REDs until someone
 * says what happens to it.
 *
 * ⚠ **IT HAS TO BITE AT RUNTIME, NOT AT THE TYPE LAYER — derived, not assumed:**
 * the sole required context on `staging` is `Lint, TypeCheck, Unit Tests`
 * (`gh api .../branches/staging/protection`), whose typecheck step is
 * `pnpm build` over `tsconfig.build.json`, and that config **excludes `*.test.ts` files**. A `satisfies`/`Required<>` guard in a spec file is invisible
 * to the only gate that can block a merge. The `Required<>` annotations below
 * are kept as a second belt — they are caught by the advisory `Typecheck Drift`
 * job — but the load-bearing guard is the runtime assertion.
 *
 * ⚠ WHY THE PINS ARE EXACT SETS AND NOT MAXIMA. Each REDs if the set GROWS (a
 * new silent drop shipped) and equally if it SHRINKS (a drop was fixed, or a
 * reshape stopped happening, and the pin is now lying about the transform). A
 * "no more than N" assertion would let a fix and a regression cancel out.
 *
 * ⚠ AND WHY A RESHAPE IS BOUND TO ITS DESTINATION. Naming a field "reshaped" in
 * a set is an unaudited excuse: the field stays excused after the reshape stops
 * happening. Every entry below carries an assertion that the VALUE arrived
 * somewhere, so "reshaped" is a measured claim rather than a label.
 *
 * ⚠ AND WHY IT IS NOT A CORPUS DIFF. The obvious instrument — diff banked V1
 * payloads against banked V3 payloads — was tried and is WORTHLESS here: **zero
 * banked payloads carry both shapes**, so it compares two disjoint populations
 * and manufactures drops that never happened. It produced a confident
 * seventeen-field list, none of it supported. Only a PAIRED comparison, which
 * is what running the transform gives you, can answer this.
 *
 * ⚠⚠ SCOPE, STATED NARROWLY (trap 16 — a capture proves what it was pointed at).
 * This file measures `transformNodeToV3` and `transformEdgeToV3` ONLY. It is not
 * a claim about the graph-level transform: an option node's `data.interventions`
 * is genuinely absent from `transformNodeToV3`'s output and is assembled instead
 * by `transformGraphToV3` (`schema-v3.ts:1463`). That is recorded below as a
 * graph-level carrier, not as a silent drop.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { transformEdgeToV3, transformNodeToV3 } from '../schema-v3.js';
import type { V1Edge, V1FactorData, V1Node, V1OptionData } from '../schema-v2.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE DERIVATION: the declared field set, read from the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_V2_PATH = fileURLToPath(new URL('../schema-v2.ts', import.meta.url));

/**
 * Every property name declared on `interfaceName` in `schema-v2.ts`.
 *
 * Uses the TypeScript compiler API rather than a regex: a regex over an
 * interface body picks up member names of nested object types (`range?: { min:
 * number }` would contribute `min`) and anything inside a comment, and would be
 * a second, quieter mirror of the same declaration.
 *
 * Throws rather than returning `[]` — an unreadable result is a hard error, not
 * a pass. A silent empty set here would make every assertion below vacuous.
 */
function declaredFields(interfaceName: string): readonly string[] {
  const source = readFileSync(SCHEMA_V2_PATH, 'utf8');
  const sourceFile = ts.createSourceFile(
    SCHEMA_V2_PATH,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  let names: string[] | undefined;
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      names = node.members
        .filter(ts.isPropertySignature)
        .map((member) => (ts.isIdentifier(member.name) ? member.name.text : undefined))
        .filter((name): name is string => name !== undefined);
    }
  });

  if (names === undefined) {
    throw new Error(`declaredFields: no interface named ${interfaceName} in ${SCHEMA_V2_PATH}`);
  }
  if (names.length === 0) {
    throw new Error(`declaredFields: ${interfaceName} parsed to zero members — the probe is blind`);
  }
  return names;
}

const DECLARED_EDGE_FIELDS = declaredFields('V1Edge');
const DECLARED_NODE_FIELDS = declaredFields('V1Node');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES. `Required<>` is the compile-layer belt; the runtime coverage
// assertion below is the guard that reaches the required check.
// ─────────────────────────────────────────────────────────────────────────────

const FULL_V1_EDGE: Required<V1Edge> = {
  id: 'e_stable_001',
  from: 'fac_a',
  to: 'goal_b',
  weight: 0.4,
  belief: 0.7,
  provenance: { source: 'ai' },
  provenance_source: 'ai',
  effect_direction: 'positive',
  strength_mean: 0.5,
  strength_std: 0.1,
  belief_exists: 0.8,
  origin: 'ai',
  edge_type: 'directed',
};

const FACTOR_DATA: V1FactorData = {
  value: 0.3,
  baseline: 0.2,
  unit: 'GBP',
  raw_value: 30,
  cap: 100,
  range: { min: 0, max: 1 },
  extractionType: 'explicit',
  confidence: 0.9,
  rangeMin: 0,
  rangeMax: 1,
  factor_type: 'cost',
  uncertainty_drivers: ['supplier quotes vary'],
  encoding_map: { '0': 'Developers' },
};

const OPTION_DATA: V1OptionData = {
  interventions: { fac_a: 1 },
  raw_interventions: { fac_a: 10 },
  intervention_details: {
    fac_a: { raw_value: 10, unit: 'GBP', source: 'brief_extraction', reasoning: 'stated in brief' },
  },
  is_baseline: true,
};

function fullV1Node(kind: string, data: V1FactorData | V1OptionData): Required<V1Node> {
  return {
    id: 'n_1',
    kind,
    label: 'Label',
    body: 'body text',
    data,
    category: 'observable',
    goal_threshold: 0.8,
    goal_threshold_raw: 80,
    goal_threshold_unit: '%',
    goal_threshold_cap: 100,
    goal_threshold_frame: 'level',
    goal_baseline: 0.5,
    goal_baseline_raw: 50,
    scale_frame: 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLANATIONS. A lost key is explained by a RESHAPE (with an assertion that the
// value arrived) or by a KNOWN-DROPPED pin (an honest, failing-loud gap).
// ─────────────────────────────────────────────────────────────────────────────

type Out = Record<string, unknown>;
interface Reshape {
  /** Where the value goes. Named for the reader; the assertion is the evidence. */
  readonly to: string;
  readonly arrived: (out: Out) => void;
}

const EDGE_RESHAPED: Readonly<Record<string, Reshape>> = {
  weight: {
    to: 'strength.mean (legacy name; strength_mean wins when both are present)',
    arrived: (out) => expect((out.strength as Out | undefined)?.mean).toBe(0.5),
  },
  strength_mean: {
    to: 'strength.mean',
    arrived: (out) => expect((out.strength as Out | undefined)?.mean).toBe(0.5),
  },
  strength_std: {
    to: 'strength.std',
    arrived: (out) => expect((out.strength as Out | undefined)?.std).toBe(0.1),
  },
  belief: {
    to: 'exists_probability (legacy name; belief_exists wins when both are present)',
    arrived: (out) => expect(out.exists_probability).toBe(0.8),
  },
  belief_exists: {
    to: 'exists_probability',
    arrived: (out) => expect(out.exists_probability).toBe(0.8),
  },
  provenance_source: {
    to: 'provenance_display',
    arrived: (out) => expect(out.provenance_display).toBe('ai_inferred'),
  },
};

/**
 * ⛔ GENUINELY LOST — no V3 carrier at all. Being fixed by Core at the time of
 * writing (one line in `transformEdgeToV3`, plus an OPTIONAL declaration on
 * `EdgeV3Schema`, which is `.passthrough()` so the value flows today).
 *
 * ⭐ WHEN THAT LANDS THIS TEST GOES RED, AND THAT IS CORRECT — the pin is a
 * statement about the transform's current behaviour, so a fix must update it
 * rather than pass silently. Move `id` out of this set; do not widen the
 * assertion.
 */
const EDGE_KNOWN_DROPPED: ReadonlySet<string> = new Set(['id']);

/** Per-kind explanations for `transformNodeToV3`. The node transform branches on
 * `kind`, so a single fixture certifies a single limb and nothing else. */
interface NodeCase {
  readonly kind: string;
  readonly data: V1FactorData | V1OptionData;
  readonly reshaped: Readonly<Record<string, Reshape>>;
  readonly knownDropped: ReadonlySet<string>;
}

const BODY_TO_DESCRIPTION: Reshape = {
  to: 'description (schema-v3.ts:332)',
  arrived: (out) => expect(out.description).toBe('body text'),
};

const NODE_CASES: readonly NodeCase[] = [
  {
    kind: 'goal',
    data: FACTOR_DATA,
    reshaped: {
      body: BODY_TO_DESCRIPTION,
      goal_baseline: {
        to: 'observed_state.baseline and .value (schema-v3.ts:438-440)',
        arrived: (out) => {
          expect((out.observed_state as Out | undefined)?.baseline).toBe(0.5);
          expect((out.observed_state as Out | undefined)?.value).toBe(0.5);
        },
      },
      goal_baseline_raw: {
        to: 'observed_state.raw_value (schema-v3.ts:443)',
        arrived: (out) => expect((out.observed_state as Out | undefined)?.raw_value).toBe(50),
      },
      data: {
        // ⚠ On a goal WITH a baseline the goal limb wins and `data`'s own value
        // is deliberately superseded (schema-v3.ts:390-406 — "the minted
        // baseline died here"). What survives of `data` is its encoding map.
        to: 'encoding_map; observed_state is built from goal_baseline, not from data',
        arrived: (out) => expect(out.encoding_map).toEqual({ '0': 'Developers' }),
      },
    },
    knownDropped: new Set(),
  },
  {
    kind: 'factor',
    data: FACTOR_DATA,
    reshaped: {
      body: BODY_TO_DESCRIPTION,
      data: {
        to: 'observed_state, encoding_map, display_value',
        arrived: (out) => {
          expect((out.observed_state as Out | undefined)?.value).toBe(0.3);
          expect((out.observed_state as Out | undefined)?.raw_value).toBe(30);
          expect(out.encoding_map).toEqual({ '0': 'Developers' });
          expect(out.display_value).toBe('£30');
        },
      },
    },
    // Goal-only fields. `transformNodeToV3` builds the baseline limb under
    // `kind === "goal"` (schema-v3.ts:395), so on a factor they have no carrier
    // — which is correct, not a defect, and pinned here so it stays visible.
    knownDropped: new Set(['goal_baseline', 'goal_baseline_raw']),
  },
  {
    kind: 'option',
    data: OPTION_DATA,
    reshaped: { body: BODY_TO_DESCRIPTION },
    // ⚠ `data` on an option carries the interventions, and `transformNodeToV3`
    // has NO carrier for it: the option's interventions are assembled by
    // `transformGraphToV3` (schema-v3.ts:1463) instead. Pinned as dropped BY
    // THIS FUNCTION, with the graph-level carrier named — scoped, not excused.
    knownDropped: new Set(['data', 'goal_baseline', 'goal_baseline_raw']),
  },
];

function keysLost(input: Record<string, unknown>, output: Out): Set<string> {
  return new Set(Object.keys(input).filter((k) => !(k in output)));
}

/** The exact-set pin, both directions, for one paired input/output. */
function assertLossIsExactlyExplained(
  label: string,
  input: Record<string, unknown>,
  out: Out,
  reshaped: Readonly<Record<string, Reshape>>,
  knownDropped: ReadonlySet<string>,
): void {
  const lost = keysLost(input, out);

  const unexplained = [...lost]
    .filter((k) => !(k in reshaped) && !knownDropped.has(k))
    .sort();
  expect(
    unexplained,
    `${label}: a declared field was silently dropped that is neither a measured ` +
      'reshape nor a pinned known drop. An enumerated rebuild loses anything it ' +
      'does not name and nothing else will tell you.',
  ).toEqual([]);

  // The mirror: an explanation for a field that is NO LONGER lost means this
  // pin is lying about the transform. Fix the pin; do not widen the assertion.
  const staleDropClaims = [...knownDropped].filter((k) => !lost.has(k)).sort();
  expect(
    staleDropClaims,
    `${label}: a field pinned as dropped now survives the transform — the fix ` +
      'landed and this pin is stale. Remove it from the known-dropped set.',
  ).toEqual([]);

  const staleReshapeClaims = Object.keys(reshaped).filter((k) => !lost.has(k)).sort();
  expect(
    staleReshapeClaims,
    `${label}: a field explained as reshaped is now carried under its own name. ` +
      'The explanation is stale — remove it.',
  ).toEqual([]);

  // …and every reshape is MEASURED, not merely named.
  for (const [field, reshape] of Object.entries(reshaped)) {
    expect(lost.has(field), `${label}: ${field} is listed as reshaped but is not lost`).toBe(true);
    reshape.arrived(out);
  }
}

describe('V3 transform — it carries what it is given, or the loss is pinned', () => {
  it('CONTROL: the declared field set is genuinely derived from schema-v2.ts', () => {
    // Positive control — the parse SEES something, and sees a plausible amount
    // of it (trap 13e: a control that fires can still be lossy enough to
    // manufacture a zero, so check the magnitude, not just the sign).
    expect(DECLARED_EDGE_FIELDS.length).toBeGreaterThanOrEqual(10);
    expect(DECLARED_NODE_FIELDS.length).toBeGreaterThanOrEqual(10);
    expect(DECLARED_EDGE_FIELDS).toContain('id');
    expect(DECLARED_EDGE_FIELDS).toContain('from');
    expect(DECLARED_NODE_FIELDS).toContain('scale_frame');

    // Contrast control — the probe DISCRIMINATES rather than returning a
    // plausible set for anything asked of it.
    expect(DECLARED_EDGE_FIELDS).not.toContain('scale_frame');
    expect(DECLARED_NODE_FIELDS).not.toContain('edge_type');
    expect(() => declaredFields('V1EdgeThatDoesNotExist')).toThrow(/no interface named/);

    // …and the compiler API is reading MEMBERS, not text: `range` is a nested
    // object type inside V1FactorData and must not leak into either set.
    expect(DECLARED_NODE_FIELDS).not.toContain('min');
    expect(DECLARED_NODE_FIELDS).not.toContain('max');
  });

  it('⭐ THE GUARD: the fixtures cover every field the interfaces declare', () => {
    // This is the assertion that REDs in the required check when someone adds a
    // field to V1Node/V1Edge. Without it the fixture is a hand-maintained
    // mirror, and a field it forgets is a field the drop-check cannot see.
    const edgeUncovered = DECLARED_EDGE_FIELDS.filter((f) => !(f in FULL_V1_EDGE)).sort();
    expect(
      edgeUncovered,
      'V1Edge declares a field the fixture does not populate. Add it to ' +
        'FULL_V1_EDGE, then say what transformEdgeToV3 does with it.',
    ).toEqual([]);

    for (const { kind, data } of NODE_CASES) {
      const uncovered = DECLARED_NODE_FIELDS.filter((f) => !(f in fullV1Node(kind, data))).sort();
      expect(
        uncovered,
        `V1Node declares a field the ${kind} fixture does not populate. Add it to ` +
          'fullV1Node, then say what transformNodeToV3 does with it.',
      ).toEqual([]);
    }
  });

  it('EDGE: the lost set is EXACTLY the measured reshapes plus the pinned drops', () => {
    const { edge } = transformEdgeToV3(FULL_V1_EDGE, 0, []);
    assertLossIsExactlyExplained(
      'transformEdgeToV3',
      FULL_V1_EDGE as unknown as Record<string, unknown>,
      edge as unknown as Out,
      EDGE_RESHAPED,
      EDGE_KNOWN_DROPPED,
    );
  });

  it('EDGE: `id` is the measured instance — and the POSITIVE CONTROL that this probe can see', () => {
    // Without this, every assertion above would pass identically if the fixture
    // were empty or the transform returned its input unchanged (trap 13).
    const { edge } = transformEdgeToV3(FULL_V1_EDGE, 0, []);
    const out = edge as unknown as Out;
    expect(FULL_V1_EDGE.id).toBeDefined();
    expect(out.id).toBeUndefined();
    // …and the contrast: fields on the SAME record that ARE carried, proving
    // the probe discriminates rather than reading every field as absent.
    expect(out.from).toBe('fac_a');
    expect(out.origin).toBe('ai');
  });

  for (const nodeCase of NODE_CASES) {
    it(`NODE (${nodeCase.kind}): the lost set is EXACTLY the measured reshapes plus the pinned drops`, () => {
      const input = fullV1Node(nodeCase.kind, nodeCase.data);
      const out = transformNodeToV3(input, new Set<string>()) as unknown as Out;
      assertLossIsExactlyExplained(
        `transformNodeToV3(kind=${nodeCase.kind})`,
        input as unknown as Record<string, unknown>,
        out,
        nodeCase.reshaped,
        nodeCase.knownDropped,
      );
      // Positive control per limb: the transform produced a real record, so an
      // empty or throwing transform cannot read as "nothing was lost".
      expect(out.id).toBe('n_1');
      expect(out.label).toBe('Label');
    });
  }
});
