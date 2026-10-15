/**
 * ⭐ S7 STEP 1 — ONE RUN-FACTS PACKET (arch12/7-ai-scientific-coaching.md §3; DL 15 Oct 00:35Z, proof route approved 01:1xZ).
 * Every AI call after a Run (the interpreter, the Agent narrating, the method and widen turns) reads canonical state; this is
 * the ONE typed account of the selected CURRENT Run it reads there, built once by this builder from the owners' own readers
 * (never re-derived): the licence's chance facts (`goalChanceFactsForAgent`), each option's typed withheld reason (the Run's
 * `GOAL_FIGURES_*` records), whether sensitivity was measured (`decisionSensitivityOf`), how many of the Run's inputs are
 * Olumi's (the licence's census), the user's recorded statements (`userStatementsOn`) and the disclosures the AIE wrote that
 * apply (`must_say`: said exactly where they apply, checked present at egress). Typed facts and the AIE's exact phrases only:
 * no host coaching prose. Today's date and the brief travel in `turnContextItems` (#3175). Pure.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { decisionSensitivityOf } from './decision-sensitivity.js';
import { userStatementsOn } from '../statement-door/statements.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** One reason a figure is not shown, as the Run recorded it: its code, the options it covers, and its typed reason. */
export interface RunWithheld {
  readonly code: string;
  readonly option_ids: readonly string[];
  readonly reason?: string;
  /** The record's own words for it (the AI says what it means, in its own words, once). */
  readonly words?: string;
  /** The claims it holds back (`goal_probability`, `downside` …), as recorded. */
  readonly withheld_claims?: readonly string[];
}

export interface RunFacts {
  /** Whether these facts are the selected CURRENT Run's (a stale Run's facts are never read as current). */
  readonly current: boolean;
  /** The licence's chance facts, exactly as both Agent doors read them. */
  readonly chances: ReturnType<typeof goalChanceFactsForAgent>;
  readonly withheld: readonly RunWithheld[];
  readonly sensitivity: { readonly measured: boolean; readonly most_sensitive?: string };
  /** How many of THIS Run's inputs on the goal's paths are Olumi's estimates. */
  readonly olumi_inputs?: { readonly links: number; readonly values: number; readonly settings_by_option: Readonly<Record<string, number>> };
  /** The user's own recorded statements, verbatim, per node. */
  readonly user_statements: readonly { readonly node_id: string; readonly field: string; readonly said: readonly string[] }[];
  /** The AIE's exact disclosures that apply to THIS Run: each said once, word for word, where it applies. */
  readonly must_say: readonly string[];
}

const warningsOf = (result: unknown): Rec[] => {
  const r = isRec(result) ? result : undefined;
  return [isRec(r?.enrichment) ? r!.enrichment.inference_warnings : undefined, r?.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter(isRec);
};

/** The packet for the selected Run (`analysisResult`, the graph it reads, and whether it is current). */
export function runFactsOf(analysisResult: unknown, graph: unknown, current: boolean): RunFacts {
  const chances = goalChanceFactsForAgent(analysisResult, graph, current);
  const licence = current ? goalChanceLicenceForAgent(analysisResult) : undefined;
  const withheld: RunWithheld[] = current ? warningsOf(analysisResult).filter((w) => typeof w.code === 'string' && w.code.startsWith('GOAL_FIGURES_'))
    .map((w) => {
      const detail = isRec(w.detail) ? w.detail : undefined;
      const claims = strs(w.withheld_claims);
      return { code: String(w.code), option_ids: strs(w.option_ids), ...(typeof w.message === 'string' && w.message !== '' ? { words: w.message } : {}),
        ...(typeof detail?.reason === 'string' ? { reason: detail.reason } : {}), ...(claims.length > 0 ? { withheld_claims: claims } : {}) };
    }) : [];
  const enrichment = isRec(analysisResult) ? analysisResult.enrichment : undefined;
  const s = current ? decisionSensitivityOf(enrichment) : { status: 'not_measured' as const };
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const said = nodes.flatMap((n) => (typeof n.id !== 'string' ? [] : userStatementsOn(n).map((r) => ({ node_id: n.id as string, field: r.field,
    said: r.statements.map((x) => x.quote) }))));
  const census = licence?.olumi_estimate_link_count !== undefined || licence?.olumi_estimate_value_count !== undefined
    ? { links: licence.olumi_estimate_link_count ?? 0, values: licence.olumi_estimate_value_count ?? 0,
      settings_by_option: licence.olumi_estimate_settings_by_option ?? {} } : undefined;
  return {
    current,
    chances,
    withheld,
    sensitivity: s.status === 'measured' ? { measured: true, most_sensitive: s.most_sensitive.label } : { measured: false },
    ...(census !== undefined ? { olumi_inputs: census } : {}),
    user_statements: said,
    must_say: [...(chances.goal_chance_notes ?? [])],
  };
}
