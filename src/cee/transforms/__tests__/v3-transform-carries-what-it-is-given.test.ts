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
 * DECLARES `id?: string` (`schema-v2.ts:157`) and `transformEdgeToV3` does not
 * carry it. The typecheck only bites in one direction: it stops you CARRYING a
 * field the input type does not declare. It cannot notice a declared field you
 * FAIL to carry, because the output is a fresh literal, the input field is
 * optional, and nothing relates the two.
 *
 * ⚠⚠ **`id` PROVES THE MECHANISM, NOT A DEFECT — AND THE EARLIER FRAMING OF
 * THIS FILE IS WITHDRAWN.** It called the absence a silent loss and quoted a
 * live-edge count (*"2 of 242,731"*) as the consequence. **Withdrawn on both
 * counts**: the figure did not reproduce at a wider re-run scope, and — the
 * half that actually matters — **a count cannot settle this question at all.**
 * The absence is RATIFIED; the owning authority is
 * `orchestrator-v5/compose/edge-address.ts`, quoted at
 * `EDGE_NOT_CARRIED_BY_DESIGN` below. What this file proves is narrower and
 * still worth having: **the compiler cannot see a declared field you fail to
 * carry.** Whether a given absence is a DEFECT is a second question this guard
 * poses and never answers.
 *
 * ── ⛔⛔ THE INTERPRETATION RULE: A DROP AND A STRIP ARE DIFFERENT FAILURES ───
 * "Absent from the V3 output" has more than one cause, and they take different
 * fixes. Two of them, both live in this repo:
 *
 *   **DROP**  — the TRANSFORM never named the field, so the value dies in the
 *               enumerated rebuild. This file's subject; fixable here.
 *   **STRIP** — the CONTRACT does not declare the field, so a value the
 *               transform DOES emit is removed at validation. `EdgeV3`
 *               (`schemas/cee-v3.ts`) is a bare `z.object`, closing with
 *               *"declared fields only — unknown fields stripped with
 *               warning"*, and both the persistence commit and the egress
 *               boundary parse through it.
 *
 * ⛔ **A FIELD CAN BE BOTH, AND FIXING ONLY THE DROP SHIPS A DARK CHANGE.**
 * Edge `id` is precisely that: not carried by `transformEdgeToV3` AND not
 * declared on `EdgeV3`. A one-line carry would therefore change nothing a
 * consumer can see. So the right words for it are **STRIPPED BY CONTRACT**, not
 * **DROPPED BY TRANSFORM** — and neither of those is **DEFECT**.
 *
 * ⭐ Read every entry below as *"absent, and here is why"*, never as *"lost"*.
 * This file measures absence; it does not classify it.
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
 * by `transformGraphToV3` (`schema-v3.ts:1532-1533`, read back onto the node at
 * `:1591`). That is recorded below as a graph-level carrier, not as a drop.
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

/**
 * ⛔⛔ THE LEGACY-ONLY EDGE — because `FULL_V1_EDGE` CANNOT prove three of the
 * six edge reshapes below, and read alone it says it can.
 *
 * `FULL_V1_EDGE` populates BOTH spellings of three values (`weight` +
 * `strength_mean`, `belief` + `belief_exists`, `provenance` +
 * `provenance_source`), and in each pair the V4/structured name WINS the `??`.
 * So `EDGE_RESHAPED`'s `arrived` assertion for `weight`, `belief` and
 * `provenance_source` is satisfied by **the sibling's value**: delete those
 * legacy fallbacks outright and every assertion stays green. That is trap 19 —
 * an assertion bound by a value predicate a DIFFERENT object satisfies — and it
 * makes "the value arrived" untrue of exactly the three entries the docblock
 * promises are measured.
 *
 * This fixture sets ONLY the legacy names, so each carrier is bound by
 * IDENTITY: the value that arrives can only have come from the legacy field,
 * because nothing else in the record could have produced it. The magnitudes
 * differ from `FULL_V1_EDGE`'s deliberately, so a fixture mix-up cannot pass.
 *
 * ⭐ `provenance_source` is the one that matters: `transformEdgeToV3` calls it
 * the *"flat enum from Anthropic structured outputs"*, i.e. precisely the shape
 * that arrives WITHOUT a structured `provenance`. Its display value here
 * (`from_brief`) is one the structured sibling in `FULL_V1_EDGE` cannot
 * produce, so the two probes cannot be confused for one another.
 *
 * ⚠ SCOPE: this is a second, narrow probe and is deliberately NOT `Required<>`
 * and NOT covered by the fixture-coverage guard. Completeness is
 * `FULL_V1_EDGE`'s job; this one's job is discrimination.
 */
const LEGACY_ONLY_V1_EDGE: V1Edge = {
  from: 'fac_a',
  to: 'goal_b',
  weight: 0.42,
  belief: 0.61,
  provenance_source: 'brief_extraction',
  effect_direction: 'positive',
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
    // Carried under its own name (schema-v3.ts:348-351), so it needs no
    // reshape entry and no pinned-absence entry — adding either would RED the
    // stale-claim assertions. `metric_scale` is the rule this fixture's own
    // numbers describe: a percentage normalising against its 0-100 scale
    // (80 / 100 = 0.8). The carry is conditional on `goal_threshold_cap`
    // being present too, which the line above satisfies.
    goal_threshold_cap_provenance: 'metric_scale',
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

/**
 * ⚠ THREE OF THESE SIX ARE NOT PROVED HERE. `weight`, `belief` and
 * `provenance_source` have a sibling in `FULL_V1_EDGE` that wins the `??`, so
 * their `arrived` assertions read the SIBLING's value and survive the legacy
 * carrier being deleted. They are bound by identity in the `LEGACY_ONLY_V1_EDGE`
 * test instead — see that fixture's docblock. Do not read this map as evidence
 * for those three on its own.
 */
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
 * ⭐⭐ ABSENT BY DESIGN — not a drop, and NOT A DEFECT. **Do not "fix" it.**
 *
 * **The owning authority is `orchestrator-v5/compose/edge-address.ts`**, which
 * states it twice in its own words: *"EDGES ARE ADDRESSED BY `(from, to)`,
 * NEVER BY AN ID … an edge's only identity in the canonical graph is its
 * endpoint pair"*, and a client-local id (`"reactflow__edge-…"`) is *"never the
 * lookup key"*. That docblock runs the contrast control in the same breath —
 * `NodeV3Schema` DOES declare `id` — and concludes **"this is a property of
 * edges, not a gap in the package."** The node/edge asymmetry is a decision.
 *
 * ⛔ AND THE "FIX" WAS MEASURED AND REFUSED — both sizes of it fail, differently,
 * which is the drop-vs-strip distinction in the docblock landing on the one
 * field that has both:
 *   - **One line** (carry `id` in `transformEdgeToV3`) is **DARK.** `EdgeV3`
 *     (`schemas/cee-v3.ts`) is a bare `z.object` declaring no `id`, so the value
 *     is STRIPPED at validation — and both the persistence commit and the egress
 *     boundary parse through it.
 *   - **Two lines** (carry it AND declare it) is a **P1.**
 *     `orchestrator-v5/compose/phase3-blocks.ts` reads `e.id` as `explicitId`
 *     and lets it WIN over `composeEdgeIdentity(from, to)` — *"A
 *     producer-supplied id still wins."* Every edge-targeted review card would
 *     be repointed onto producer-local tokens that `parseEdgeAddress`
 *     deliberately rejects, and **no existing spec REDs.**
 *
 * ⭐ SO WHAT DOES A RED HERE MEAN? **Not "the fix landed".** It means something
 * started carrying `id` on the edge output — i.e. the design above was
 * REVERSED. That is a decision to take deliberately, with `edge-address.ts` and
 * `phase3-blocks.ts` open. **Do not silence it by moving `id` out of this set,
 * and do not widen the assertion.**
 *
 * ⚠ `id` is also this file's edge-level positive control (the test below). If
 * the design ever is reversed, that control needs a replacement: an empty set
 * here leaves the edge limb with no absence left to prove the probe can see one.
 */
const EDGE_NOT_CARRIED_BY_DESIGN: ReadonlySet<string> = new Set(['id']);

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
    // `transformGraphToV3` (schema-v3.ts:1532-1533, read back onto the node at
    // :1591) instead. Pinned as absent FROM THIS FUNCTION, with the graph-level
    // carrier named — scoped, not excused.
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

  // The mirror: an explanation for a field that is NO LONGER absent means this
  // pin is lying about the transform. ⚠ It does NOT follow that the right
  // remedy is to delete the pin — a set pinned BY DESIGN reds here because the
  // DESIGN was reversed, which is a decision, not a stale entry. Read the set's
  // own docblock; do not widen the assertion either way.
  const staleDropClaims = [...knownDropped].filter((k) => !lost.has(k)).sort();
  expect(
    staleDropClaims,
    `${label}: a field pinned as dropped now survives the transform — this pin ` +
      'is stale, OR the absence was pinned BY DESIGN and that design has been ' +
      "reversed. Read the pinned set's own docblock before editing it.",
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
      EDGE_NOT_CARRIED_BY_DESIGN,
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

  it('EDGE: the LEGACY carriers are bound by identity, not by a sibling that wins the `??`', () => {
    // `FULL_V1_EDGE` sets both spellings, so deleting `?? edge.weight`,
    // `?? edge.belief` or the `provenance_source` fallback leaves every
    // assertion above green. Here the legacy name is the ONLY possible source
    // of each value, so deleting its carrier must RED.
    const { edge } = transformEdgeToV3(LEGACY_ONLY_V1_EDGE, 0, []);
    const out = edge as unknown as Out;

    // Precondition, pinned in-test: the V4/structured siblings really are
    // absent, so the assertions below cannot be satisfied by anything else
    // (trap 13b — a discriminator must pin its own precondition).
    expect(LEGACY_ONLY_V1_EDGE.strength_mean).toBeUndefined();
    expect(LEGACY_ONLY_V1_EDGE.belief_exists).toBeUndefined();
    expect(LEGACY_ONLY_V1_EDGE.provenance).toBeUndefined();

    expect((out.strength as Out | undefined)?.mean).toBe(0.42);
    expect(out.exists_probability).toBe(0.61);
    expect((out.provenance as Out | undefined)?.source).toBe('brief_extraction');
    expect(out.provenance_display).toBe('from_brief');
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
