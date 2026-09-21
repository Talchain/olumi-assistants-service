#!/usr/bin/env node
/**
 * L0 state-snapshot helper (harness-side; conversation-harness v0).
 *
 * Captures, per turn boundary, the DB-layer ground truth the scorer dims (D9
 * consent friction, D10 re-click safety) diff against:
 *   - last-N v5_conversation_turns rows (metadata columns only)
 *   - v5_handler_facts for those turns (payload reduced to sha256 + fact_type —
 *     payloads can be large; the sha is what a commit-set diff needs)
 *   - scenarios.graph sha256 (canonical key-sorted JSON) + node/edge counts
 *   - brief row (sha + head, never the full text)
 *   - decision_records rows (ids + created_at; guest scenarios have none by
 *     design — create_decision_record requires an owner)
 *
 * Reads staging Supabase via PostgREST with the service-role key from
 * STAGING_ENV_FILE (default: <repo>/.env.staging.local). Credential VALUES are
 * never printed or embedded in snapshots. Table/column names mirror
 * src/orchestrator-v5/session/supabase-store.ts and
 * supabase/migrations/20260710113000_v5_decision_records.sql at this branch's
 * base; any REST error is captured verbatim-truncated into the snapshot rather
 * than crashing the run (honest UNMEASURABLE downstream).
 *
 * CLI: node l0-snapshot.mjs <scenario-id> [outfile]
 * Module: captureL0Snapshot({ scenarioId, lastN, envFile })
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV_FILE = resolve(HERE, '../../.env.staging.local');

export function parseEnvFile(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, '');
  }
  return out;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

export function sha256Canonical(value) {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
}

/**
 * VOLATILE payload fields (C9): per-request timestamps and correlation ids that
 * differ between two executions of the SAME semantic commit. A double-commit's
 * payloads are identical EXCEPT for these — hashing them verbatim made the
 * D10 payload-sha compare blind to real double executions. Deep-stripped
 * before hashing; the raw payload is untouched in DB.
 */
const VOLATILE_KEY_PATTERN =
  /(^|_)(computed_at|created_at|updated_at|captured_at|generated_at|completed_at|started_at|timestamp)$|^(request_id|trace_id|correlation_id|span_id|turn_id|run_id|v5_conversation_turn_id|idempotency_key)$/i;

export function stripVolatile(v) {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !VOLATILE_KEY_PATTERN.test(k))
        .map(([k, val]) => [k, stripVolatile(val)]),
    );
  }
  return v;
}

/** Volatile-normalised payload hash — the D10 double-commit identity. */
export function sha256Semantic(value) {
  return sha256Canonical(stripVolatile(value));
}

function makeRest(supabaseUrl, serviceKey) {
  return async function rest(pathQuery) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${pathQuery}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.text();
      if (!res.ok) return { __error: `${res.status} ${body.slice(0, 300)}` };
      return JSON.parse(body);
    } catch (err) {
      return { __error: String(err).slice(0, 300) };
    }
  };
}

export async function captureL0Snapshot({ scenarioId, lastN = 10, envFile } = {}) {
  if (!scenarioId) throw new Error('captureL0Snapshot: scenarioId required');
  const env = parseEnvFile(envFile ?? process.env.STAGING_ENV_FILE ?? DEFAULT_ENV_FILE);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from staging env file');
  }
  const rest = makeRest(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const turns = await rest(
    `v5_conversation_turns?scenario_id=eq.${scenarioId}` +
      `&select=id,turn_id,turn_class,handler_id,response_emitted,llm_calls_used,duration_ms,created_at` +
      `&order=created_at.desc,turn_id.desc&limit=${lastN}`,
  );

  let handlerFacts = [];
  if (Array.isArray(turns) && turns.length > 0) {
    const ids = turns.map((t) => t.id).join(',');
    const facts = await rest(
      `v5_handler_facts?v5_conversation_turn_id=in.(${ids})` +
        `&select=v5_conversation_turn_id,handler_id,action_type,noop,created_at,payload&order=created_at.desc`,
    );
    handlerFacts = Array.isArray(facts)
      ? facts.map((f) => ({
          v5_conversation_turn_id: f.v5_conversation_turn_id,
          handler_id: f.handler_id,
          action_type: f.action_type,
          noop: f.noop,
          created_at: f.created_at,
          fact_type: f.payload?.fact_type ?? null,
          // SEMANTIC identity (C9): volatile fields (computed_at, request ids…)
          // stripped before hashing so two executions of the same commit hash
          // identically. Raw hash kept alongside for forensics.
          payload_sha256: sha256Semantic(f.payload ?? null),
          payload_sha256_raw: sha256Canonical(f.payload ?? null),
        }))
      : facts;
  }

  const scen = await rest(
    `scenarios?id=eq.${scenarioId}&select=id,stage,title,brief_text,graph,updated_at`,
  );
  let graph = null;
  let brief = null;
  let scenarioRowError = null;
  if (Array.isArray(scen) && scen.length === 1) {
    const row = scen[0];
    graph = row.graph
      ? {
          sha256: sha256Canonical(row.graph),
          node_count: Array.isArray(row.graph.nodes) ? row.graph.nodes.length : null,
          edge_count: Array.isArray(row.graph.edges) ? row.graph.edges.length : null,
        }
      : null;
    const briefText = row.brief_text ?? '';
    brief = {
      sha256: createHash('sha256').update(briefText).digest('hex'),
      chars: briefText.length,
      head: briefText.slice(0, 120),
      stage: row.stage ?? null,
      title: row.title ?? null,
      updated_at: row.updated_at ?? null,
    };
  } else {
    scenarioRowError = scen?.__error ?? `expected 1 scenarios row, got ${Array.isArray(scen) ? scen.length : typeof scen}`;
  }

  const decisions = await rest(
    `decision_records?scenario_id=eq.${scenarioId}&select=record_id,created_at&order=created_at.desc`,
  );

  return {
    captured_at: new Date().toISOString(),
    scenario_id: scenarioId,
    conversation_turns: turns,
    handler_facts: handlerFacts,
    graph,
    brief,
    scenario_row_error: scenarioRowError,
    decision_records: decisions,
  };
}

// CLI wrapper
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [scenarioId, outfile] = process.argv.slice(2);
  if (!scenarioId) {
    console.error('usage: node l0-snapshot.mjs <scenario-id> [outfile]');
    process.exit(1);
  }
  const snap = await captureL0Snapshot({ scenarioId });
  const json = JSON.stringify(snap, null, 2);
  if (outfile) writeFileSync(outfile, json);
  else console.log(json);
}
