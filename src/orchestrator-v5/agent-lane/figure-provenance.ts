/**
 * FIGURE PROVENANCE SCREEN — every money or percentage figure in a final reply either binds to something
 * the host supplied, or it is reported UNBOUND.
 *
 * WHY (AIQ #75 5913873948 row 1, #78 5913897696 PC-FIG): the served Agent told Paul the first pass was
 * "built on … £75,000 per qualified conversation". That figure sat on no node and no link — only in the
 * build's open questions — so the reply described a model the graph does not hold. A prompt sentence
 * cannot close that class (the Agent repeated a figure its own tool result handed it); a deterministic
 * screen over the final text can at least SEE it.
 *
 * WHAT IT ANSWERS, and nothing wider. For each currency or percentage amount in `text`
 * (read by the shared `findStatedAmounts` scanner, so the currency vocabulary is the house one):
 *   - `user`    — the same kind and magnitude appears in text the user submitted;
 *   - `graph`   — it equals a stored raw figure, bound BY ID: a node's `observed_state.raw_value`, an
 *                 option's `interventions.<factor>.raw_value`, a goal's `goal_threshold_raw`, or a limit's
 *                 `goal_constraints[].value` (by `constraint_id`). Links hold no raw figures (strength and
 *                 existence only), so none bind there;
 *   - `proposal` — it appears in a proposal this turn put on an approval card (Olumi's proposed value, shown as
 *                 a proposal: the gate's PC01 starting point carries 10% / 15% / £59 / 2.5% this way). `labelled`
 *                 says whether its sentence presents it as proposed — a proposal value stated as fact is not fair;
 *   - `run`     — it equals, within the precision it was written to, one of the current Run's TYPED figures
 *                 (`{ option_id, value, measure, run_hash }`, the shape #2368's `SelectedRunFigure` serves);
 *   - `engine`  — until those are served: a number in the supplied `analysis_result`, same precision rule
 *                 (a percentage also matches a 0–1 share ×100); the JSON path is kept;
 *   - `arithmetic` — shown one-step arithmetic (AIQ 5913527149 G1: "£180k / £45k ≈ 4 months"): the SAME
 *                 sentence carries an operator and two operands that each bind as above (plain numbers, and
 *                 figures bound earlier in that sentence, may be operands), and one of a+b, a−b, a×b, a÷b or
 *                 a÷b×100 (for a percentage) equals the figure within its written precision;
 *   - `derived_operands_not_shown` — not shown, but ONE step from bound figures reaches it: a op b over the
 *                 user's figures, stored figures, Run figures and figures the reply already bound; k×a or a÷k
 *                 where the count k is NAMED in the figure's sentence (or a half / 50-50 split is named there or
 *                 in the latest user message); or a + k×b (a headcount mix). A wording defect under the v0.2
 *                 CALCULATION BOUNDARY (show the operands, name the choice), not an invention (AIQ 5914617046);
 *   - `no_source` — none of these. The invention class (G1 hard fail).
 *
 * ⚠ DERIVABLE IS NOT PERMITTED. A figure one step from the user's own can still be a forbidden forecast of an
 * option's outcome; that is a meaning judgement this module does not make. Counts must be named because an
 * unnamed k collides: on COACH-Q1 S07, "5.6% compounded" (a compounding projection) equals 38.9% ÷ 7 to the
 * precision written.
 *
 * Boundary (AIQ 5914447316): a DETECTOR — trace first, then a gate row. Never an egress rewriter; the fix for an
 * UNBOUND figure is at the input (the typed context the Agent was given).
 *
 * ⚠ A SCREEN, NOT ATTESTATION. Binding is value equality: a bound figure has a place it could have come
 * from, which is not proof the reply used it correctly (units, period and meaning are not checked here).
 * The useful direction is the other one: UNBOUND means no supplied source holds that magnitude at all.
 * Plain numbers ("30 firms", "2 months") are NOT screened — counts and durations are too collision-prone
 * for value equality, and the class this answers is money and percentages.
 *
 * Pure. Never throws. Unknown shapes read as "nothing to bind to", the fail-toward-UNBOUND direction.
 */
import { findStatedAmounts, type AmountKind } from "../../cee/provenance/stated-amounts.js";

export type FigureBinding =
  | { readonly source: "user" }
  | { readonly source: "graph"; readonly node_id: string; readonly field: string }
  | { readonly source: "proposal"; readonly proposal_id: string; readonly labelled: boolean }
  | { readonly source: "run"; readonly option_id: string | null; readonly measure: string; readonly run_hash: string }
  | { readonly source: "engine"; readonly path: string }
  | { readonly source: "arithmetic"; readonly op: ArithmeticOp; readonly operands: readonly [string, string] }
  | { readonly source: "derived_operands_not_shown"; readonly op: ArithmeticOp | "k*" | "/k" | "+k*"; readonly operands: readonly string[] }
  | { readonly source: "no_source" };

/** `%` is a ÷ b × 100, for a percentage. */
export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";

export interface ScreenedFigure {
  readonly literal: string;
  readonly index: number;
  readonly kind: Exclude<AmountKind, "plain">;
  readonly magnitude: number;
  readonly binding: FigureBinding;
}

export interface FigureProvenanceInput {
  readonly text: string;
  /** Text the user submitted (brief, messages). */
  readonly userTexts: readonly string[];
  /** The model state the reply was written against (`{ nodes, edges }`). */
  readonly graph: unknown;
  /** Proposals this turn put on an approval card (Olumi's proposed values, not stored until approved). */
  readonly proposals?: readonly { readonly proposal_id: string; readonly text: string }[];
  /** The current Run's typed figures, when served (#2368 `SelectedRunFigure`). */
  readonly runFigures?: readonly { readonly option_id?: string; readonly value: number; readonly measure: string; readonly run_hash: string }[];
  /** Supplied engine output, if any was current for this reply. */
  readonly analysisResult?: unknown;
}

export interface FigureProvenanceScreen {
  readonly figures: readonly ScreenedFigure[];
  /** Both classes below: no supplied source holds the figure as written. */
  readonly unbound: readonly ScreenedFigure[];
  /** No source and no one-step derivation: the invention class. */
  readonly no_source: readonly ScreenedFigure[];
  /** One step from bound figures, operands not shown: the wording class. */
  readonly operands_not_shown: readonly ScreenedFigure[];
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Half a unit of the last digit as written: "48.9%" → 0.05, "£1.2m" → 50,000, "£75,000" → 0.5. */
function writtenTolerance(literal: string, magnitude: number): number {
  const digits = /(\d[\d,]*)(?:\.(\d+))?/.exec(literal);
  if (digits === null) return 0;
  const decimals = digits[2]?.length ?? 0;
  const asWritten = Number.parseFloat(`${digits[1]!.replace(/,/g, "")}${decimals ? `.${digits[2]}` : ""}`);
  const scale = asWritten > 0 ? magnitude / asWritten : 1;
  return (0.5 * 10 ** -decimals) * scale;
}

interface GraphFigure { readonly value: number; readonly node_id: string; readonly field: string }

function graphFigures(graph: unknown): GraphFigure[] {
  const out: GraphFigure[] = [];
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const n of nodes) {
    if (!isRec(n) || typeof n.id !== "string") continue;
    const observed = isRec(n.observed_state) ? num(n.observed_state.raw_value) : null;
    if (observed !== null) out.push({ value: observed, node_id: n.id, field: "observed_state.raw_value" });
    const threshold = num(n.goal_threshold_raw);
    if (threshold !== null) out.push({ value: threshold, node_id: n.id, field: "goal_threshold_raw" });
    if (isRec(n.interventions)) {
      for (const [factor, iv] of Object.entries(n.interventions)) {
        const raw = isRec(iv) ? num(iv.raw_value) : null;
        if (raw !== null) out.push({ value: raw, node_id: n.id, field: `interventions.${factor}.raw_value` });
      }
    }
  }
  const constraints = isRec(graph) && Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [];
  for (const c of constraints) {
    const v = isRec(c) ? num(c.value) : null;
    if (v !== null && isRec(c) && typeof c.constraint_id === "string") {
      out.push({ value: v, node_id: typeof c.node_id === "string" ? c.node_id : c.constraint_id, field: `goal_constraints.${c.constraint_id}.value` });
    }
  }
  return out;
}

/**
 * Engine leaves that are ordinals, counts or bookkeeping, not figures: "4%" once bound to an `influence_rank` of 4
 * (PC03 reply on the C10 capture, found by this module's first real probe). Skipped so they cannot bind.
 */
const STRUCTURAL_KEY = /(rank|count|index|seed|degree|sample|version|iteration|^n_|_n$|_ms$|^ms$)/i;

function engineNumbers(result: unknown): { value: number; path: string }[] {
  const out: { value: number; path: string }[] = [];
  const walk = (x: unknown, path: string, key: string, depth: number): void => {
    if (depth > 12) return;
    const v = num(x);
    if (v !== null) { if (!STRUCTURAL_KEY.test(key)) out.push({ value: v, path }); return; }
    if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`, key, depth + 1));
    else if (isRec(x)) for (const [k, y] of Object.entries(x)) walk(y, path ? `${path}.${k}` : k, k, depth + 1);
  };
  walk(result, "", "", 0);
  return out;
}

const ARITHMETIC_MARKER = /[×*÷/+=≈−]|\s[x-]\s|\b(?:minus|plus|times|divided by|less)\b/i;
const OPS: readonly { op: ArithmeticOp; f: (a: number, b: number) => number }[] = [
  { op: "+", f: (a, b) => a + b }, { op: "-", f: (a, b) => a - b }, { op: "*", f: (a, b) => a * b },
  { op: "/", f: (a, b) => (b === 0 ? NaN : a / b) }, { op: "%", f: (a, b) => (b === 0 ? NaN : (a / b) * 100) },
];
/**
 * A proposal value is fair only when the reply presents it AS proposed (AIQ 5914807462): its sentence (a table row
 * is one) says so. `labelled: false` is for the meaning pass to read — a proposal value stated as fact.
 */
const PROPOSAL_LABEL = /\b(?:propos|illustrativ|assum|estimat|suggest|starting (?:point|level|value)|olumi[’']s|not (?:a )?measure)/i;
const COUNT_WORDS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const HALF_CUE = /\b(?:half|halves|50\s*\/\s*50|50-50|split (?:it )?(?:evenly|equally))\b/i;

/** Counts 2–12 NAMED in `text` (digits or words), plus 2 for a named half / 50-50 split. */
function namedCounts(text: string): Set<number> {
  const out = new Set<number>();
  // Read with the house scanner so digits inside "38.9%" or "£28,000" are never counts (a leaked 9 once let a
  // compounding projection pass as a named split).
  for (const a of findStatedAmounts(text)) if (a.kind === "plain" && Number.isInteger(a.magnitude) && a.magnitude >= 2 && a.magnitude <= 12) out.add(a.magnitude);
  for (const m of text.toLowerCase().matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g)) out.add(COUNT_WORDS[m[1]!]!);
  if (HALF_CUE.test(text)) out.add(2);
  return out;
}

/** The sentence around `index`: a full stop, ! or ? followed by whitespace, or a line break, ends one ("48.9" does not). */
function sentenceAround(text: string, index: number): { start: number; end: number } {
  const ends = /[.!?](?=\s)|\n/g;
  let start = 0;
  for (let m = ends.exec(text); m !== null; m = ends.exec(text)) {
    if (m.index >= index) return { start, end: m.index };
    start = m.index + 1;
  }
  return { start, end: text.length };
}

type OperandKind = AmountKind | "stored";
interface Operand { readonly value: number; readonly label: string; readonly kind: OperandKind }
const moneyLike = (k: OperandKind) => k === "currency" || k === "stored";

/** Which operand kinds may combine into a figure of `kind` by `op` — money is not a count, a count is not money. */
function kindsFit(kind: "currency" | "percent", op: ArithmeticOp, a: OperandKind, b: OperandKind): boolean {
  if (kind === "currency") {
    if (op === "+" || op === "-") return moneyLike(a) && moneyLike(b);
    if (op === "*") return (moneyLike(a) && (b === "plain" || b === "stored")) || (moneyLike(b) && (a === "plain" || a === "stored"));
    if (op === "/") return moneyLike(a) && (b === "plain" || b === "stored");
    return false;
  }
  if (op === "%") return (moneyLike(a) && moneyLike(b)) || (a === "plain" && b === "plain");
  if (op === "+" || op === "-") return (a === "percent" || a === "stored") && (b === "percent" || b === "stored");
  return false;
}

export function screenFigureProvenance(input: FigureProvenanceInput): FigureProvenanceScreen {
  const text = typeof input.text === "string" ? input.text : "";
  const user = input.userTexts.flatMap((t) => findStatedAmounts(t));
  const latestUser = input.userTexts.length > 0 ? String(input.userTexts[input.userTexts.length - 1] ?? "") : "";
  const graph = graphFigures(input.graph);
  const proposed = (input.proposals ?? []).flatMap((p) => findStatedAmounts(p.text).map((amount) => ({ proposal_id: p.proposal_id, amount })));
  const run = (input.runFigures ?? []).filter((f) => num(f.value) !== null && typeof f.run_hash === "string");
  const engine = input.analysisResult === undefined ? [] : engineNumbers(input.analysisResult);
  const all = findStatedAmounts(text);

  /** Direct binding (user → graph → run → engine) for any amount, plain included (plain only as an operand). */
  const bindDirect = (a: (typeof all)[number]): FigureBinding => {
    const tol = writtenTolerance(a.matchedText, a.magnitude);
    const near = (v: number) => Math.abs(v - a.magnitude) <= tol;
    const u = user.find((s) => s.kind === a.kind && s.magnitude === a.magnitude
      && (a.kind !== "currency" || s.currencyCode === undefined || a.currencyCode === undefined || s.currencyCode === a.currencyCode));
    if (u !== undefined) return { source: "user" };
    const g = graph.find((f) => f.value === a.magnitude);
    if (g !== undefined) return { source: "graph", node_id: g.node_id, field: g.field };
    const p = proposed.find((x) => x.amount.kind === a.kind && x.amount.magnitude === a.magnitude);
    if (p !== undefined) {
      const s = sentenceAround(text, a.index);
      return { source: "proposal", proposal_id: p.proposal_id, labelled: PROPOSAL_LABEL.test(text.slice(s.start, s.end)) };
    }
    const r = run.find((f) => near(f.value));
    if (r !== undefined) return { source: "run", option_id: r.option_id ?? null, measure: r.measure, run_hash: r.run_hash };
    if (a.kind !== "plain") {
      const e = engine.find((f) => near(f.value) || (a.kind === "percent" && f.value >= 0 && f.value <= 1 && near(f.value * 100)));
      if (e !== undefined) return { source: "engine", path: e.path };
    }
    return { source: "no_source" };
  };

  // Operands a derivation may start from: the user's figures, stored figures, Run figures — and, as the reply is
  // read in order, its own figures once bound (each step one step from something written down).
  const pool: Operand[] = [
    ...user.map((u) => ({ value: u.magnitude, label: u.matchedText.trim(), kind: u.kind as OperandKind })),
    ...graph.map((g) => ({ value: g.value, label: `${g.node_id}.${g.field}`, kind: "stored" as const })),
    ...proposed.map((p) => ({ value: p.amount.magnitude, label: `${p.proposal_id}:${p.amount.matchedText.trim()}`, kind: p.amount.kind as OperandKind })),
    ...run.map((r) => ({ value: r.value, label: `run:${r.measure}`, kind: "stored" as const })),
  ];
  const sentenceBound = new Map<(typeof all)[number], FigureBinding>();

  const figures: ScreenedFigure[] = [];
  for (const a of all) {
    let binding = bindDirect(a);
    const s = sentenceAround(text, a.index);
    const sentence = text.slice(s.start, s.end);
    const tol = writtenTolerance(a.matchedText, a.magnitude);
    if (binding.source === "no_source" && a.kind !== "plain") {
      const operands = ARITHMETIC_MARKER.test(sentence.replace(a.matchedText, " "))
        ? all.filter((o) => o !== a && o.index >= s.start && o.index < s.end && (sentenceBound.get(o) ?? bindDirect(o)).source !== "no_source")
        : [];
      search: for (const x of operands) for (const y of operands) {
        if (x === y) continue;
        for (const { op, f } of OPS) {
          if (op === "%" && a.kind !== "percent") continue;
          const v = f(x.magnitude, y.magnitude);
          if (Number.isFinite(v) && Math.abs(v - a.magnitude) <= tol) {
            binding = { source: "arithmetic", op, operands: [x.matchedText.trim(), y.matchedText.trim()] };
            break search;
          }
        }
      }
    }
    if (binding.source === "no_source" && a.kind !== "plain") binding = derive(a.kind, a.magnitude, tol, pool, namedCounts(`${sentence} ${HALF_CUE.test(latestUser) ? "half" : ""}`)) ?? binding;
    if (binding.source !== "no_source") {
      // A figure the reply states and binds joins the pool, so each later step is one step from something written
      // down (headroom: £400k − £240k, where £240k was itself derived). A step whose intermediate is never written
      // (£72,000 × 59/49) still has no source.
      if (binding.source !== "derived_operands_not_shown") sentenceBound.set(a, binding);
      pool.push({ value: a.magnitude, label: a.matchedText.trim(), kind: a.kind });
    }
    if (a.kind !== "plain") figures.push({ literal: a.matchedText.trim(), index: a.index, kind: a.kind, magnitude: a.magnitude, binding });
  }
  const no_source = figures.filter((f) => f.binding.source === "no_source");
  const operands_not_shown = figures.filter((f) => f.binding.source === "derived_operands_not_shown");
  return { figures, unbound: [...no_source, ...operands_not_shown].sort((x, y) => x.index - y.index), no_source, operands_not_shown };
}

/** One step from the pool, or null. Counts come only from `counts` (named in the figure's sentence). */
function derive(kind: "currency" | "percent", target: number, tol: number, pool: readonly Operand[], counts: ReadonlySet<number>): FigureBinding | null {
  const hit = (v: number) => Number.isFinite(v) && Math.abs(v - target) <= tol;
  for (const x of pool) {
    for (const k of counts) {
      const scalable = kind === "currency" ? moneyLike(x.kind) : x.kind === "percent" || x.kind === "stored";
      if (!scalable) continue;
      if (hit(x.value * k)) return { source: "derived_operands_not_shown", op: "k*", operands: [x.label, String(k)] };
      if (hit(x.value / k)) return { source: "derived_operands_not_shown", op: "/k", operands: [x.label, String(k)] };
    }
  }
  for (const x of pool) for (const y of pool) {
    if (x === y) continue;
    for (const { op, f } of OPS) {
      if (!kindsFit(kind, op, x.kind, y.kind)) continue;
      if (hit(f(x.value, y.value))) return { source: "derived_operands_not_shown", op, operands: [x.label, y.label] };
    }
    if (kind === "currency" && moneyLike(x.kind) && moneyLike(y.kind)) {
      for (const k of counts) if (hit(x.value + k * y.value)) return { source: "derived_operands_not_shown", op: "+k*", operands: [x.label, String(k), y.label] };
    }
  }
  return null;
}
