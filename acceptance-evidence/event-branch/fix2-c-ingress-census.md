# FIX-2 Class C ingress enumeration (before implementation)

Reviewed source: `5f54ca8740095fb744ab1f2717a886fc5e3f5c66`, branch `dl/event-risk-olumi-occurrence` (both asserted).

1. `/assist/v1/scenarios/:scenario_id/graph/register` (`src/routes/assist.v1.scenario-graph-register.ts`): the whole graph writer for canvas re-registration, file import into an existing/new scenario, and CEE in-process construction. `eventRiskIngressIssues` gates client occurrence shape; `withServerEventRiskBasisText` strips client node warrants and restores only CEE construction or unchanged server data. FIX-2 will also strip options mirrors and bind retained warrants to event label and description.
2. `/orchestrate/v2/turn` client `graph_state` (`src/orchestrator/route-v2-preflight.ts` → `parseRequestExtensions`, in `src/orchestrator-v5/boundary/request-extensions.ts`): common client parse for turn, stream/proxy forwarding, first-touch adoption, and the first-touch edit/merge base. The permissive graph schema keeps occurrence bytes; client basis text must be stripped at the request parse before any downstream reading or writing.
3. `runTurnExecutor(..., { graphState })` (`src/orchestrator-v5/turn-executor.ts`): direct executor callers bypass the request parser. The first-touch decision table adopts the incoming graph in row A and uses it as the mutation merge base in row B. Defensive client sanitation must occur once before reasoning, handler inputs, and either adoption branch.

Other adoption/import candidates traced:

- Version save and atomic restore (`src/routes/assist.v1.scenario-versions.ts`) read canonical/server version graphs and never consume a client graph. Retain CEE-authored warrants here; restore continues through its existing stored-graph validation.
- `CreateVersionRequestSchema` in model-management contracts is exported but has no live route consumer; version routes do not use it to import client graphs.
- `/agent/v1/turn` loads graphs through scenario graph reads and writes models through the same register/turn dispatch paths; message bodies do not confer graph authorship.
- Standalone `/assist/v1/*` graph coaching routes use the legacy `src/schemas/graph.ts` passthrough schema and do not adopt/import/persist a graph; the occurrence-warrant reader has no consumer in those routes. `/assist/v1/draft-graph*` refinement reads `previous_graph` only as bounded id/kind/label and endpoint summaries (`buildRefinementBrief`), not as an adopted graph or an occurrence warrant. Legacy `/assist/draft-graph*` routes return 410.

Stored read schemas `GraphStateIngressSchema` and `GraphV3` are deliberately not globally changed: they are used on CEE-owned graph reads, where removing the readable warrant would invalidate legitimate estimates.
