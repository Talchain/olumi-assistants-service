/**
 * ⭐ ONE RULE FOR AN UNSIZED OLUMI RISK (DL 15 Oct 23:19Z; AIE #94 6177505214, which AMENDED the closed draft #3125). UI's joined
 * witness (capacity, CEE 358132d8): the first Run was held by Olumi's own risk ‘Specialist availability risk’ (MISSING_FACTOR_LEVEL,
 * no figure), the same class as an unsized option (an Olumi proposal nobody has sized, read as a Run blocker).
 *
 * A positively identified, still-provisional OLUMI risk suggestion that nobody has sized is kept in the saved model, visibly, and
 * left out of the Run's calculation: never sampled, never read as zero, never said as "doesn't happen" (AIE: deleting a root proves
 * no chance conditional on its absence). The host says once what the calculation leaves out, in the AIE's exact words. The Run
 * runs on everything supported; sizing the risk (the existing occurrence card) is coaching in addition, never the completion.
 *
 * In the set: a RISK with a unique id that
 *  · is OLUMI'S, by positive evidence only (`authorshipOf({ nodeTag })` is `ai`, i.e. the drafter's own `ai_inferred` label, or
 *    admission's `proposed_by: 'olumi'` stamp, `nodeIntroductionOf`). A risk the user stated or added, one from the brief's words,
 *    and one of unknown origin keep today's path and still ask (AIE: a missing or unknown stamp never enters this exception);
 *  · nobody has sized: no level by readiness's own rule (`riskHoldsALevel`) and no occurrence block at all;
 *  · is undecided (`analysis_participation` absent: an adopted risk asks; a `retained_excluded` one is already out);
 *  · is a ROOT on the goal's path, in the graph the Run sends: no cause drawn into it, and a directed path to a goal;
 *  · is not something the Run needs: no option sets it and no limit names it (those keep asking, as before).
 * Pure; read on the model as saved by readiness, the Run's and what-if's compute projection, and the host's line.
 */
import { authorshipOf, nodeIntroductionOf } from '../../cee/provenance/provenance-of.js';
import { limitNodeIds } from '../../graph/retained-limit.js';
import { riskHoldsALevel } from './risk-occurrence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Olumi's suggestion by positive evidence: the drafter's own label, or admission's stamp. Never by a missing stamp. */
const olumiSuggested = (n: Rec): boolean => authorshipOf({ nodeTag: n.provenance }).origin === 'ai'
  || nodeIntroductionOf(n).origin === 'olumi_added';

export function unsizedOlumiRiskIds(graph: unknown): ReadonlySet<string> {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return new Set();
  const nodes = graph.nodes.filter(isRec);
  const counts = new Map<unknown, number>();
  for (const n of nodes) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  // Judged on the graph the Run SENDS: a node kept out (`retained_excluded`) and its links are not sent.
  const keptOut = new Set(nodes.filter((n) => n.analysis_participation === 'retained_excluded').map((n) => n.id));
  const causal = (id: unknown): boolean => kindOf.has(id) && !keptOut.has(id) && !['option', 'decision', 'constraint'].includes(String(kindOf.get(id)));
  const edges = graph.edges.filter(isRec).filter((e) => e.edge_type !== 'bidirected' && causal(e.from) && causal(e.to));
  const needed = new Set<unknown>([
    ...nodes.filter((n) => n.kind === 'option').flatMap((n) => [n.interventions, isRec(n.data) ? n.data.interventions : undefined]
      .flatMap((i) => (isRec(i) ? Object.keys(i) : []))),
    ...limitNodeIds(graph),
  ]);
  const reachesGoal = (from: unknown): boolean => {
    const seen = new Set<unknown>([from]);
    for (const stack = [from]; stack.length > 0;) {
      const at = stack.pop();
      for (const e of edges) {
        if (e.from !== at || seen.has(e.to)) continue;
        if (kindOf.get(e.to) === 'goal') return true;
        seen.add(e.to);
        stack.push(e.to);
      }
    }
    return false;
  };
  return new Set(nodes.filter((n) => n.kind === 'risk' && typeof n.id === 'string' && counts.get(n.id) === 1
    && olumiSuggested(n) && n.analysis_participation === undefined
    && (n.event_risk === undefined || n.event_risk === null) && !riskHoldsALevel(n, graph)
    && !needed.has(n.id) && !edges.some((e) => e.to === n.id) && reachesGoal(n.id)).map((n) => n.id as string));
}

/**
 * The compute-only copy the Run and the what-if send: every {@link unsizedOlumiRiskIds} node, and every link touching it, left
 * out (PLoT refuses a dangling link end). Identity is read on the model as saved; this copy is never persisted.
 */
export function withoutUnsizedOlumiRisks<T>(graph: T, identityGraph: unknown = graph): T {
  const leftOut = unsizedOlumiRiskIds(identityGraph);
  if (leftOut.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  const touches = (e: unknown): boolean => isRec(e) && (leftOut.has(e.from as string) || leftOut.has(e.to as string));
  return { ...graph, nodes: graph.nodes.filter((n) => !(isRec(n) && leftOut.has(n.id as string))),
    ...(Array.isArray(graph.edges) ? { edges: graph.edges.filter((e) => !touches(e)) } : {}) } as T;
}

/**
 * The host's ONE line for an unsized Olumi risk, in the AIE's exact words (6177505214): "These chances cover…" beside a shown
 * chance, "This calculation covers…" where none is shown. A statement, never a question: a host line carrying the occurrence ask
 * displaced the Run reply's answer shape (B1 route row), so the ask stays with the existing occurrence card and readiness copy.
 */
export function unsizedOlumiRiskLine(graph: unknown, riskId: string, besideChance: boolean): string | null {
  const node = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n): n is Rec => isRec(n) && n.id === riskId) : undefined;
  const label = typeof node?.label === 'string' && node.label.trim() !== '' ? node.label.trim() : null;
  if (label === null || /[\r\n]/.test(label)) return null;
  return `${besideChance ? 'These chances cover' : 'This calculation covers'} the modelled effects only. ‘${label}’ is Olumi’s `
    + 'unsized risk suggestion and is not included in this calculation; its likelihood and impact remain unresolved.';
}

/** The AIE's label-free form, where a label would not reach the user whole: the count, never a guess. */
export const unsizedOlumiRisksUnnamedLine = (count: number): string =>
  `This calculation leaves out ${count} unsized risk suggestion${count === 1 ? '' : 's'} from Olumi; `
  + `${count === 1 ? 'its likelihood and impact remain' : 'their likelihoods and impacts remain'} unresolved.`;
