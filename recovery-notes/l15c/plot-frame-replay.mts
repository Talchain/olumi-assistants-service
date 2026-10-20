import { readFileSync } from 'node:fs';
import { attachIdentityExecutionFrames, toISLNode } from '/private/tmp/c5-plot/src/integrations/isl/translator-v3.ts';
const p = '/Users/paulslee/olumi-work/recovery/live/runs/2026-10-20T073620Z-capacity-full-core-0015bd47-00a60452/capacity/turns/01.json';
const graph = JSON.parse(readFileSync(p, 'utf8')).response_body.draft_graph;
const quantities = graph.nodes.filter((n: any) => n.kind !== 'option' && n.kind !== 'decision');
for (const framed of [false, true]) {
  const engine = structuredClone(quantities);
  // Diagnostic control: CEE's implicit unit frame, NOT a proposed repair or new science law.
  if (framed) engine.find((n: any) => n.id === 'additional_specialist_capacity').scale_frame = 1;
  const isl = engine.map(toISLNode);
  const withdrawn = attachIdentityExecutionFrames(isl, engine, new Map(engine.filter((n: any) => n.scale_frame).map((n: any) => [n.id, n.scale_frame])),
    new Map(engine.filter((n: any) => n.goal_threshold_cap).map((n: any) => [n.id, n.goal_threshold_cap])));
  process.stdout.write(JSON.stringify({ framed, withdrawn, nodes: isl.map((n: any) => ({ id: n.id, execution_frame: n.execution_frame, nonlinear_identity: n.nonlinear_identity })) }) + '\n');
}
