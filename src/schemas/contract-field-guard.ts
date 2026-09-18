/**
 * ⭐⭐ CONTRACT FIELD GUARD — the derived half of the twin/dead-field check.
 *
 * ── WHAT PROBLEM THIS IS FOR ─────────────────────────────────────────────────
 * Every data-architecture defect this estate has paid for reduces to two shapes:
 *
 *   A. TWINS — one concept, two names. `observedState` vs `observed_state`;
 *      `kind` vs `type`; two same-named `NodeV3`s, one of which strips.
 *   B. DECLARED BUT NEVER WRITTEN — a field on the contract that no producer
 *      ever fills, so every consumer reads absence forever.
 *
 * Both are invisible to a type checker (each side compiles), to a test suite
 * (each side is internally consistent) and to review (the two names are rarely
 * in the same diff). They are only visible when you put the two field sets
 * SIDE BY SIDE — which is what this module does, at runtime, from the schemas
 * themselves.
 *
 * ── WHY IT DERIVES AND WHAT DERIVATION CANNOT DO ─────────────────────────────
 * Every set here is `Object.keys(<schema>.shape)` and every strip/passthrough
 * verdict is `<schema>._def.unknownKeys`. Nothing is copied, so nothing can
 * drift. ⛔ BUT: a derived guard proves AGREEMENT and can never prove
 * COMPLETENESS (CLAUDE.md trap 12d — deleting a key from a canonical map leaves
 * every derived guard green). Deriving MOVES the risk, it does not remove it.
 * The hand-written corpus in `__tests__/contract-field-guard.corpus.test.ts` is
 * the other half: it feeds these detectors the twins we ALREADY KNOW EXIST and
 * asserts each one is found. Neither half supersedes the other and both ship.
 *
 * ── WHAT IS DELIBERATELY NOT HERE, AND WHY ───────────────────────────────────
 * ⛔ NO "near-identical token" / containment detector. It was tried and dropped.
 * `graph_hash` vs `graph_hash_at_run` is a real twin and containment finds it —
 * but the same rule flags `goal_threshold` against `goal_threshold_raw`,
 * `_cap`, `_unit` and `_frame`, which are a deliberate FAMILY, not twins. Every
 * discriminator we could write for family-vs-twin was an arbitrary constant with
 * a hard cliff, which is the shape CLAUDE.md trap 22f says stop writing rules
 * for. So containment twins are covered by the SYNONYM REGISTRY below instead,
 * where each one is a recorded human judgement rather than a guess. Detectors
 * here are EXACT: each fires only where the finding is true by construction.
 *
 * ── SCOPE, STATED NARROWLY ON PURPOSE ────────────────────────────────────────
 * This covers THE NODE/GRAPH WIRE CONTRACT — the shared package's `NodeV3Schema`
 * / `EdgeV3Schema` and CEE's own `NodeV3` / `EdgeV3` / `ObservedStateV3` /
 * `CEEGraphResponseV3`. It does NOT cover enrichment, coaching, blocks,
 * database columns or anything in PLoT/ISL/UI. A check that covers the node
 * contract well beats one that claims to cover everything.
 */
import { NodeV3Schema, EdgeV3Schema } from "@talchain/schemas";
import { NodeV3, EdgeV3, ObservedStateV3, CEEGraphResponseV3 } from "./cee-v3.js";

// ============================================================================
// Types
// ============================================================================

export type UnknownKeysPolicy = "strip" | "passthrough" | "strict";

export interface SchemaSurface {
  /** `<origin>.<SymbolName>` — the origin prefix is what makes a twin visible. */
  readonly name: string;
  readonly fields: readonly string[];
  readonly unknownKeys: UnknownKeysPolicy;
}

/** A contract surface and the CEE surface that is supposed to carry it. */
export interface SurfacePair {
  readonly contract: string;
  readonly implementation: string;
}

export type DetectorName =
  | "stripped"
  | "surface-twin"
  | "case-twin"
  | "convention-outlier"
  | "synonym"
  | "orphan";

export interface Finding {
  readonly detector: DetectorName;
  /** Stable key. The decisions ledger is keyed on exactly this string. */
  readonly id: string;
  readonly detail: string;
}

/** A pair/set of names that mean ONE thing. No lexical rule can find these. */
export interface SynonymSet {
  readonly id: string;
  readonly names: readonly string[];
  readonly why: string;
}

// ============================================================================
// Derivation — every set below is read off the schema, never restated
// ============================================================================

function surfaceOf(name: string, schema: unknown): SchemaSurface {
  const s = schema as { shape: Record<string, unknown>; _def: { unknownKeys?: string } };
  return {
    name,
    fields: Object.keys(s.shape).sort(),
    // `.strict()`/`.passthrough()` set this; a bare `z.object` leaves it "strip".
    unknownKeys: (s._def.unknownKeys ?? "strip") as UnknownKeysPolicy,
  };
}

/** The node/graph wire surfaces, derived. */
export function deriveSurfaces(): SchemaSurface[] {
  return [
    surfaceOf("contract.NodeV3Schema", NodeV3Schema),
    surfaceOf("contract.EdgeV3Schema", EdgeV3Schema),
    surfaceOf("cee.NodeV3", NodeV3),
    surfaceOf("cee.EdgeV3", EdgeV3),
    surfaceOf("cee.ObservedStateV3", ObservedStateV3),
    surfaceOf("cee.CEEGraphResponseV3", CEEGraphResponseV3),
  ];
}

/**
 * Which CEE surface is supposed to carry which contract surface.
 *
 * ⚠ This IS a hand-written mapping and it is the one thing here that could go
 * short. It cannot be derived — nothing in either package declares "cee.NodeV3
 * implements contract.NodeV3Schema". It fails loud rather than silently: a name
 * on either side that no longer resolves to a derived surface throws.
 */
export const SURFACE_PAIRS: readonly SurfacePair[] = [
  { contract: "contract.NodeV3Schema", implementation: "cee.NodeV3" },
  { contract: "contract.EdgeV3Schema", implementation: "cee.EdgeV3" },
];

/**
 * Concepts that live under two names, where the two names share no characters
 * so NO lexical rule can ever connect them.
 *
 * ⚠ THIS LIST IS HAND-WRITTEN AND IS THEREFORE INCOMPLETE BY CONSTRUCTION.
 * That is not a defect to fix by deriving it — it is the half derivation cannot
 * do (trap 12d). It is append-only, and the ledger's stale-entry rule means a
 * set whose members all leave the contract REDs rather than rotting.
 */
export const SYNONYM_REGISTRY: readonly SynonymSet[] = [
  {
    id: "kind-vs-type",
    names: ["kind", "type"],
    why:
      "Both are declared on contract.NodeV3Schema. `kind` is the node's role " +
      "(goal/factor/option/…); `type` is the measurement type " +
      "(numeric/ordinal/nominal/boolean). They are genuinely two questions, but " +
      "the names do not say so, and `type` measured 0 of 45,876 nodes — the " +
      "field nobody can tell apart is the field nobody writes.",
  },
  {
    id: "body-vs-description",
    names: ["body", "description"],
    why:
      "contract.NodeV3Schema declares `body`; cee.NodeV3 declares `description`. " +
      "One concept — optional prose about the node — under two names on the two " +
      "halves of the same wire.",
  },
  {
    id: "brief-vs-brief_text",
    names: ["brief", "brief_text"],
    why:
      "`scenarios.brief_text` vs `scenarios.brief`; `brief` was written 1 time " +
      "in 14,143 rows over 19 months. Recorded here because the same pair can " +
      "reach the node/graph surfaces; it is a DB-column twin today, which this " +
      "check does not scan.",
  },
  {
    id: "graph_hash-vs-graph_hash_at_run",
    names: ["graph_hash", "graph_hash_at_run"],
    why:
      "`graph_hash_at_run` vs `decision_brief.graph_hash` differ in 3,068 of " +
      "3,068 rows — two hashes of two different things under one word. Kept " +
      "here rather than caught by a containment rule (see the header).",
  },
  {
    id: "attribution_stability-vs-run_delta",
    names: ["attribution_stability", "run_delta"],
    why:
      "Two unrelated mechanisms both called 'attribution'; a liveness grep for " +
      "the first returns 915 false positives for the second. `run_delta` " +
      "measured 0 of 915.",
  },
  {
    id: "in_model-three-concepts",
    names: ["in_model", "not_in_model", "modelled"],
    why:
      "`in_model` means THREE different things across the estate: a " +
      "GroundedUnresolved member ('the thing the user referenced is not in the " +
      "graph'), a COUNT in a quantities tally, and a per-node participation " +
      "claim. One name, three questions — do not reconcile them, name them apart.",
  },
];

// ============================================================================
// Detectors — pure. Every one takes its universe as an argument so the corpus
// spec can feed it a twin we already know exists and assert it is found.
// ============================================================================

/** lower-case and drop separators: `observedState` and `observed_state` → `observedstate`. */
export function normaliseToken(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

/** `contract.NodeV3Schema` → `nodev3`; `cee.NodeV3` → `nodev3`. */
export function normaliseSurfaceName(name: string): string {
  const bare = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return normaliseToken(bare.replace(/Schema$/, ""));
}

function byName(surfaces: readonly SchemaSurface[]): Map<string, SchemaSurface> {
  return new Map(surfaces.map((s) => [s.name, s]));
}

/**
 * D1 — the contract declares it and the CEE surface that carries it STRIPS it.
 *
 * This is failure mode B in its structural form, and it is exact: a plain
 * `z.object` deletes an undeclared key with no error anywhere, so a field in
 * this list CANNOT reach a consumer through CEE no matter who writes it.
 * Measured consequence at the time of writing: node `type` is declared on the
 * contract, stripped here, and reads 0 of 45,876 nodes.
 */
export function detectStripped(
  surfaces: readonly SchemaSurface[],
  pairs: readonly SurfacePair[],
): Finding[] {
  const map = byName(surfaces);
  const out: Finding[] = [];
  for (const pair of pairs) {
    const contract = map.get(pair.contract);
    const impl = map.get(pair.implementation);
    // Fail loud rather than skip: a renamed surface must not read as "clean".
    if (!contract) throw new Error(`SURFACE_PAIRS names an unknown contract surface: ${pair.contract}`);
    if (!impl) throw new Error(`SURFACE_PAIRS names an unknown implementation surface: ${pair.implementation}`);
    if (impl.unknownKeys !== "strip") continue;
    const declared = new Set(impl.fields);
    for (const field of contract.fields) {
      if (declared.has(field)) continue;
      out.push({
        detector: "stripped",
        id: `stripped:${pair.implementation}:${field}`,
        detail:
          `${pair.contract} declares \`${field}\`, ${pair.implementation} does not, ` +
          `and ${pair.implementation} strips unknown keys — the field is SILENTLY ` +
          `DELETED at this boundary.`,
      });
    }
  }
  return out;
}

/**
 * D2 — two surfaces whose names normalise identically but whose field sets
 * differ. This is the two-`NodeV3`s defect, found by rule rather than by
 * somebody remembering. Identical field sets are a harmless alias and are not
 * reported.
 */
export function detectSurfaceTwins(surfaces: readonly SchemaSurface[]): Finding[] {
  const groups = new Map<string, SchemaSurface[]>();
  for (const s of surfaces) {
    const key = normaliseSurfaceName(s.name);
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const out: Finding[] = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    const shapes = new Set(group.map((s) => s.fields.join(",")));
    if (shapes.size === 1) continue; // same name, same shape — an alias, not a twin
    const names = group.map((s) => s.name).sort();
    out.push({
      detector: "surface-twin",
      id: `surface-twin:${key}`,
      detail:
        `${names.length} schemas normalise to \`${key}\` with DIFFERENT field sets: ` +
        names.map((n) => `${n} (${group.find((s) => s.name === n)?.unknownKeys})`).join(", ") +
        `. Name the twin before fixing either one.`,
    });
  }
  return out;
}

/**
 * D3 — one field spelled two ways across the universe (`observedState` and
 * `observed_state`). Exact: two distinct spellings of one normalised token IS a
 * twin, always, so this detector has no false positives by construction.
 */
export function detectCaseTwins(surfaces: readonly SchemaSurface[]): Finding[] {
  const spellings = new Map<string, Set<string>>();
  const where = new Map<string, Set<string>>();
  for (const s of surfaces) {
    for (const f of s.fields) {
      const key = normaliseToken(f);
      if (!spellings.has(key)) { spellings.set(key, new Set()); where.set(key, new Set()); }
      spellings.get(key)!.add(f);
      where.get(key)!.add(`${s.name}.${f}`);
    }
  }
  const out: Finding[] = [];
  for (const [key, set] of [...spellings].sort(([a], [b]) => a.localeCompare(b))) {
    if (set.size < 2) continue;
    out.push({
      detector: "case-twin",
      id: `case-twin:${key}`,
      detail:
        `\`${key}\` is spelled ${set.size} ways: ${[...set].sort().join(", ")} — at ` +
        `${[...where.get(key)!].sort().join(", ")}.`,
    });
  }
  return out;
}

/**
 * D4 — a field whose spelling is in the MINORITY convention for this contract.
 * The dominant convention is derived by counting, not asserted, so this stays
 * true if the estate ever changes its mind. A convention outlier is the state
 * that PRODUCES a case twin: somebody writes the other spelling, and now there
 * are two.
 */
export function detectConventionOutliers(surfaces: readonly SchemaSurface[]): Finding[] {
  const sites = new Map<string, string[]>();
  for (const s of surfaces) for (const f of s.fields) {
    const g = sites.get(f);
    if (g) g.push(s.name);
    else sites.set(f, [s.name]);
  }
  const all = [...sites.keys()];
  const isSnake = (f: string): boolean => /^[a-z][a-z0-9_]*$/.test(f);
  const snake = all.filter(isSnake).length;
  const other = all.length - snake;
  // A tie says nothing about which side is the outlier — report nothing.
  if (snake === other) return [];
  const minorityIsSnake = snake < other;
  return all
    .filter((f) => isSnake(f) === minorityIsSnake)
    .sort()
    .map((f) => ({
      detector: "convention-outlier" as const,
      id: `convention-outlier:${f}`,
      detail:
        `\`${f}\` is ${minorityIsSnake ? "snake_case" : "not snake_case"} while ` +
        `${Math.max(snake, other)} of ${all.length} node/graph fields are ` +
        `${minorityIsSnake ? "not" : ""}snake_case. Declared at ${sites.get(f)!.sort().join(", ")}.`,
    }));
}

/**
 * D5 — two members of a recorded synonym set are both declared. The registry is
 * hand-written because no lexical rule connects `kind` to `type`.
 */
export function detectSynonyms(
  surfaces: readonly SchemaSurface[],
  registry: readonly SynonymSet[],
): Finding[] {
  const declared = new Map<string, string[]>();
  for (const s of surfaces) for (const f of s.fields) {
    const g = declared.get(f);
    if (g) g.push(s.name);
    else declared.set(f, [s.name]);
  }
  const out: Finding[] = [];
  for (const set of registry) {
    const present = set.names.filter((n) => declared.has(n));
    if (present.length < 2) continue;
    out.push({
      detector: "synonym",
      id: `synonym:${set.id}`,
      detail:
        `${present.map((n) => `\`${n}\` (${declared.get(n)!.sort().join(", ")})`).join(" and ")} ` +
        `are both declared and are recorded as one concept. ${set.why}`,
    });
  }
  return out;
}

/**
 * D6 — a field declared on a CEE surface whose token appears NOWHERE in CEE's
 * non-test source outside its own declaration.
 *
 * ⚠ READ THE CLAIM EXACTLY. `occurrences` is a token index, not a dataflow
 * analysis: it cannot tell `node.label` from `block.label`. So it is SOUND IN
 * ONE DIRECTION ONLY — zero occurrences means there is certainly no writer and
 * no reader; a non-zero count means nothing at all, and this detector therefore
 * makes NO claim about non-zero fields. That asymmetry is deliberate: the
 * direction it can prove is exactly the direction failure mode B lives in.
 *
 * ⛔ AND IT IS THE STATIC HALF ONLY. A field with a writer in the source and no
 * writer AT RUNTIME (the branch never fires; the producer always skips it) is
 * invisible here — `scenarios.brief` at 1 of 14,143 had a writer. Catching that
 * needs a PRODUCER-RUNTIME WITNESS, which this check does not have and does not
 * pretend to.
 */
export function detectOrphans(
  surfaces: readonly SchemaSurface[],
  occurrences: ReadonlyMap<string, number>,
): Finding[] {
  const sites = new Map<string, string[]>();
  for (const s of surfaces) {
    if (!s.name.startsWith("cee.")) continue; // only CEE can be asked about CEE's source
    for (const f of s.fields) {
      const g = sites.get(f);
      if (g) g.push(s.name);
      else sites.set(f, [s.name]);
    }
  }
  return [...sites.keys()]
    .filter((f) => (occurrences.get(f) ?? 0) === 0)
    .sort()
    .map((f) => ({
      detector: "orphan" as const,
      id: `orphan:${f}`,
      detail:
        `\`${f}\` is declared on ${sites.get(f)!.sort().join(", ")} but its token ` +
        `appears in 0 non-test CEE source files outside the declaration — nothing ` +
        `in this service writes it or reads it.`,
    }));
}

// ============================================================================
// The decisions ledger — the hand-maintained half, ratcheted in BOTH directions
// ============================================================================

export interface Decision {
  /** Must equal a `Finding.id` exactly. */
  readonly id: string;
  /**
   * ACCEPTED — looked at, judged correct as it stands.
   * OPEN — a real question nobody has settled. Counted and printed loudly.
   */
  readonly status: "ACCEPTED" | "OPEN";
  readonly decision: string;
}

/**
 * ⚠ A LEDGER IS A HAND-MAINTAINED MIRROR, which is the defect class this estate
 * pays for most (trap 12). It is made safe by being ratcheted in BOTH
 * directions: a finding with no entry REDs ("record the decision"), and an entry
 * whose finding no longer reproduces REDs ("this decision is stale, delete it").
 * It cannot silently go short and it cannot silently go long.
 *
 * ⛔ AN `OPEN` ENTRY IS NOT AUTOMATICALLY RE-SURFACED. There is no date trigger
 * here — a CI check that turns red on a calendar is a time bomb, not a
 * mechanism. What this does give you is a COUNT that the check prints every run
 * and that a human can see going up. Stated as a limit, not hidden as a gap.
 */
export const DECISIONS: readonly Decision[] = [
  // ── stripped ──────────────────────────────────────────────────────────────
  {
    id: "stripped:cee.NodeV3:state_space",
    status: "ACCEPTED",
    decision:
      "Known and already pinned by hand at field-parity-derivation.test.ts's A6 " +
      "persistence-survival block: the AI-editable grant for `state_space` is " +
      "proposal-only because CEE's NodeV3 strips it. This detector is the DERIVED " +
      "half of that same fact — it would have found it without anyone naming it.",
  },
  {
    id: "stripped:cee.EdgeV3:label",
    status: "ACCEPTED",
    decision:
      "Same A6 block, edge half: edge `label` is granted as AI-editable but " +
      "stripped by cee.EdgeV3, so the grant is proposal-only. Recorded there by " +
      "hand, found here by derivation.",
  },
  {
    id: "stripped:cee.NodeV3:type",
    status: "OPEN",
    decision:
      "OPEN — and this is the one the derivation adds that no hand-written list " +
      "had. contract.NodeV3Schema declares `type` (numeric/ordinal/nominal/" +
      "boolean); cee.NodeV3 does not, so CEE deletes it. Measured 0 of 45,876 " +
      "nodes, and THIS IS THE MECHANISM FOR THAT ZERO. The question a human owes " +
      "an answer to: does CEE want the measurement type on the wire (declare it) " +
      "or has `kind` absorbed the job (retire it from the shared contract)? Do " +
      "not answer it by declaring the field to make this go green — see " +
      "synonym:kind-vs-type, which is the same question from the other side.",
  },
  {
    id: "stripped:cee.NodeV3:body",
    status: "OPEN",
    decision:
      "OPEN. contract.NodeV3Schema declares `body`; cee.NodeV3 declares " +
      "`description` instead and strips `body`. Same concept, two names, and the " +
      "strip means a `body` written anywhere upstream reaches nothing. The " +
      "decision owed is which name the node contract keeps — not a second field. " +
      "See synonym:body-vs-description.",
  },
  {
    id: "stripped:cee.NodeV3:categories",
    status: "OPEN",
    decision:
      "OPEN. contract.NodeV3Schema declares `categories` (the label list for a " +
      "nominal factor); cee.NodeV3 strips it, while cee.NodeV3 carries " +
      "`encoding_map` which answers a neighbouring question (encoded integer → " +
      "display string). Whether those are one concept or two has not been " +
      "settled by anyone, and guessing is how trap 21 happens.",
  },
  // ── surface twins ─────────────────────────────────────────────────────────
  {
    id: "surface-twin:nodev3",
    status: "ACCEPTED",
    decision:
      "DELIBERATE AND DOCUMENTED. contract.NodeV3Schema is `.passthrough()` and " +
      "keeps unknown keys; cee.NodeV3 is a plain `z.object` and strips them. The " +
      "asymmetry is load-bearing — cee-v3.ts carries three separate warnings that " +
      "declaring a field on the shared contract alone changes nothing here. This " +
      "entry exists so the pair stays NAMED rather than reconciled.",
  },
  {
    id: "surface-twin:edgev3",
    status: "ACCEPTED",
    decision:
      "Same as surface-twin:nodev3, edge half: contract.EdgeV3Schema is " +
      "`.passthrough()`, cee.EdgeV3 strips. Note the contract's edge has no `id` " +
      "at all — edge identity is the directional (from,to) pair — so the two " +
      "surfaces differ in more than strip policy.",
  },
  // ── convention ────────────────────────────────────────────────────────────
  {
    id: "convention-outlier:extractionType",
    status: "OPEN",
    decision:
      "OPEN. `extractionType` is the ONLY camelCase field in 65 node/graph " +
      "fields. It is already producing the twin this detector exists to predict: " +
      "adapters/llm/normalisation.ts:1074 emits a structured-log key spelled " +
      "`extraction_type`. Nothing is broken today — the log key and the wire " +
      "field are different things — but one spelling of one concept is now in the " +
      "tree twice, which is precisely the state `observedState`/`observed_state` " +
      "started from. Renaming the wire field is a cross-service change and is not " +
      "in this check's gift; recording it is.",
  },
  // ── synonyms ──────────────────────────────────────────────────────────────
  {
    id: "synonym:kind-vs-type",
    status: "OPEN",
    decision:
      "OPEN, and paired with stripped:cee.NodeV3:type — settle them together. " +
      "Both are declared on contract.NodeV3Schema and they are genuinely two " +
      "questions (role vs measurement type), which is exactly why the fix is to " +
      "NAME THEM APART rather than reconcile them.",
  },
  {
    id: "synonym:body-vs-description",
    status: "OPEN",
    decision:
      "OPEN, and paired with stripped:cee.NodeV3:body — settle them together. " +
      "Two names for optional node prose, one on each half of the same wire.",
  },
  // ── orphans ───────────────────────────────────────────────────────────────
  //
  // `orphan:analysis_participation` WAS RECORDED HERE AND IS NOW DELETED,
  // BECAUSE ITS FINDING NO LONGER REPRODUCES. 18 Sep 2026.
  //
  // The record read: "PASSTHROUGH BY DESIGN... No CEE code writes or reads it
  // — correct, and pinned by analysis-participation-survives-parse.test.ts."
  // That was true when written and stopped being true when #1588 landed
  // `run-analysis-participation-guard.ts`, which READS
  // `node.analysis_participation` and withholds a `'retained_excluded'` node
  // and its incident edges from the graph CEE sends PLoT. The field has a
  // consumer, so it is not an orphan, so the finding is gone.
  //
  // ⭐ THE GUARD CAUGHT THIS, NOT A HUMAN, AND IT CAUGHT IT AGAINST THE
  // ORCHESTRATOR WHO MERGED #1588. It failed the very next PR to run with
  // "1 recorded decision(s) no longer reproduce — delete them", which is
  // exactly the behaviour a recorded decision needs: a justification kept
  // after the thing it justified has gone is the false label this estate pays
  // for most often (CLAUDE.md trap 14 — an honest label overwritten by a
  // stale one, here by simply outliving its subject).
  //
  // ⛔ DELETED RATHER THAN REWRITTEN, DELIBERATELY. The tempting move is to
  // edit the sentence to say "now has one reader" and keep the entry — but a
  // decision records an adjudicated FINDING, and there is no finding left to
  // adjudicate. Keeping an entry whose finding is absent is how this list
  // becomes a hand-maintained mirror of a derivation (trap 12), which is the
  // thing the derivation replaced. If `analysis_participation` ever loses its
  // consumer again, the detector will raise a fresh orphan and the next reader
  // will have to argue it on its own evidence rather than inherit this one —
  // which is precisely what the deleted record said it wanted.
  //
  // The parse-survival test it cited is unaffected and still pins the strip
  // behaviour that made the declaration necessary in the first place.
];

// ============================================================================
// Run + adjudicate
// ============================================================================

export interface GuardReport {
  readonly findings: readonly Finding[];
  readonly unadjudicated: readonly Finding[];
  readonly stale: readonly Decision[];
  readonly open: readonly Decision[];
  readonly accepted: readonly Decision[];
}

export function runDetectors(
  surfaces: readonly SchemaSurface[],
  occurrences: ReadonlyMap<string, number>,
  pairs: readonly SurfacePair[] = SURFACE_PAIRS,
  registry: readonly SynonymSet[] = SYNONYM_REGISTRY,
): Finding[] {
  return [
    ...detectStripped(surfaces, pairs),
    ...detectSurfaceTwins(surfaces),
    ...detectCaseTwins(surfaces),
    ...detectConventionOutliers(surfaces),
    ...detectSynonyms(surfaces, registry),
    ...detectOrphans(surfaces, occurrences),
  ];
}

/** Both-directions ratchet: findings without decisions, decisions without findings. */
export function adjudicate(
  findings: readonly Finding[],
  decisions: readonly Decision[] = DECISIONS,
): GuardReport {
  const decided = new Map(decisions.map((d) => [d.id, d]));
  const found = new Set(findings.map((f) => f.id));
  const unadjudicated = findings.filter((f) => !decided.has(f.id));
  const stale = decisions.filter((d) => !found.has(d.id));
  const live = decisions.filter((d) => found.has(d.id));
  return {
    findings,
    unadjudicated,
    stale,
    open: live.filter((d) => d.status === "OPEN"),
    accepted: live.filter((d) => d.status === "ACCEPTED"),
  };
}
