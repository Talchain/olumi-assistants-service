/**
 * CEE's admitted occurrence warrant reaches the existing graph register in-process.
 * AsyncLocalStorage follows app.inject(), as in approved-adoption-context.ts; no
 * request member or header can confer authorship. Bind to the scenario and the
 * exact risk, occurrence and text sent by this one construction.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { readOlumiEventRiskBasisText } from '../../schemas/event-risk.js';

type Node = { readonly id?: unknown; readonly kind?: unknown; readonly label?: unknown; readonly description?: unknown; readonly event_risk?: unknown; readonly event_risk_basis_text?: unknown };
type Construction = { readonly scenarioId: string; readonly nodes: readonly Node[]; active: boolean };
const store = new AsyncLocalStorage<Construction>();

/** Scope the ONE existing construction registration; this does not write a graph. */
export function runWithEventRiskConstruction<T>(scenarioId: string, graph: { readonly nodes: readonly Node[] }, fn: () => Promise<T>): Promise<T> {
  const nodes = graph.nodes.flatMap((node) => {
    const text = readOlumiEventRiskBasisText(node);
    return text === undefined ? [] : [{ id: node.id, kind: 'risk', label: node.label, description: node.description,
      event_risk: structuredClone(node.event_risk), event_risk_basis_text: text }];
  });
  const context: Construction = { scenarioId, nodes, active: true };
  return store.run(context, async () => {
    try { return await fn(); }
    finally { context.active = false; }
  });
}

/** Only the admitted construction's exact member earns its readable warrant. */
export function eventRiskConstructionBasisTextFor(scenarioId: string, node: Node): string | undefined {
  const context = store.getStore();
  if (context === undefined || !context.active || context.scenarioId !== scenarioId) return undefined;
  const text = readOlumiEventRiskBasisText(node);
  if (text === undefined) return undefined;
  return context.nodes.some((trusted) => trusted.id === node.id && trusted.event_risk_basis_text === text
    && trusted.label === node.label && trusted.description === node.description
    && isDeepStrictEqual(trusted.event_risk, node.event_risk)) ? text : undefined;
}
