#!/usr/bin/env node
/**
 * One-shot capture of a /orchestrate/v2/turn `run_analysis` chip-click
 * response body for the V2RunResponseEnvelope fixture.
 *
 * Sequence:
 *   1. POST draft brief → scenario + graph_state
 *   2. POST chip_click run_analysis → V2RunResponseEnvelope (the OlumiResponse)
 *   3. Write JSON to the path passed in argv
 *
 * Used after replay confirms Step 4 passes — captures the post-fix
 * envelope shape for the regression fixture.
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.BASE_URL ?? 'https://cee-staging.onrender.com';
const apiKey = process.env.OLUMI_REPLAY_API_KEY;
if (!apiKey) {
  console.error('OLUMI_REPLAY_API_KEY not set');
  process.exit(1);
}
const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: capture-run-analysis.mjs <output-path>');
  process.exit(1);
}

const headers = {
  'content-type': 'application/json',
  'x-olumi-assist-key': apiKey,
};

const scenarioId = randomUUID();
const brief =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

console.log(`scenario_id=${scenarioId}`);
console.log(`base_url=${baseUrl}`);

// Step 1: draft graph (frame stage)
console.log('[1/2] POST draft_graph (frame stage)…');
const draftStart = Date.now();
const draftRes = await fetch(`${baseUrl}/orchestrate/v2/turn`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    kind: 'message',
    turn_id: randomUUID(),
    scenario_id: scenarioId,
    stage: 'frame',
    message: brief,
    turn_class: 'frame',
    source: 'composer',
  }),
});
console.log(`  status=${draftRes.status} elapsed=${Date.now() - draftStart}ms`);
if (draftRes.status !== 200) {
  console.error('draft_graph failed:', await draftRes.text().then((t) => t.slice(0, 500)));
  process.exit(1);
}

// Step 2: chip_click run_analysis (analyse stage)
console.log('[2/2] POST chip_click run_analysis (analyse stage)…');
const runStart = Date.now();
const runRes = await fetch(`${baseUrl}/orchestrate/v2/turn`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    kind: 'message',
    turn_id: randomUUID(),
    scenario_id: scenarioId,
    stage: 'analyse',
    message: 'Run analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  }),
});
const runElapsed = Date.now() - runStart;
console.log(`  status=${runRes.status} elapsed=${runElapsed}ms`);
const buildHeader = runRes.headers.get('x-olumi-service-build');

const body = await runRes.json();
writeFileSync(outPath, JSON.stringify(body, null, 2));
console.log(`Wrote envelope to ${outPath}`);

// Sidecar metadata
const metadataPath = outPath.replace(/\.json$/, '.metadata.json');
const metadata = {
  captured_at: new Date().toISOString(),
  base_url: baseUrl,
  scenario_id: scenarioId,
  build_header: buildHeader,
  http_status: runRes.status,
  elapsed_ms: runElapsed,
  brief_length: brief.length,
  blocks_count: Array.isArray(body.blocks) ? body.blocks.length : 0,
  has_enrichment: Boolean(body.blocks?.[0]?.enrichment),
  enrichment_keys: body.blocks?.[0]?.enrichment ? Object.keys(body.blocks[0].enrichment) : [],
};
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
console.log(`Wrote metadata to ${metadataPath}`);
