/** Offline check only. Usage: node check-draft-wire.mjs <captured-draft-wire> <deployed-identity.json> */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const [wirePath, identityPath] = process.argv.slice(2);
assert(wirePath && identityPath, 'Supply a captured draft wire and identity computed at the deployed SHA.');
const expected = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
assert.match(expected.cee_build, /^[0-9a-f]{40}$/);
assert.match(expected.prompt_sha256, /^[0-9a-f]{64}$/);
assert.match(expected.schema_sha256, /^[0-9a-f]{64}$/);
const raw = fs.readFileSync(wirePath, 'utf8');
let payload;
if (raw.trimStart().startsWith('{')) {
  const parsed = JSON.parse(raw); payload = parsed.payload ?? parsed;
} else {
  const complete = [];
  for (const block of raw.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    const frame = JSON.parse(data);
    if (frame.stage === 'COMPLETE') complete.push(frame);
  }
  assert.equal(complete.length, 1, 'Exactly one COMPLETE frame is required.');
  assert.equal(complete[0].status_code, 200, 'The completed draft turn must succeed.');
  payload = complete[0].payload;
}
assert(payload && Array.isArray(payload._provider_calls), 'Missing provider ledger on the draft wire.');
const rows = payload._provider_calls;
assert.equal(rows.filter(row => row.provider === 'anthropic').length, 0, 'Anthropic rows must be absent.');
const construction = rows.filter(row => row.purpose === 'construction');
assert.equal(construction.length, 1, 'Exactly one construction provider row is required.');
assert.equal(construction[0].provider, 'openai');
assert.equal(construction[0].prompt_alias, 'agent.construct');
assert.equal(construction[0].prompt_sha256, expected.prompt_sha256, 'Construction must use the deployed records instruction.');
assert.equal(construction[0].schema_sha256, expected.schema_sha256, 'Construction must use the deployed strict records schema.');
assert.equal(construction[0].cee_build, expected.cee_build, 'The constructor must be served by the deployed SHA.');
for (const row of rows) assert.equal(row.cee_build, expected.cee_build, 'Every provider row must come from the deployed SHA.');
assert.equal(payload._diagnostic_trace?.exit_path, 'agent_lane_v1');
assert.equal(payload._agent?.tool_calls?.[0]?.name, 'build_model_from_brief');
assert.equal(payload._agent.tool_calls[0].ok, true);
assert.equal(payload._agent.tool_calls[0].mutated, true);
console.log(JSON.stringify({ ok: true, wire: wirePath, cee_build: expected.cee_build,
  construction_rows: construction.length, anthropic_rows: 0,
  prompt_sha256: expected.prompt_sha256, schema_sha256: expected.schema_sha256 }, null, 2));
