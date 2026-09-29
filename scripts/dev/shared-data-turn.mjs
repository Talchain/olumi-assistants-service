#!/usr/bin/env node
// One real Agent turn on the isolated browser scenario, plus a cold HTTP read.
// Evidence contains response bodies only; credentials never enter the output.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const stateDir = resolve(homedir(), '.codex/workspaces/shared-data-spine-local');
const seed = JSON.parse(readFileSync(resolve(stateDir, 'browser-scenario.json'), 'utf8'));
const token = readFileSync(resolve(stateDir, 'api-user-token.txt'), 'utf8').trim();
const label = arg('--label', 'agent-run');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Evidence label must be a simple local name');
const scenarioId = arg('--scenario', seed.scenarioId);
if (!/^[0-9a-f-]{36}$/.test(scenarioId)) throw new Error('Scenario UUID required');
const payload = { kind: 'message', source: 'composer', stage: 'analyse', turn_class: 'decide',
  scenario_id: scenarioId, turn_id: randomUUID(), message: arg('--message', 'Run the analysis and explain the result from this Run.') };
const readOnly = process.argv.includes('--read-only');
const response = readOnly ? { status: null, ok: true } : await fetch('http://127.0.0.1:8791/proxy/v5/turn', { method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5178', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload), signal: AbortSignal.timeout(180000) });
const body = readOnly ? {} : await response.json();
const readResponse = await fetch(`http://127.0.0.1:5178/bff/cee/scenarios/${scenarioId}/graph`, { method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}', signal: AbortSignal.timeout(30000) });
const read = await readResponse.json();
const path = resolve(stateDir, `${label}.json`);
writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), request: readOnly ? null : payload, status: response.status, body,
  readStatus: readResponse.status, read }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: response.status, readStatus: readResponse.status, scenarioId,
  reply: body.assistant_text, blockTypes: body.blocks?.map(b => b.type),
  turnRunState: body.analysis_state?.run_state, readRunState: read.analysis_state?.run_state,
  providerCalls: body._provider_calls?.length, evidence: path }, null, 2));
if (!response.ok || !readResponse.ok) process.exitCode = 1;
