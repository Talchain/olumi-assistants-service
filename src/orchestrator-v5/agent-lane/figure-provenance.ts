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
 *   - `run`     — it equals, within the precision it was written to, one of the current Run's TYPED figures
 *                 (`{ option_id, value, measure, run_hash }`, the shape #2368's `SelectedRunFigure` serves);
 *   - `engine`  — until those are served: a number in the supplied `analysis_result`, same precision rule
 *                 (a percentage also matches a 0–1 share ×100); the JSON path is kept;
 *   - `arithmetic` — shown one-step arithmetic (AIQ 5913527149 G1: "£180k / £45k ≈ 4 months"): the SAME
 *                 sentence carries an operator and two operands that each bind as above (plain numbers may
 *                 be operands), and one of a+b, a−b, a×b, a÷b equals the figure within its written precision;
 *   - `unbound` — none of these.
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
  | { readonly source: "run"; readonly option_id: string | null; readonly measure: string; readonly run_hash: string }
  | { readonly source: "engine"; readonly path: string }
  | { readonly source: "arithmetic"; readonly op: "+" | "-" | "*" | "/"; readonly operands: readonly [string, string] }
  | { readonly source: "unbound" };

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
  /** The current Run's typed figures, when served (#2368 `SelectedRunFigure`). */
  readonly runFigures?: readonly { readonly option_id?: string; readonly value: number; readonly measure: string; readonly run_hash: string }[];
  /** Supplied engine output, if any was current for this reply. */
  readonly analysisResult?: unknown;
}

export interface FigureProvenanceScreen {
  readonly figures: readonly ScreenedFigure[];
  readonly unbound: readonly ScreenedFigure[];
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
const OPS: readonly { op: "+" | "-" | "*" | "/"; f: (a: number, b: number) => number }[] = [
  { op: "+", f: (a, b) => a + b }, { op: "-", f: (a, b) => a - b }, { op: "*", f: (a, b) => a * b }, { op: "/", f: (a, b) => (b === 0 ? NaN : a / b) },
];

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

export function screenFigureProvenance(input: FigureProvenanceInput): FigureProvenanceScreen {
  const text = typeof input.text === "string" ? input.text : "";
  const user = input.userTexts.flatMap((t) => findStatedAmounts(t));
  const graph = graphFigures(input.graph);
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
    const r = run.find((f) => near(f.value));
    if (r !== undefined) return { source: "run", option_id: r.option_id ?? null, measure: r.measure, run_hash: r.run_hash };
    if (a.kind !== "plain") {
      const e = engine.find((f) => near(f.value) || (a.kind === "percent" && f.value >= 0 && f.value <= 1 && near(f.value * 100)));
      if (e !== undefined) return { source: "engine", path: e.path };
    }
    return { source: "unbound" };
  };

  const figures: ScreenedFigure[] = [];
  for (const a of all) {
    if (a.kind === "plain") continue;
    let binding = bindDirect(a);
    if (binding.source === "unbound") {
      const s = sentenceAround(text, a.index);
      const sentence = text.slice(s.start, s.end);
      const tol = writtenTolerance(a.matchedText, a.magnitude);
      const operands = ARITHMETIC_MARKER.test(sentence.replace(a.matchedText, " "))
        ? all.filter((o) => o !== a && o.index >= s.start && o.index < s.end && bindDirect(o).source !== "unbound")
        : [];
      search: for (const x of operands) for (const y of operands) {
        if (x === y) continue;
        for (const { op, f } of OPS) {
          const v = f(x.magnitude, y.magnitude);
          if (Number.isFinite(v) && Math.abs(v - a.magnitude) <= tol) {
            binding = { source: "arithmetic", op, operands: [x.matchedText.trim(), y.matchedText.trim()] };
            break search;
          }
        }
      }
    }
    figures.push({ literal: a.matchedText.trim(), index: a.index, kind: a.kind, magnitude: a.magnitude, binding });
  }
  return { figures, unbound: figures.filter((f) => f.binding.source === "unbound") };
}
