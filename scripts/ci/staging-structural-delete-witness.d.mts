/**
 * Types for the structural_delete acceptance witness.
 *
 * The witness itself is plain `.mjs` on purpose: it runs with `node` and no
 * install step, so it still works when the dependency graph is what broke.
 * `scripts/**` is outside tsconfig's `include` and `allowJs` is off, so the
 * spec's import needs this declaration (without it: TS7016).
 *
 * MIRROR CAVEAT (the same honest note the sibling gate carries): this is a
 * hand-written type mirror of the `.mjs` exports, so it can drift from the
 * implementation. The drift is BOUNDED and cannot make the witness wrong — every
 * export here is exercised at RUNTIME against the real module by
 * `tests/unit/ci/staging-structural-delete-witness.test.ts`, including positive
 * controls on real captured staging responses. A stale declaration can only make
 * types imprecise; it can never make a broken deletion pass.
 */

/** What the wire-level RELOAD leg proves, and what it does not. */
export declare const RELOAD_EPISTEMICS: Readonly<{
  proves: string;
  does_not_prove: string;
  strengthened_by: string;
}>;

/** Per-leg scope, printed beside each verdict. */
export declare const LEG_COVERAGE: Readonly<Record<string, string>>;

/** A `base_graph_hash` that cannot collide with a real one — the canonical-read probe. */
export declare const CANONICAL_READ_SENTINEL: string;

/**
 * The success discriminator: `draft_graph` is attached ONLY on the committed
 * path, so its presence is the server's own receipt. Every refusal arm also
 * answers HTTP 200, which is why the status code cannot be the discriminator.
 */
export declare function carriedCommittedGraph(body: unknown): boolean;

export declare function graphNodes(body: unknown): Array<Record<string, unknown>>;
export declare function graphEdges(body: unknown): Array<Record<string, unknown>>;

/** `from::to` for every edge, from an edge array or a whole response body. */
export declare function edgePairs(edgesOrBody: unknown): string[];

/** The USABLE `option_id`s a response says the model is comparing. */
export declare function readyOptionIds(body: unknown): string[];

/** Intervention target ids named by a node/option holder, sorted and de-duplicated. */
export declare function interventionKeys(holder: unknown): string[];

/** A wire response reduced to the `{nodes, edges}` shape the scanners take. */
export declare function wireGraphOf(body: unknown): { nodes: unknown[]; edges: unknown[] };

/** Deterministic target selection; returns `{ error }` rather than guessing. */
export declare function pickDeleteTargets(body: unknown):
  | {
      error: string;
      target?: undefined;
      twin?: undefined;
      incidentEdgePairs?: undefined;
      namedEdge?: undefined;
    }
  | {
      error?: undefined;
      target: { id: string; label: string | null };
      twin: { id: string; interventionKeys: string[] };
      incidentEdgePairs: string[];
      namedEdge: string | null;
    };

/**
 * OBSERVABILITY IS SEPARATE FROM THE VERDICT. A turn that names no model
 * elements is UNMEASURED — neither an absence nor a loss — and the caller must
 * report it that way. `findings` is empty whenever `observable` is false.
 */
export declare function assertModelWithout(
  label: string,
  body: unknown,
  ids: { absentIds: readonly string[]; presentIds: readonly string[] },
): { observable: boolean; why: string | null; findings: string[] };

/** Pick a node whose removal will actually EXERCISE the orphan scan. */
export declare function pickOrphanTarget(input: {
  wireGraph: unknown;
  dbGraph: unknown;
  twin: unknown;
  excludeIds: readonly string[];
}): { id: string | null; mode: "FACTOR" | "META" | "NONE"; why: string | null };

/** @returns failure messages; an empty array means healthy. */
export declare function assertTruthfulAcknowledgement(
  label: string,
  status: number,
  body: unknown,
  expected: { id: string; label: string | null; incidentEdgeCount: number },
): string[];

/** @returns failure messages; an empty array means healthy. */
export declare function assertBatchAtomicity(
  label: string,
  body: unknown,
  baseEdgePairs: readonly string[],
  removedNodeIds: readonly string[],
): string[];

/** @returns failure messages; an empty array means healthy. */
export declare function assertNoOrphanedReferences(
  scopeLabel: string,
  graph: unknown,
  removedNodeIds: readonly string[],
): string[];

/** The non-vacuity counter: how many references to `nodeIds` a graph carries. */
export declare function countReferencesTo(graph: unknown, nodeIds: readonly string[]): number;

/** @returns failure messages; an empty array means healthy. */
export declare function assertTwinInterventionsIntact(
  label: string,
  body: unknown,
  twinId: string,
  expectedKeys: readonly string[],
): string[];

/** @returns failure messages; an empty array means healthy. */
export declare function assertNotifyDidNotMutate(
  label: string,
  hashBefore: string | null,
  hashAfter: string | null,
): string[];

/** The 16-hex analysis-affecting hash shape. */
export declare function looksLikeAnalysisHash(v: unknown): boolean;

/** Did the rerun recompute, and does any refusal name something the user deleted? */
export declare function classifyRerun(
  body: unknown,
  removedIds: readonly string[],
): { kind: string | null; recomputed: boolean; namesRemoved: string[]; reason_code: string | null };

/** Which leg entitles the report to which sentence of the founder's acceptance chain. */
export declare const ACCEPTANCE_CLAUSES: Readonly<Record<string, string>>;

/**
 * Exit codes. INCOMPLETE is its own code so an unmeasured leg can be mistaken
 * for neither a pass nor a defect; PREFLIGHT (2) stays reserved for the
 * missing-secret / production-host / unparseable-URL refusals.
 */
export declare const EXIT: Readonly<{ PASS: 0; FAIL: 1; PREFLIGHT: 2; INCOMPLETE: 3 }>;

/**
 * Decide the run's outcome from its legs. PURE. A PASS requires every acceptance
 * clause's leg to have PASSED and no leg anywhere to be UNKNOWN.
 */
export declare function decideOutcome(
  legs: ReadonlyArray<{ name?: string; verdict?: string; detail?: string; findings?: string[] }>,
): { status: "PASS" | "FAIL" | "INCOMPLETE"; exitCode: number; lines: string[] };
