/** Add the shipping combined-read contract to a legacy, graph-only double.
 * Keep its original methods/spies, and derive the snapshot from its own graph
 * read rather than inventing a second graph fixture.
 */
export function withScenarioRevision<T extends object>(store: T) {
  const source = store as T & { loadGraph?: (scenarioId: string) => Promise<unknown> };
  return {
    ...store,
    loadGraphAndBriefText: async (scenarioId: string) => ({
      graph: source.loadGraph ? await source.loadGraph(scenarioId) : null,
      briefText: null,
      revision: 7,
    }),
  };
}
