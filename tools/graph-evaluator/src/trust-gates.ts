/**
 * TRUST GATES — the hard, deterministic admissibility checks a model-generation
 * candidate must pass before any quality score is comparable (plan v2, WP1 §2;
 * architectural principle 3: "Trust gates before scores").
 *
 * Authority order (amendment 3): deterministic hard gates -> deterministic /
 * scientific metrics -> LLM judging. Nothing here consults a model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO CANDIDATE SHAPES, ONE GATE SET
 *
 * Arm A (today's CEE) produces only a GraphV3 body. Arms A'/B/C produce a RICH
 * DECISION MODEL and, after projection, a graph. Every gate therefore takes both
 * and decides which channels it can see:
 *
 *   { rich: RichModelLike | null, graph: ParsedGraph | null, brief: Brief }
 *
 * `brief` is the ORACLE (front-matter expectations + the brief body), not a
 * candidate: a gate cannot decide "absent from the brief" without the brief.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `goal_threshold*` IS NOT A CHANNEL — and that is deliberate.
 *
 * `CEE_MINTED_GOAL_FIELDS` (src/adapters/llm/normalisation.ts:184) strips all
 * eight goal fields at ingress and PR #789 cut four from the sent grammar, so no
 * model can author them: the ENRICHER derives the threshold from brief text by
 * regex. A gate that read them would score CEE's extractor, not the candidate —
 * the exact bias `tests/rubric-invariant.test.ts` exists to keep out of the
 * rubric. The gates honour the same rule so the two instruments cannot
 * contradict each other, and a CONTROL test proves it behaviourally (adding
 * `goal_threshold_raw` must not change a verdict).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TYPE OVERLAP, DECLARED. `src/rich-model.ts` (owned by the run-harness lane)
 * declares the full `RichDecisionModel`, `ProjectedGraph` and the Zod parser.
 * This module deliberately declares its OWN minimal structural types for the
 * fields the gates read, so the contract can be frozen and hashed without taking
 * a build dependency on a file another lane is editing. `tests/trust-gates.test.ts`
 * carries a compile-time assignability check against the real types, so a
 * divergence REDs the typecheck instead of drifting.
 */

import type { Brief, GoalConstraint, GraphNode, ParsedGraph, WireIntervention } from "./types.js";

// =============================================================================
// Minimal rich-decision-model types (mirror of contracts/rich-decision-model.v0.json)
// =============================================================================

export type RichEpistemicState =
  | "known" | "observed" | "user_estimate" | "external_evidence" | "ai_hypothesis" | "unknown";

/** Epistemic states the v0 schema says REQUIRE an anchor (`source_fact_id`). */
export const ANCHOR_REQUIRED_STATES: readonly RichEpistemicState[] = [
  "known",
  "observed",
  "user_estimate",
];

export interface RichUserFactLike {
  id: string;
  kind?: string;
  source_quote: string;
  value: number | null;
  unit: string | null;
  role?: string;
  transformation: string | null;
}

export interface RichLeverSettingLike {
  factor_id: string;
  value: number | null;
  unit: string | null;
  epistemic_state: RichEpistemicState;
  source_fact_id: string | null;
}

export interface RichOptionLike {
  id: string;
  label: string;
  provenance: "user" | "ai_proposed";
  source_fact_id: string | null;
  is_status_quo?: boolean;
  lever_settings: RichLeverSettingLike[];
  rationale: string | null;
}

export interface RichFactorLike {
  id: string;
  label: string;
  control: "lever" | "observable" | "external";
  measurability?: "quantitative" | "qualitative";
  epistemic_state: RichEpistemicState;
  current_value: number | null;
  unit: string | null;
  provenance: "user" | "ai_proposed";
  source_fact_id: string | null;
}

export interface RichOutcomeLike {
  id: string;
  label: string;
  kind: "outcome" | "risk";
  epistemic_state: RichEpistemicState;
  provenance: "user" | "ai_proposed";
  source_fact_id: string | null;
}

export interface RichConstraintLike {
  id: string;
  subject_id: string;
  operator: string;
  value: number;
  unit: string | null;
  provenance: "user" | "ai_proposed";
  source_fact_id: string | null;
}

export interface RichCausalLinkLike {
  id: string;
  from_id: string;
  to_id: string;
  magnitude: { kind: string; value: number | null; note: string | null };
  temporal?: { delay: string | null; duration: string | null; persistence?: string; note: string | null };
  provenance: "user" | "ai_hypothesis";
  source_fact_id: string | null;
  rationale: string | null;
}

export interface RichModelLike {
  decision?: { question?: string; horizon?: { value: number | null; unit: string | null; source_fact_id: string | null } };
  user_facts: RichUserFactLike[];
  options: RichOptionLike[];
  factors: RichFactorLike[];
  outcomes: RichOutcomeLike[];
  constraints: RichConstraintLike[];
  causal_links: RichCausalLinkLike[];
  unknowns?: Array<{ id: string; question: string; about_id: string | null }>;
  notes?: Array<{ about_id: string | null; kind: string; text: string }>;
}

// =============================================================================
// Projected-graph shape (post-projection, G9 only)
// =============================================================================

export interface ProjectedInterventionLike {
  value?: number;
  raw_value?: number;
  unit?: string;
  source?: string;
}

export interface ProjectedNodeLike {
  id: string;
  kind: string;
  label?: string;
  provenance?: string;
  interventions?: Record<string, ProjectedInterventionLike>;
  observed_state?: { value?: number; raw_value?: number; source?: string };
  data?: { value?: number; raw_value?: number; [k: string]: unknown };
}

export interface ProjectedGraphLike {
  nodes: ProjectedNodeLike[];
  goal_constraints?: Array<{ constraint_id?: string; node_id: string; value?: number; provenance?: string }>;
}

// =============================================================================
// Gate result contract
// =============================================================================

export type GateStatus = "PASS" | "FAIL" | "NA";

export interface GateResult {
  gate: string;
  status: GateStatus;
  /** Always names WHAT WAS SEARCHED as well as what was found (trap: "name the artefact searched"). */
  evidence: string;
}

export interface GateInput {
  /** Rich decision model, when the arm produces one. Arm A passes null. */
  rich: RichModelLike | null;
  /** GraphV3-shaped body, wire or evaluator-shaped. */
  graph: ParsedGraph | null;
  /** The ORACLE: front-matter expectations + the brief body. Never a candidate. */
  brief: Brief;
}

/** Every gate id, in order. Frozen with the contract. */
export const TRUST_GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"] as const;
export type TrustGateId = (typeof TRUST_GATE_IDS)[number];

// =============================================================================
// Provenance tokens
// =============================================================================

/**
 * Provenance values that assert USER authority.
 *
 * `explicit` is CEE's own constraint-provenance token — `src/schemas/assist.ts:419`
 * declares `provenance: z.enum(["explicit", "inferred", "proxy"])`. A DRIFT ALARM
 * in tests/trust-gates.test.ts asserts that enum still exists at that path, so a
 * rename REDs instead of silently widening the user side of every gate.
 */
export const USER_PROVENANCE_TOKENS: ReadonlySet<string> = new Set([
  "user",
  "user_set",
  "user_specified",
  "from_brief",
  "brief_extraction",
  "explicit",
  "panel_elicited",
]);

/** Provenance values that assert AI/derived authority. */
export const AI_PROVENANCE_TOKENS: ReadonlySet<string> = new Set([
  "ai_proposed",
  "ai_hypothesis",
  "ai_inferred",
  "cee_hypothesis",
  "cee_inference",
  "inferred",
  "proxy",
  "default",
]);

export type ProvenanceClass = "user" | "ai" | "unknown";

export function classifyProvenance(token: string | null | undefined): ProvenanceClass {
  if (token == null) return "unknown";
  const t = String(token).trim().toLowerCase();
  if (USER_PROVENANCE_TOKENS.has(t)) return "user";
  if (AI_PROVENANCE_TOKENS.has(t)) return "ai";
  return "unknown";
}

// =============================================================================
// Unit normalisation
// =============================================================================

/**
 * Unit families. The rule is SUBSET, not equality: every family the ORACLE names
 * must appear in the candidate's unit.
 *
 *   expected "£"  vs actual "£/month"  -> MATCH   (more precise, not less)
 *   expected "%"  vs actual "fraction" -> NO      (a relabelled 0-1 level)
 *   expected "months" vs actual "£/month" -> NO   (guarded below)
 */
const UNIT_FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/£|\bgbp\b|\bpounds?\b/i, "£"],
  [/\$|\busd\b|\bdollars?\b/i, "$"],
  [/€|\beur\b|\beuros?\b/i, "€"],
  [/%|\bpercent(age)?\b|\bpct\b/i, "%"],
  [/\/\s*month|\bper[-\s]?month\b|\bmonthly\b|\bp\/m\b/i, "/month"],
  [/\bmonths?\b/i, "months"],
  [/\bquarters?\b/i, "quarters"],
  [/\byears?\b|\bannual(ly)?\b|\/\s*year/i, "years"],
  [/\bweeks?\b/i, "weeks"],
  [/\bdays?\b|\/\s*day/i, "days"],
  [/\bpeople\b|\bheadcount\b|\bfte\b|\bhires?\b|\bdevelopers?\b/i, "people"],
  [/\bcustomers?\b|\busers?\b|\bsubscribers?\b/i, "customers"],
];

export function normaliseUnit(unit: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (unit == null) return out;
  const raw = String(unit);
  for (const [re, family] of UNIT_FAMILY_PATTERNS) {
    if (re.test(raw)) out.add(family);
  }
  // "£/month" must not also read as the DURATION "months" — a rate is not a horizon.
  if (out.has("/month")) out.delete("months");
  return out;
}

/** True when the candidate's unit carries every family the oracle names. */
export function unitSatisfies(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const want = normaliseUnit(expected);
  const got = normaliseUnit(actual);
  if (want.size === 0) {
    // The oracle's unit is outside every family — fall back to exact text.
    if (expected == null || String(expected).trim() === "") return true;
    return String(expected).trim().toLowerCase() === String(actual ?? "").trim().toLowerCase();
  }
  for (const family of want) {
    if (!got.has(family)) return false;
  }
  return true;
}

// =============================================================================
// Magnitude helpers
// =============================================================================

const REL_TOLERANCE = 1e-6;

export function magnitudeEquals(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * REL_TOLERANCE);
}

/** Digit renderings of a value, for a substring search against text. */
function digitForms(value: number): string[] {
  const forms = new Set<string>();
  const push = (n: number) => {
    if (!Number.isFinite(n)) return;
    forms.add(String(n));
    if (Number.isInteger(n)) forms.add(n.toFixed(0));
    else {
      forms.add(String(Number(n.toFixed(6))));
      forms.add(String(Number(n.toFixed(4))));
      forms.add(String(Number(n.toFixed(2))));
    }
  };
  push(value);
  return [...forms].filter((f) => f.length > 0);
}

/** Text with separators removed, so "£215k"/"5,000" compare like digits. */
function searchable(text: string): string {
  return text.replace(/,/g, "").toLowerCase();
}

/**
 * Is `value` present in `text` as a digit string — literally, or as the
 * DE-NORMALISED / re-normalised form (x100 or /100)?
 *
 * The x100 limb is load-bearing: CEE writes "4%" as `0.04` (a relabelled level),
 * and a gate that could not see through that would report a loss where the
 * number did survive. It is used ONLY to establish PRESENCE (G2/G3); G1 still
 * demands the NATIVE magnitude.
 */
export function valueAppearsIn(value: number, text: string): { found: boolean; via: string } {
  const hay = searchable(text);
  for (const form of digitForms(value)) {
    if (hay.includes(form)) return { found: true, via: "literal" };
  }
  for (const form of digitForms(value * 100)) {
    if (hay.includes(form)) return { found: true, via: "x100 (de-normalised)" };
  }
  for (const form of digitForms(value / 100)) {
    if (hay.includes(form)) return { found: true, via: "/100 (normalised)" };
  }
  return { found: false, via: "not found" };
}

// =============================================================================
// Reading numbers out of EITHER graph shape
// =============================================================================

export interface ReadIntervention {
  optionId: string;
  factorId: string;
  /** Native magnitude (59) where the shape carries one. */
  native: number | null;
  /** Normalised level (0.59). */
  normalised: number | null;
  unit: string | null;
  /** Provenance token, or null when the slot exists and is empty. */
  source: string | null;
  /** True when the shape has a provenance SLOT at all. */
  hasSourceSlot: boolean;
}

/**
 * Read an option node's interventions from BOTH shapes.
 *
 * WIRE   `node.interventions = { fid: { value, raw_value, unit, source } }`
 * LEGACY `node.data.interventions = { fid: 0.59 }` — no provenance slot exists,
 *        so provenance is INHERITED from `node.provenance` and the absence of a
 *        source is NOT held against it (there is nowhere to put one). A wire
 *        intervention that leaves its slot empty is a different thing entirely:
 *        that is the `schema-v3.ts:457` fail-open shape, and G3 fails it.
 */
export function readInterventions(node: GraphNode): ReadIntervention[] {
  const out: ReadIntervention[] = [];
  const wire = node.interventions as Record<string, WireIntervention> | undefined;
  if (wire && typeof wire === "object") {
    for (const [factorId, iv] of Object.entries(wire)) {
      if (iv == null || typeof iv !== "object") continue;
      out.push({
        optionId: node.id,
        factorId,
        native: typeof iv.raw_value === "number" ? iv.raw_value : null,
        normalised: typeof iv.value === "number" ? iv.value : null,
        unit: typeof iv.unit === "string" ? iv.unit : null,
        source: typeof iv.source === "string" ? iv.source : null,
        hasSourceSlot: true,
      });
    }
  }
  const legacy = node.data?.interventions;
  if (legacy && typeof legacy === "object") {
    for (const [factorId, v] of Object.entries(legacy)) {
      if (typeof v !== "number") continue;
      out.push({
        optionId: node.id,
        factorId,
        native: null,
        normalised: v,
        unit: typeof node.data?.unit === "string" ? node.data.unit : null,
        source: node.provenance ?? null,
        hasSourceSlot: false,
      });
    }
  }
  return out;
}

export interface ReadNodeValue {
  nodeId: string;
  path: string;
  native: number | null;
  normalised: number | null;
  unit: string | null;
  source: string | null;
  hasSourceSlot: boolean;
}

/**
 * Every number a node carries on a MODEL-PERMITTED channel.
 * `goal_threshold*` is excluded — see the module docblock.
 */
export function readNodeValues(node: GraphNode): ReadNodeValue[] {
  const out: ReadNodeValue[] = [];
  const os = node.observed_state;
  if (os && typeof os === "object" && (typeof os.value === "number" || typeof os.raw_value === "number")) {
    out.push({
      nodeId: node.id,
      path: `${node.id}.observed_state`,
      native: typeof os.raw_value === "number" ? os.raw_value : null,
      normalised: typeof os.value === "number" ? os.value : null,
      unit: typeof os.unit === "string" ? os.unit : null,
      source: (typeof os.source === "string" ? os.source : null) ?? (typeof os.extractionType === "string" ? os.extractionType : null),
      hasSourceSlot: true,
    });
  }
  const d = node.data;
  if (d && (typeof d.value === "number" || typeof d.raw_value === "number")) {
    const label = typeof d.extractionType === "string" ? d.extractionType : null;
    out.push({
      nodeId: node.id,
      path: `${node.id}.data`,
      native: typeof d.raw_value === "number" ? d.raw_value : null,
      normalised: typeof d.value === "number" ? d.value : null,
      unit: typeof d.unit === "string" ? d.unit : null,
      source: label ?? node.extractionType ?? node.provenance ?? null,
      hasSourceSlot: label != null || node.extractionType != null,
    });
  }
  return out;
}

function optionNodes(graph: ParsedGraph): GraphNode[] {
  return graph.nodes.filter((n) => n.kind === "option");
}

/** Node ids a lever must never target: constraint subjects and outcomes/risks. */
function illegitimateTargets(input: GateInput): { ids: Set<string>; why: Map<string, string> } {
  const ids = new Set<string>();
  const why = new Map<string, string>();
  const mark = (id: string, reason: string) => {
    ids.add(id);
    if (!why.has(id)) why.set(id, reason);
  };
  if (input.rich) {
    for (const c of input.rich.constraints ?? []) mark(c.subject_id, `subject of constraint ${c.id}`);
    for (const o of input.rich.outcomes ?? []) mark(o.id, `${o.kind} "${o.label}"`);
  }
  if (input.graph) {
    for (const gc of input.graph.goal_constraints ?? []) {
      if (gc.node_id) mark(gc.node_id, `subject of ${gc.constraint_id ?? "a goal constraint"}`);
    }
    for (const n of input.graph.nodes) {
      if (n.kind === "outcome" || n.kind === "risk") mark(n.id, `${n.kind} "${n.label ?? n.id}"`);
    }
  }
  return { ids, why };
}

// =============================================================================
// G1 — every expected user value present, native magnitude + unit, user provenance
// =============================================================================

export interface LocatedUserValue {
  want: { value: number; unit: string; role: string; quote: string };
  /** Where it was found, or null when the candidate lost it. */
  found: string | null;
}

/**
 * Locate every declared user value in the candidate.
 *
 * ⚠ SHARED ON PURPOSE by `gateG1` and by `numeric_provenance` side A in
 * scorer.ts. A gate and a score that answer the same question from two
 * implementations WILL drift; this one cannot.
 */
export function locateExpectedUserValues(input: GateInput): LocatedUserValue[] {
  const expected = input.brief.meta.expected_user_values ?? [];
  const out: LocatedUserValue[] = [];
  for (const want of expected) {
    let found: string | null = null;

    if (input.rich) {
      for (const uf of input.rich.user_facts ?? []) {
        if (!magnitudeEquals(uf.value, want.value)) continue;
        if (!unitSatisfies(want.unit, uf.unit)) continue;
        if (!input.brief.body.includes(uf.source_quote)) continue;
        found = `rich user_fact ${uf.id} (${uf.value} ${uf.unit ?? "-"}, quote verbatim)`;
        break;
      }
    }

    if (!found && input.graph) {
      for (const node of input.graph.nodes) {
        for (const iv of readInterventions(node)) {
          if (!magnitudeEquals(iv.native, want.value)) continue;
          if (!unitSatisfies(want.unit, iv.unit)) continue;
          if (classifyProvenance(iv.source) !== "user") continue;
          found = `graph intervention ${iv.optionId}->${iv.factorId} (${iv.native} ${iv.unit ?? "-"}, source ${iv.source})`;
          break;
        }
        if (found) break;
        for (const nv of readNodeValues(node)) {
          if (!magnitudeEquals(nv.native, want.value)) continue;
          if (!unitSatisfies(want.unit, nv.unit)) continue;
          if (classifyProvenance(nv.source) !== "user") continue;
          found = `graph ${nv.path} (${nv.native} ${nv.unit ?? "-"}, source ${nv.source})`;
          break;
        }
        if (found) break;
      }
      if (!found) {
        for (const gc of input.graph.goal_constraints ?? []) {
          if (!magnitudeEquals(gc.value, want.value)) continue;
          if (!unitSatisfies(want.unit, gc.unit)) continue;
          if (classifyProvenance(gc.provenance) !== "user") continue;
          found = `graph goal_constraint ${gc.constraint_id ?? gc.node_id} (${gc.value} ${gc.unit ?? "-"}, provenance ${gc.provenance})`;
          break;
        }
      }
    }
    out.push({ want, found });
  }
  return out;
}

export function gateG1(input: GateInput): GateResult {
  const expected = input.brief.meta.expected_user_values ?? [];
  if (expected.length === 0) {
    return { gate: "G1", status: "NA", evidence: "brief declares no expected_user_values" };
  }
  const channels: string[] = [];
  if (input.rich) channels.push("rich.user_facts (quote asserted verbatim in the brief)");
  if (input.graph) channels.push("graph: option interventions (wire+legacy), node.observed_state, node.data, goal_constraints[] — goal_threshold* EXCLUDED by design");

  const misses: string[] = [];
  const hits: string[] = [];

  for (const located of locateExpectedUserValues(input)) {
    const want = located.want;
    if (located.found) hits.push(`${want.value} ${want.unit} (${want.role}) <- ${located.found}`);
    else misses.push(`${want.value} ${want.unit} (${want.role}, "${want.quote}")`);
  }

  const searched = `searched ${channels.join(" + ") || "no candidate supplied"}`;
  if (misses.length > 0) {
    return {
      gate: "G1",
      status: "FAIL",
      evidence: `${misses.length}/${expected.length} expected user value(s) NOT present at native magnitude+unit with user provenance: ${misses.join("; ")}. ${hits.length} found: ${hits.join("; ") || "none"}. ${searched}`,
    };
  }
  return {
    gate: "G1",
    status: "PASS",
    evidence: `all ${expected.length} expected user value(s) present: ${hits.join("; ")}. ${searched}`,
  };
}

// =============================================================================
// G2 — no user-provenance number that is absent from the brief
// =============================================================================

function reconstructible(
  value: number,
  quote: string,
  transformation: string | null | undefined
): { ok: boolean; how: string } {
  if (transformation != null && String(transformation).trim() !== "") {
    return { ok: true, how: `declared transformation "${transformation}"` };
  }
  const r = valueAppearsIn(value, quote);
  return { ok: r.found, how: r.via };
}

export interface LaunderingReport {
  violations: string[];
  inspected: number;
  channels: string[];
}

/**
 * Every number the candidate stamps with USER authority that the brief does not
 * support. SHARED by `gateG2` and by `numeric_provenance` side B — same reason
 * as `locateExpectedUserValues`.
 */
export function findLaunderedNumbers(input: GateInput): LaunderingReport {
  const violations: string[] = [];
  let inspected = 0;
  const channels: string[] = [];

  if (input.rich) {
    channels.push("rich.user_facts + every provenance:user item carrying a number WITH an anchor");
    const facts = new Map((input.rich.user_facts ?? []).map((f) => [f.id, f]));
    for (const uf of input.rich.user_facts ?? []) {
      if (uf.value == null) continue;
      inspected++;
      const r = reconstructible(uf.value, uf.source_quote, uf.transformation);
      if (!r.ok) {
        violations.push(`user_fact ${uf.id} value ${uf.value} is not reconstructible from its quote "${uf.source_quote}" and declares no transformation`);
      }
      if (!input.brief.body.includes(uf.source_quote)) {
        violations.push(`user_fact ${uf.id} quote "${uf.source_quote}" is NOT a verbatim span of the brief`);
      }
    }
    const anchored = (
      value: number | null,
      sourceFactId: string | null,
      provenance: string,
      where: string
    ) => {
      if (value == null) return;
      if (classifyProvenance(provenance) !== "user") return;
      if (sourceFactId == null) return; // absence of an anchor is G3's business, not G2's
      inspected++;
      const fact = facts.get(sourceFactId);
      if (!fact) {
        violations.push(`${where} claims user provenance via source_fact_id "${sourceFactId}", which resolves to NOTHING`);
        return;
      }
      const r = reconstructible(value, fact.source_quote, fact.transformation);
      if (!r.ok) {
        violations.push(`${where} value ${value} is not reconstructible from its anchor ${fact.id} ("${fact.source_quote}")`);
      }
    };
    for (const o of input.rich.options ?? []) {
      for (const ls of o.lever_settings ?? []) {
        anchored(ls.value, ls.source_fact_id, o.provenance, `option ${o.id} lever ${ls.factor_id}`);
      }
    }
    for (const f of input.rich.factors ?? []) {
      anchored(f.current_value, f.source_fact_id, f.provenance, `factor ${f.id}`);
    }
    for (const c of input.rich.constraints ?? []) {
      anchored(c.value, c.source_fact_id, c.provenance, `constraint ${c.id}`);
    }
  }

  if (input.graph) {
    channels.push("graph: every number whose provenance token classifies as USER");
    const check = (value: number | null, unit: string | null, source: string | null, where: string) => {
      if (value == null) return;
      if (classifyProvenance(source) !== "user") return;
      inspected++;
      const r = valueAppearsIn(value, input.brief.body);
      if (!r.found) {
        violations.push(`${where} carries ${value}${unit ? " " + unit : ""} with user provenance "${source}" — absent from the brief text`);
      }
    };
    for (const node of input.graph.nodes) {
      for (const iv of readInterventions(node)) {
        check(iv.native ?? iv.normalised, iv.unit, iv.source, `intervention ${iv.optionId}->${iv.factorId}`);
      }
      for (const nv of readNodeValues(node)) {
        check(nv.native ?? nv.normalised, nv.unit, nv.source, nv.path);
      }
    }
    for (const gc of input.graph.goal_constraints ?? []) {
      check(gc.value ?? null, gc.unit ?? null, gc.provenance ?? null, `goal_constraint ${gc.constraint_id ?? gc.node_id}`);
    }
  }

  return { violations, inspected, channels };
}

export function gateG2(input: GateInput): GateResult {
  const { violations, inspected, channels } = findLaunderedNumbers(input);
  const searched = `inspected ${inspected} user-provenance number(s) across ${channels.join(" + ") || "no candidate supplied"}`;
  if (violations.length > 0) {
    return { gate: "G2", status: "FAIL", evidence: `${violations.length} fabricated user quantity/quantities: ${violations.join("; ")}. ${searched}` };
  }
  if (inspected === 0) {
    return { gate: "G2", status: "NA", evidence: `no user-provenance number to inspect. ${searched}` };
  }
  return { gate: "G2", status: "PASS", evidence: `no user-provenance number is absent from the brief. ${searched}` };
}

// =============================================================================
// G3 — no unlabelled / unknown-provenance numeric baseline
// =============================================================================

export function gateG3(input: GateInput): GateResult {
  const violations: string[] = [];
  let inspected = 0;
  const channels: string[] = [];

  if (input.rich) {
    channels.push("rich: factor.current_value and lever_setting.value under an anchor-requiring epistemic state");
    for (const f of input.rich.factors ?? []) {
      if (f.current_value == null) continue;
      inspected++;
      if (ANCHOR_REQUIRED_STATES.includes(f.epistemic_state) && f.source_fact_id == null) {
        violations.push(`factor ${f.id} ("${f.label}") carries current_value ${f.current_value} with epistemic_state "${f.epistemic_state}" and NO source_fact_id`);
      }
    }
    for (const o of input.rich.options ?? []) {
      for (const ls of o.lever_settings ?? []) {
        if (ls.value == null) continue;
        inspected++;
        if (ANCHOR_REQUIRED_STATES.includes(ls.epistemic_state) && ls.source_fact_id == null) {
          violations.push(`option ${o.id} lever ${ls.factor_id} carries ${ls.value} with epistemic_state "${ls.epistemic_state}" and NO source_fact_id`);
        }
      }
    }
  }

  if (input.graph) {
    channels.push("graph: wire interventions (empty source slot = fail-open), node.observed_state, node.data, goal_constraints[]");
    const check = (
      value: number | null,
      source: string | null,
      hasSlot: boolean,
      where: string
    ) => {
      if (value == null) return;
      inspected++;
      const cls = classifyProvenance(source);
      if (cls === "unknown") {
        if (!hasSlot && source == null) {
          // No provenance slot exists on this shape and the node inherited none.
          violations.push(`${where} carries ${value} and NOTHING labels its provenance (no slot on this shape, no node-level provenance)`);
          return;
        }
        violations.push(`${where} carries ${value} with provenance ${source == null ? "ABSENT" : `"${source}"`} — unrecognised, and absence must never default to user authority (schema-v3.ts:457)`);
        return;
      }
      if (cls === "user") {
        const r = valueAppearsIn(value, input.brief.body);
        if (!r.found) {
          violations.push(`${where} carries ${value} labelled "${source}" (user authority) but that magnitude is not in the brief`);
        }
      }
    };
    for (const node of input.graph.nodes) {
      for (const iv of readInterventions(node)) {
        check(iv.native ?? iv.normalised, iv.source, iv.hasSourceSlot, `intervention ${iv.optionId}->${iv.factorId}`);
      }
      for (const nv of readNodeValues(node)) {
        check(nv.native ?? nv.normalised, nv.source, nv.hasSourceSlot, nv.path);
      }
    }
    for (const gc of input.graph.goal_constraints ?? []) {
      check(gc.value ?? null, gc.provenance ?? null, true, `goal_constraint ${gc.constraint_id ?? gc.node_id}`);
    }
  }

  const searched = `inspected ${inspected} numeric baseline(s) across ${channels.join(" + ") || "no candidate supplied"}`;
  if (violations.length > 0) {
    return { gate: "G3", status: "FAIL", evidence: `${violations.length} unlabelled/unknown-provenance baseline(s): ${violations.join("; ")}. ${searched}` };
  }
  if (inspected === 0) {
    return { gate: "G3", status: "NA", evidence: `no numeric baseline to inspect. ${searched}` };
  }
  return { gate: "G3", status: "PASS", evidence: `every numeric baseline carries a recognised provenance label. ${searched}` };
}

// =============================================================================
// G4 — a strict constraint must not become a bare `<=`
// =============================================================================

const STRICT_OPERATORS = new Set(["<", ">"]);

export function gateG4(input: GateInput): GateResult {
  const expected = (input.brief.meta.expected_constraints ?? []).filter((c) => c.strict === true);
  if (expected.length === 0) {
    return { gate: "G4", status: "NA", evidence: "brief declares no strict constraint" };
  }

  const findings: string[] = [];
  const violations: string[] = [];

  for (const want of expected) {
    const keyword = want.keyword.toLowerCase();
    let satisfied: string | null = null;
    let seen: string[] = [];

    if (input.rich) {
      const labelOf = new Map<string, string>();
      for (const f of input.rich.factors ?? []) labelOf.set(f.id, f.label);
      for (const o of input.rich.outcomes ?? []) labelOf.set(o.id, o.label);
      for (const c of input.rich.constraints ?? []) {
        const subject = (labelOf.get(c.subject_id) ?? c.subject_id).toLowerCase();
        if (!subject.includes(keyword) && !c.subject_id.toLowerCase().includes(keyword)) continue;
        seen.push(`rich constraint ${c.id}: "${c.operator}" on ${c.subject_id}`);
        if (STRICT_OPERATORS.has(c.operator)) {
          satisfied = `rich constraint ${c.id} carries operator "${c.operator}" on ${c.subject_id}`;
        }
      }
    }

    if (!satisfied && input.graph) {
      const labelOf = new Map<string, string>();
      for (const n of input.graph.nodes) labelOf.set(n.id, n.label ?? n.id);
      for (const gc of input.graph.goal_constraints ?? []) {
        const hay = [gc.label ?? "", gc.node_id ?? "", labelOf.get(gc.node_id) ?? ""].join(" ").toLowerCase();
        if (!hay.includes(keyword)) continue;
        // ⚠ Labels are NEVER read for strictness — constraint-display-name.ts:145
        // GENERATES "at or below" from `<=`. Only the operator and the explicit
        // disclosure fields count.
        seen.push(`graph ${gc.constraint_id ?? gc.node_id}: operator "${gc.operator ?? "ABSENT"}", strictness ${gc.strictness ?? "ABSENT"}, relaxed_to ${gc.relaxed_to ?? "ABSENT"}`);
        if (gc.operator != null && STRICT_OPERATORS.has(gc.operator)) {
          satisfied = `graph ${gc.constraint_id ?? gc.node_id} carries operator "${gc.operator}"`;
        } else if (gc.strictness === "strict" && gc.relaxed_to != null) {
          satisfied = `graph ${gc.constraint_id ?? gc.node_id} discloses strictness:"strict" relaxed_to:"${gc.relaxed_to}"`;
        }
      }
    }

    if (satisfied) findings.push(`"${want.keyword}" ${satisfied}`);
    else {
      violations.push(
        `"${want.keyword}" (brief: "${want.quote ?? "strict bound"}") is strict, but the candidate carries ${seen.length > 0 ? seen.join(" | ") : "NO matching constraint at all"} — a bare "<=" with no strictness/relaxed_to disclosure is a FAIL`
      );
    }
  }

  const note =
    "operators and disclosure fields only; labels are not evidence (constraint-display-name.ts:145 generates \"at or below\" from \"<=\")";
  if (violations.length > 0) {
    return { gate: "G4", status: "FAIL", evidence: `${violations.length}/${expected.length} strict constraint(s) not preserved or disclosed: ${violations.join("; ")}. Checked ${note}` };
  }
  return { gate: "G4", status: "PASS", evidence: `all ${expected.length} strict constraint(s) preserved: ${findings.join("; ")}. Checked ${note}` };
}

// =============================================================================
// G5 — semantic duplicate of a user option
// =============================================================================

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "with", "for", "at", "in", "on", "by",
  "from", "as", "is", "are", "be", "our", "we", "it", "this", "that", "per", "into",
]);

export function contentTokens(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9£$€%.]+/)
      .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

/** |intersection| / |smaller set| — 1.0 when one label's tokens are a subset. */
export function labelOverlap(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export const LABEL_FLAG_THRESHOLD = 0.8;

interface OptionView {
  id: string;
  label: string;
  isUser: boolean;
  /** Signature over LEGITIMATE lever targets only — see the note below. */
  signature: string;
  fullSignature: string;
}

function optionViews(input: GateInput): OptionView[] {
  const { ids: illegit } = illegitimateTargets(input);
  const sign = (entries: Array<[string, number | null]>, filter: boolean): string =>
    entries
      .filter(([fid]) => (filter ? !illegit.has(fid) : true))
      .map(([fid, v]) => `${fid}:${(v ?? Number.NaN).toFixed(4)}`)
      .sort()
      .join("|");

  const views: OptionView[] = [];
  if (input.rich) {
    for (const o of input.rich.options ?? []) {
      const entries = (o.lever_settings ?? []).map((ls) => [ls.factor_id, ls.value] as [string, number | null]);
      views.push({ id: o.id, label: o.label, isUser: o.provenance === "user", signature: sign(entries, true), fullSignature: sign(entries, false) });
    }
    return views;
  }
  if (input.graph) {
    for (const node of optionNodes(input.graph)) {
      const entries = readInterventions(node).map((iv) => [iv.factorId, iv.native ?? iv.normalised] as [string, number | null]);
      views.push({
        id: node.id,
        label: node.label ?? node.id,
        isUser: classifyProvenance(node.provenance) === "user",
        signature: sign(entries, true),
        fullSignature: sign(entries, false),
      });
    }
  }
  return views;
}

export function gateG5(input: GateInput): GateResult {
  const views = optionViews(input);
  if (views.length < 2) {
    return { gate: "G5", status: "NA", evidence: `fewer than two options (${views.length}) — nothing to compare` };
  }

  const duplicates: string[] = [];
  const flags: string[] = [];

  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const a = views[i]!;
      const b = views[j]!;
      // An empty signature on BOTH sides means neither option sets a legitimate
      // lever — not comparable, and never a duplicate finding.
      if (a.signature === "" && b.signature === "") continue;
      if (a.signature === b.signature) {
        const full = a.fullSignature === b.fullSignature
          ? "identical on the full intervention map too"
          : `the FULL map differs — they are separated only by an intervention G6 rejects (${a.id}: "${a.fullSignature}" vs ${b.id}: "${b.fullSignature}")`;
        duplicates.push(
          `${a.id} ("${a.label}")${a.isUser ? " [USER OPTION]" : ""} == ${b.id} ("${b.label}")${b.isUser ? " [USER OPTION]" : ""} on the legitimate-lever projection "${a.signature}"; ${full}`
        );
      }
      const overlap = labelOverlap(a.label, b.label);
      if (overlap >= LABEL_FLAG_THRESHOLD) {
        flags.push(`${a.id} / ${b.id} share ${(overlap * 100).toFixed(1)}% of the smaller label's content tokens`);
      }
    }
  }

  const rule =
    "deterministic pre-check = identical lever set AND values (4dp) over targets G6 permits; a label-token overlap >= 0.8 only FLAGS for the judge";
  if (duplicates.length > 0) {
    return { gate: "G5", status: "FAIL", evidence: `${duplicates.length} semantic duplicate(s): ${duplicates.join("; ")}. ${flags.length} judge flag(s): ${flags.join("; ") || "none"}. Rule: ${rule}` };
  }
  return { gate: "G5", status: "PASS", evidence: `no deterministic duplicate across ${views.length} options. ${flags.length} judge flag(s): ${flags.join("; ") || "none"}. Rule: ${rule}` };
}

// =============================================================================
// G6 — no lever/intervention on a constrained factor or an outcome/risk
// =============================================================================

export function gateG6(input: GateInput): GateResult {
  const { ids: illegit, why } = illegitimateTargets(input);
  const violations: string[] = [];
  let inspected = 0;

  if (input.rich) {
    for (const o of input.rich.options ?? []) {
      for (const ls of o.lever_settings ?? []) {
        inspected++;
        if (illegit.has(ls.factor_id)) {
          violations.push(`option ${o.id} sets ${ls.factor_id}, which is ${why.get(ls.factor_id)}`);
        }
      }
    }
  }
  if (input.graph) {
    for (const node of optionNodes(input.graph)) {
      for (const iv of readInterventions(node)) {
        inspected++;
        if (illegit.has(iv.factorId)) {
          violations.push(`option ${iv.optionId} intervenes on ${iv.factorId}, which is ${why.get(iv.factorId)}`);
        }
      }
    }
  }

  const searched = `inspected ${inspected} lever setting(s)/intervention(s) against ${illegit.size} forbidden target(s)`;
  if (inspected === 0) {
    return { gate: "G6", status: "NA", evidence: `no lever settings or interventions present. ${searched}` };
  }
  if (violations.length > 0) {
    return { gate: "G6", status: "FAIL", evidence: `${violations.length} intervention(s) on a constrained/outcome quantity: ${violations.join("; ")}. ${searched}` };
  }
  return { gate: "G6", status: "PASS", evidence: `no intervention targets a constrained quantity or an outcome/risk. ${searched}` };
}

// =============================================================================
// G7 — expected temporal / qualitative items survive
// =============================================================================

/**
 * The searched surface DELIBERATELY EXCLUDES `decision.question` and
 * `user_facts[].source_quote`: both are verbatim echoes of the brief, so a
 * candidate that quoted the brief and then modelled none of it would pass
 * vacuously. What counts is whether the item reached the MODEL.
 */
function richSearchSurface(rich: RichModelLike): string[] {
  const out: string[] = [];
  for (const o of rich.options ?? []) {
    out.push(o.label);
    if (o.rationale) out.push(o.rationale);
  }
  for (const f of rich.factors ?? []) out.push(f.label);
  for (const o of rich.outcomes ?? []) out.push(o.label);
  for (const l of rich.causal_links ?? []) {
    if (l.rationale) out.push(l.rationale);
    if (l.magnitude?.note) out.push(l.magnitude.note);
    if (l.temporal?.delay) out.push(l.temporal.delay);
    if (l.temporal?.duration) out.push(l.temporal.duration);
    if (l.temporal?.note) out.push(l.temporal.note);
  }
  for (const u of rich.unknowns ?? []) out.push(u.question);
  for (const n of rich.notes ?? []) out.push(n.text);
  return out;
}

export function gateG7(input: GateInput): GateResult {
  const expected = [
    ...(input.brief.meta.expected_temporal ?? []).map((k) => ({ keyword: k, kind: "temporal" })),
    ...(input.brief.meta.expected_qualitative ?? []).map((k) => ({ keyword: k, kind: "qualitative" })),
  ];
  if (expected.length === 0) {
    return { gate: "G7", status: "NA", evidence: "brief declares no expected_temporal or expected_qualitative items" };
  }
  if (!input.rich) {
    return {
      gate: "G7",
      status: "NA",
      evidence: `graph cannot carry: a GraphV3 body has no slot for the ${expected.length} declared temporal/qualitative item(s) (${expected.map((e) => e.keyword).join(", ")}); scoring a graph here would double-count G1's horizon and punish the format, not the candidate`,
    };
  }

  const surface = richSearchSurface(input.rich).join("\n").toLowerCase();
  const missing = expected.filter((e) => !surface.includes(e.keyword.toLowerCase()));
  const searched =
    "searched option/factor/outcome labels, option+link rationales, causal_links.temporal.{delay,duration,note}, magnitude.note, unknowns[].question, notes[].text — decision.question and user_facts[].source_quote EXCLUDED (verbatim echoes)";
  if (missing.length > 0) {
    return { gate: "G7", status: "FAIL", evidence: `${missing.length}/${expected.length} declared item(s) absent from the rich model: ${missing.map((m) => `${m.kind} "${m.keyword}"`).join(", ")}. ${searched}` };
  }
  return { gate: "G7", status: "PASS", evidence: `all ${expected.length} declared temporal/qualitative item(s) present. ${searched}` };
}

// =============================================================================
// G8 — no unknown promoted to a point estimate
// =============================================================================

/**
 * ⚠ DEVIATION FROM THE DISPATCH WORDING, and why.
 *
 * The dispatch says "every numeric value on an ai_proposed item has
 * epistemic_state ai_hypothesis and kind ai_estimate with a rationale". Measured
 * against contracts/rich-decision-model.v0.json there is NO item-level
 * `kind: ai_estimate` — the only `ai_estimate` member is
 * `causal_links[].magnitude.kind`. And the real banked builder output has an
 * `ai_proposed` STATUS-QUO option whose lever value is the user's own £49 with a
 * valid `source_fact_id`. That is correct behaviour; the literal rule would fail
 * it. Implemented instead, in three limbs:
 *
 *   (a) any non-null value under `epistemic_state: "unknown"`  — the gate's title;
 *   (b) any number on an AI-provenance item with NO anchor and an epistemic state
 *       that is neither `ai_hypothesis` nor `external_evidence` — the dispatch's
 *       intent: an unsourced AI number must be labelled a hypothesis;
 *   (c) `causal_links[].magnitude.kind === "ai_estimate"` with a non-null value
 *       and no rationale — where `ai_estimate` actually lives.
 */
export function gateG8(input: GateInput): GateResult {
  if (!input.rich) {
    return {
      gate: "G8",
      status: "NA",
      evidence: "no rich model supplied; epistemic state is not representable in GraphV3, so this gate cannot be evaluated on a bare graph",
    };
  }
  const violations: string[] = [];
  let inspected = 0;

  const checkValue = (
    value: number | null,
    state: RichEpistemicState,
    sourceFactId: string | null,
    provenance: string,
    where: string
  ) => {
    if (value == null) return;
    inspected++;
    if (state === "unknown") {
      violations.push(`(a) ${where} carries the point estimate ${value} while its epistemic_state is "unknown"`);
      return;
    }
    const isAi = provenance === "ai_proposed" || provenance === "ai_hypothesis";
    if (isAi && sourceFactId == null && state !== "ai_hypothesis" && state !== "external_evidence") {
      violations.push(`(b) ${where} is AI-provenance, carries ${value}, has NO source_fact_id, and claims epistemic_state "${state}" instead of ai_hypothesis`);
    }
  };

  for (const f of input.rich.factors ?? []) {
    checkValue(f.current_value, f.epistemic_state, f.source_fact_id, f.provenance, `factor ${f.id} ("${f.label}")`);
  }
  for (const o of input.rich.options ?? []) {
    for (const ls of o.lever_settings ?? []) {
      checkValue(ls.value, ls.epistemic_state, ls.source_fact_id, o.provenance, `option ${o.id} lever ${ls.factor_id}`);
    }
  }
  for (const l of input.rich.causal_links ?? []) {
    const m = l.magnitude;
    if (m == null) continue;
    if (m.kind === "ai_estimate" && m.value != null) {
      inspected++;
      const hasRationale = (l.rationale ?? "").trim() !== "" || (m.note ?? "").trim() !== "";
      if (!hasRationale) {
        violations.push(`(c) causal_link ${l.id} carries an ai_estimate magnitude ${m.value} with no rationale and no note`);
      }
    }
  }

  const searched = `inspected ${inspected} numeric value(s) across rich factors, option lever_settings and causal_links[].magnitude`;
  if (violations.length > 0) {
    return { gate: "G8", status: "FAIL", evidence: `${violations.length} unknown(s) promoted to false precision: ${violations.join("; ")}. ${searched}` };
  }
  return { gate: "G8", status: "PASS", evidence: `no unknown promoted to a point estimate. ${searched}` };
}

// =============================================================================
// G9 — post-projection provenance (amendment 2)
// =============================================================================

/**
 * `user` must project to `brief_extraction` / `from_brief`; `ai_proposed` /
 * `ai_hypothesis` must project to `cee_hypothesis` / `ai_inferred`. A projected
 * number whose rich source is MISSING, or which carries no graph provenance at
 * all, is a FAIL: UNKNOWN PROVENANCE CANNOT DEFAULT TO USER AUTHORITY — that is
 * the `schema-v3.ts:457` fail-open shape, inverted.
 */
export function checkProjectionProvenance(
  rich: RichModelLike | null,
  projected: ProjectedGraphLike | null
): GateResult {
  if (rich == null || projected == null) {
    return { gate: "G9", status: "NA", evidence: "requires BOTH a rich model and its projection" };
  }

  /**
   * The class of a PROJECTED NUMBER is the class of the RICH ITEM THAT SUPPLIED
   * THAT NUMBER — not of the item that happens to host it. An `ai_proposed`
   * status-quo option whose lever value is the user's own £49 (anchored by
   * `source_fact_id`) projects that number as `brief_extraction`, and that is
   * CORRECT: "user-bound values stay user-bound" (amendment 2).
   *
   * That anchor cannot be used to launder: G2 fails a dangling `source_fact_id`
   * and fails a value its anchor's quote does not support. G9 and G2 compose;
   * neither alone is sufficient.
   */
  const classOf = new Map<string, ProvenanceClass>();
  const anchored = (sourceFactId: string | null, provenance: string): ProvenanceClass =>
    sourceFactId != null ? "user" : provenance === "user" ? "user" : "ai";

  for (const o of rich.options ?? []) {
    classOf.set(`option:${o.id}`, anchored(o.source_fact_id, o.provenance));
    for (const ls of o.lever_settings ?? []) {
      classOf.set(`intervention:${o.id}:${ls.factor_id}`, anchored(ls.source_fact_id, o.provenance));
    }
  }
  for (const f of rich.factors ?? []) {
    classOf.set(`node:${f.id}`, anchored(f.source_fact_id, f.provenance));
  }
  for (const o of rich.outcomes ?? []) {
    classOf.set(`node:${o.id}`, anchored(o.source_fact_id, o.provenance));
  }
  for (const c of rich.constraints ?? []) {
    const cls = anchored(c.source_fact_id, c.provenance);
    classOf.set(`constraint:${c.id}`, cls);
    classOf.set(`constraint:${c.subject_id}`, cls);
  }

  const violations: string[] = [];
  let inspected = 0;

  const compare = (key: string, graphProvenance: string | null | undefined, where: string) => {
    inspected++;
    const projectedClass = classifyProvenance(graphProvenance);
    if (projectedClass === "unknown") {
      violations.push(
        `${where} carries a number with provenance ${graphProvenance == null ? "ABSENT" : `"${graphProvenance}"`} — UNKNOWN PROVENANCE CANNOT DEFAULT TO USER AUTHORITY (the schema-v3.ts:457 fail-open shape, inverted)`
      );
      return;
    }
    const richClass = classOf.get(key);
    if (richClass == null) {
      violations.push(`${where} projects a number whose rich source (${key}) is MISSING from the model`);
      return;
    }
    if (richClass !== projectedClass) {
      violations.push(`${where} projects rich "${richClass}" content as graph "${graphProvenance}" (class ${projectedClass})`);
    }
  };

  for (const node of projected.nodes ?? []) {
    const hasNodeNumber =
      typeof node.observed_state?.value === "number" ||
      typeof node.observed_state?.raw_value === "number" ||
      typeof node.data?.value === "number" ||
      typeof node.data?.raw_value === "number";
    if (hasNodeNumber) {
      compare(`node:${node.id}`, node.observed_state?.source ?? node.provenance ?? null, `node ${node.id}`);
    }
    for (const [factorId, iv] of Object.entries(node.interventions ?? {})) {
      if (iv == null) continue;
      if (typeof iv.value !== "number" && typeof iv.raw_value !== "number") continue;
      compare(`intervention:${node.id}:${factorId}`, iv.source ?? null, `intervention ${node.id}->${factorId}`);
    }
  }
  for (const gc of projected.goal_constraints ?? []) {
    if (typeof gc.value !== "number") continue;
    const key = classOf.has(`constraint:${gc.constraint_id ?? ""}`)
      ? `constraint:${gc.constraint_id}`
      : `constraint:${gc.node_id}`;
    compare(key, gc.provenance ?? null, `goal_constraint ${gc.constraint_id ?? gc.node_id}`);
  }

  const searched = `inspected ${inspected} projected number(s) across nodes, interventions and goal_constraints`;
  if (inspected === 0) {
    return { gate: "G9", status: "NA", evidence: `the projection carries no numbers. ${searched}` };
  }
  if (violations.length > 0) {
    return { gate: "G9", status: "FAIL", evidence: `${violations.length} provenance violation(s) at projection: ${violations.join("; ")}. ${searched}` };
  }
  return { gate: "G9", status: "PASS", evidence: `every projected number's provenance equals its rich item's mapped provenance. ${searched}` };
}

// =============================================================================
// Runner
// =============================================================================

/** Run G1–G8 (G9 needs a projection — call `checkProjectionProvenance` directly). */
export function runTrustGates(input: GateInput): GateResult[] {
  return [gateG1(input), gateG2(input), gateG3(input), gateG4(input), gateG5(input), gateG6(input), gateG7(input), gateG8(input)];
}

/** A candidate is ADMISSIBLE when no gate FAILs. NA never blocks. */
export function gatesAdmit(results: GateResult[]): boolean {
  return results.every((r) => r.status !== "FAIL");
}
