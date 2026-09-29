/**
 * Readiness speaks in the CURRENT-STATE voice; the edit path keeps the PREVIEW voice.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * `structuralIssue()` (analysis-ready-helper.ts) read the PREVIEW copy and
 * asserted it as the current verdict on a model nobody had just edited. So a
 * loaded, unedited graph produced "This change would leave a node with no
 * connections." / "The model would have no decision node." / "The model would
 * have fewer than two options." — three statements about a change that does not
 * exist. `summariseReadiness` then wraps that string in "Here's what's still
 * open before this can run cleanly: …", so the conditional lands inside a
 * sentence whose whole job is to describe the model AS IT STANDS.
 *
 * ── THE DUAL USE IS REAL, WHICH IS WHY THIS IS KEYED, NOT REWORDED ────────
 * `edit-graph.ts:3000` / `:3012` translate the violations of a patch that was
 * REJECTED AND NEVER APPLIED. There, "This change would leave …" is exactly
 * right, and rewording it would replace one false voice with another. Two
 * questions were living under one name (trap 21): "what is wrong with this
 * model?" and "what would this change do to it?". The fix names them apart and
 * keys them off ONE owner — `VIOLATION_COPY` — rather than standing up a second
 * string table beside the first, which is how the estate grows twins.
 *
 * ── EVERY ASSERTION BINDS BY ISSUE CODE, NEVER BY PROSE ───────────────────
 * A test that matches the sentence must be rewritten every time the copy
 * improves, and prose-bound assertions are precisely how a codebase loses the
 * ability to change its own wording. The invariant asserted here is "the
 * readiness voice carries no conditional", not "the string equals X".
 *
 * ── TWO GUARDS, BOTH REQUIRED (trap 12d) ──────────────────────────────────
 * The union assertion is DERIVED — it proves the two projections cannot drift
 * apart. Derivation can only ever prove agreement; it cannot prove the key set
 * is RIGHT. So there is also a HAND-WRITTEN corpus of the codes the validator
 * can actually emit, derived independently by reading its `violations.push`
 * sites. Drop the derivation and the projections drift; drop the corpus and a
 * short list passes unobserved.
 *
 * ── OPPOSITE-DIRECTION TWINS (trap 22b) ───────────────────────────────────
 * Every "readiness carries no conditional" case has a twin asserting the edit
 * path STILL carries one. A fix that closes a gap by opening its inverse is the
 * failure mode this file is shaped to catch: one predicate cannot guard two
 * opposite harms.
 *
 * ⚠ DELIBERATELY NOT TOUCHED: the `WITNESSED_LEAKS` corpus in
 * `patch-rejection-no-internal-caps.test.ts` is an append-only record of
 * sentences the product ACTUALLY EMITTED on dated builds (2026-08-05,
 * 2026-08-07). That is evidence, not a fixture to keep current.
 */

import { describe, expect, it } from 'vitest';

import {
  VIOLATION_MESSAGES,
  CURRENT_STATE_VIOLATION_MESSAGES,
  type StructuralViolationCode,
} from '../../../src/orchestrator/graph-structure-validator.js';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import { summariseReadiness } from '../../../src/orchestrator-v5/routing/readiness-summary.js';

type Dict = Record<string, unknown>;

/**
 * The conditional/preview marker. Two independent shapes, because the preview
 * voice carries both and a partial de-conditioning reads clean against either
 * alone:
 *   · the modal itself      — "would leave", "would have"
 *   · the change referent   — "This change …"
 */
const PREVIEW_VOICE = /\bwould\b|\bthis change\b/i;

/**
 * ⭐ THE HAND-WRITTEN CORPUS — the codes `validateGraphStructure` can actually
 * emit, read off its `violations.push` sites (graph-structure-validator.ts
 * :281, :284, :288, :305, :341, :373, :421, :496, :553). This is the
 * completeness half: it is the only thing here that can notice the message
 * records have gone short.
 *
 * `NODE_LIMIT_EXCEEDED` / `EDGE_LIMIT_EXCEEDED` are deliberately ABSENT — they
 * have no producer since the size clause was deleted (2026-08-18), so their
 * copy is latent and this file makes no claim about the voice a user sees for
 * them.
 */
const EMITTABLE_CODES: readonly StructuralViolationCode[] = [
  'NO_GOAL',
  'NO_DECISION',
  'FEWER_THAN_TWO_OPTIONS',
  'ORPHAN_NODE',
  'OPTION_NO_FACTOR_EDGES',
  'OPTION_NOT_LINKED_TO_DECISION',
  'NO_PATH_TO_GOAL',
  'CYCLE_DETECTED',
];

/**
 * The codes whose PREVIEW copy is conditional, and which must therefore STAY
 * conditional on the edit path. Read off the same table; kept separate from
 * `EMITTABLE_CODES` because two entries (`OPTION_NO_FACTOR_EDGES`) are already
 * written in a voice that suits both surfaces and asserting a modal on them
 * would be asserting a fact that was never true.
 */
const CONDITIONAL_PREVIEW_CODES: readonly StructuralViolationCode[] = [
  'NO_GOAL',
  'NO_DECISION',
  'FEWER_THAN_TWO_OPTIONS',
  'ORPHAN_NODE',
  'OPTION_NOT_LINKED_TO_DECISION',
  'NO_PATH_TO_GOAL',
  'CYCLE_DETECTED',
];

function edge(from: string, to: string): Dict {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

/** A structurally sound graph. Each case below removes exactly one thing. */
function baseGraph(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Grow responsibly' },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      {
        id: 'fac_cost',
        kind: 'factor',
        label: 'Annual cost',
        category: 'controllable',
        observed_state: { value: 0.4, unit: '£', cap: 100 },
      },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Option A',
        interventions: { fac_cost: { value: 0.4, source: 'user_specified' } },
      },
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Option B',
        interventions: { fac_cost: { value: 0.6, source: 'user_specified' } },
      },
    ],
    edges: [
      edge('dec_1', 'opt_a'),
      edge('dec_1', 'opt_b'),
      edge('opt_a', 'fac_cost'),
      edge('opt_b', 'fac_cost'),
      edge('fac_cost', 'goal_1'),
    ],
  };
}

function withoutNode(id: string): Dict {
  const graph = baseGraph();
  graph.nodes = (graph.nodes as Dict[]).filter((n) => n.id !== id);
  graph.edges = (graph.edges as Dict[]).filter((e) => e.from !== id && e.to !== id);
  return graph;
}

/** A graph carrying an extra factor wired to nothing → ORPHAN_NODE. */
function withOrphanFactor(): Dict {
  const graph = baseGraph();
  (graph.nodes as Dict[]).push({
    id: 'fac_orphan',
    kind: 'factor',
    label: 'Unwired concern',
    // Same node SHAPE as `fac_cost` on purpose: a divergent shape fails schema
    // validation and the assessment returns SCHEMA_INVALID instead of the
    // structural code, which the precondition pin below would (correctly)
    // report as a vacuous fixture rather than let pass.
    category: 'controllable',
    observed_state: { value: 0.3, unit: '£', cap: 100 },
  });
  return graph;
}

describe('the message owner keeps two voices and cannot go short', () => {
  it('DERIVED: the current-state projection covers exactly the preview projection`s key set', () => {
    // A missing key would hand `undefined` to the wire `message` field.
    expect(Object.keys(CURRENT_STATE_VIOLATION_MESSAGES).sort()).toEqual(
      Object.keys(VIOLATION_MESSAGES).sort(),
    );
  });

  it('CORPUS: every code the validator can emit has copy in BOTH voices', () => {
    // Guards against the records agreeing with each other while both omit a
    // code the validator actually pushes — the class derivation cannot see.
    expect(EMITTABLE_CODES.length).toBeGreaterThan(0);
    for (const code of EMITTABLE_CODES) {
      expect(
        typeof CURRENT_STATE_VIOLATION_MESSAGES[code] === 'string'
          && CURRENT_STATE_VIOLATION_MESSAGES[code].length > 0,
        `current-state copy missing for ${code}`,
      ).toBe(true);
      expect(
        typeof VIOLATION_MESSAGES[code] === 'string' && VIOLATION_MESSAGES[code].length > 0,
        `preview copy missing for ${code}`,
      ).toBe(true);
    }
  });
});

describe('readiness voice — no conditional about a change that does not exist', () => {
  it.each(EMITTABLE_CODES)(
    'current-state copy for %s carries no preview marker',
    (code) => {
      expect(CURRENT_STATE_VIOLATION_MESSAGES[code]).not.toMatch(PREVIEW_VOICE);
    },
  );

  // ── OPPOSITE-DIRECTION TWIN ──────────────────────────────────────────────
  it.each(CONDITIONAL_PREVIEW_CODES)(
    'TWIN: preview copy for %s STILL carries the preview marker (the edit path is not collateral)',
    (code) => {
      expect(VIOLATION_MESSAGES[code]).toMatch(PREVIEW_VOICE);
    },
  );

  it('the two voices are genuinely different strings for every conditional code', () => {
    // Pins the discriminating precondition in-test (trap 13b): if a future
    // edit collapsed the projections onto one string, the assertions above
    // could both pass only by the preview voice having been destroyed.
    for (const code of CONDITIONAL_PREVIEW_CODES) {
      expect(
        CURRENT_STATE_VIOLATION_MESSAGES[code],
        `voices collapsed onto one string for ${code}`,
      ).not.toBe(VIOLATION_MESSAGES[code]);
    }
  });
});

describe('END TO END — the canonical readiness authority emits the current-state voice', () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly code: StructuralViolationCode;
    readonly graph: () => Dict;
  }> = [
    { name: 'a model with one option', code: 'FEWER_THAN_TWO_OPTIONS', graph: () => withoutNode('opt_b') },
    { name: 'a model with no decision', code: 'NO_DECISION', graph: () => withoutNode('dec_1') },
    { name: 'a model with an unwired factor', code: 'ORPHAN_NODE', graph: () => withOrphanFactor() },
  ];

  it.each(CASES)('$name → the $code issue speaks in the present tense', ({ code, graph }) => {
    const assessment = assessCanonicalAnalysisReadiness(graph());

    // ⭐ PRECONDITION PINNED IN-TEST. Without this the voice assertion below
    // would pass vacuously on a fixture that had stopped producing the code
    // at all — a guard whose discrimination depends on a fixture nothing pins
    // (trap 13b).
    const issue = assessment.blockingIssues.find((i) => i.code === code);
    expect(issue, `fixture stopped producing ${code}; the voice assertion below would be vacuous`)
      .toBeDefined();

    // Bound by CODE, never by prose.
    expect(issue!.message).not.toMatch(PREVIEW_VOICE);
  });

  it('the wire payload a user receives carries no conditional on any structural issue', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(withoutNode('opt_b'));
    expect(wire?.blocked_reason).toBe('FEWER_THAN_TWO_OPTIONS');

    const structural = (wire?.readiness_issues ?? []).filter(
      (i) => i.category === 'graph_structure',
    );
    expect(structural.length).toBeGreaterThan(0);
    for (const issue of structural) {
      expect(issue.message, `${issue.code} reached the wire in the preview voice`)
        .not.toMatch(PREVIEW_VOICE);
    }
  });

  it('USER SURFACE: the "what is still open" prose describes the model, not a hypothetical change', () => {
    const wire = buildCanonicalAnalysisReadyFromGraph(withoutNode('opt_b'));
    const summary = summariseReadiness(wire as never);

    // Precondition: this payload must actually reach the structural branch.
    expect(summary.open_items.some((i) => i.kind === 'too_few_options')).toBe(true);
    expect(summary.prose).toContain("Here's what's still open");
    expect(summary.prose).not.toMatch(PREVIEW_VOICE);
  });
});
