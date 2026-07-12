#!/usr/bin/env node
/**
 * Conversation-harness runner v0 — drives a journey JSON against a CEE base URL
 * (hermetic local arm or staging) and persists a self-contained run dir.
 *
 * Evolved from the proven candidates/run-arm.sh + run-frozen-arm.sh curl loop
 * (re-homed byte-adjusted under legacy/); adds per-turn run-dir persistence
 * (request.json / wire.json / trace.json / meta.json), L0 state snapshots,
 * a config manifest, conditional consent turns, and concurrent-duplicate turns
 * (S5 rapid re-click).
 *
 * Usage:
 *   node runner.mjs --journey journeys/s3-option-question-probe.json \
 *     --arm s3-demo --base http://localhost:3103 [--scenario <uuid>] [--l0] \
 *     [--no-manifest] [--out runs] [--flags-env staging-parity.env]
 * Env: OLUMI_ASSIST_KEY (required; falls back to ASSIST_API_KEY),
 *      STAGING_ENV_FILE (creds source for --l0 and the manifest admin key).
 *
 * Journey format (superset of journey-v2.json / frozen-journey.json):
 *   { "comment", "requires_seeded_scenario"?, "placeholders"?: {"FACTOR": "..."},
 *     "dims"?: [...], "turns": [{ "id", "stage", "message",
 *        "turn_class_hint"?, "edit_intent"?, "only_if"?: "consent_requested",
 *        "concurrent_duplicate"?: true }] }
 * {NAME} placeholders resolve from journey.placeholders; FACTOR is additionally
 * re-resolved from this run's own draft turn when one occurs (draft variance).
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { captureL0Snapshot } from './l0-snapshot.mjs';
import { buildConfigManifest } from './config-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function die(msg) {
  console.error(`runner: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args._flags.add(key);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const journeyPath = resolve(args.journey ?? die('--journey required'));
const arm = args.arm ?? die('--arm required');
const base = (args.base ?? die('--base required')).replace(/\/$/, '');
const KEY = process.env.OLUMI_ASSIST_KEY ?? process.env.ASSIST_API_KEY ?? die('set OLUMI_ASSIST_KEY');
const wantL0 = args._flags.has('l0');
const journey = JSON.parse(readFileSync(journeyPath, 'utf-8'));

if (journey.requires_seeded_scenario && !args.scenario) {
  die(`journey ${basename(journeyPath)} requires a pre-seeded scenario — seed with staging/seed-frozen-scenario.py and pass --scenario <id>`);
}
const scenarioId = args.scenario ?? randomUUID();

const runDir = resolve(args.out ?? join(HERE, 'runs'), arm);
mkdirSync(join(runDir, 'turns'), { recursive: true });
if (wantL0) mkdirSync(join(runDir, 'l0'), { recursive: true });
// Self-containment: the scorer reads journey metadata (only_if / edit_intent /
// class hints) from the run dir, not from a path that may later change.
copyFileSync(journeyPath, join(runDir, 'journey.json'));
writeFileSync(join(runDir, 'scenario-id.txt'), `${scenarioId}\n`);
// TRUNCATE the log ('' not append) so a prior run's "RUN END" can't be read as
// premature completion (real incident 2026-07 — see legacy/run-arm.sh).
writeFileSync(join(runDir, 'run-log.txt'), '');

const log = (line) => {
  appendFileSync(join(runDir, 'run-log.txt'), `${line}\n`);
  console.log(line);
};

const placeholders = { ...(journey.placeholders ?? {}) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postTurn(message, stage) {
  const payload = {
    scenario_id: scenarioId,
    turn_id: randomUUID(),
    turn_class: 'frame',
    kind: 'message',
    stage,
    source: 'composer',
    message,
  };
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/orchestrate/v2/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Olumi-Assist-Key': KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    return { payload, startedAt, wallMs: Math.round(performance.now() - t0), status: res.status, text };
  } catch (err) {
    return { payload, startedAt, wallMs: Math.round(performance.now() - t0), status: null, error: String(err) };
  }
}

function persistTurn(dirId, r, turnMeta) {
  const tdir = join(runDir, 'turns', dirId);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, 'request.json'), JSON.stringify(r.payload, null, 2));
  let wire = null;
  if (r.text != null) {
    try {
      wire = JSON.parse(r.text);
      writeFileSync(join(tdir, 'wire.json'), JSON.stringify(wire, null, 2));
    } catch {
      writeFileSync(join(tdir, 'wire.raw.txt'), r.text);
    }
  }
  if (wire && wire._diagnostic_trace !== undefined) {
    writeFileSync(join(tdir, 'trace.json'), JSON.stringify(wire._diagnostic_trace, null, 2));
  }
  writeFileSync(
    join(tdir, 'meta.json'),
    JSON.stringify(
      {
        turn: dirId,
        started_at: r.startedAt,
        wall_clock_ms: r.wallMs,
        http_status: r.status,
        error: r.error ?? null,
        skipped: false,
        ...turnMeta,
      },
      null,
      2,
    ),
  );
  return wire;
}

function persistSkip(dirId, reason, turnMeta) {
  const tdir = join(runDir, 'turns', dirId);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(
    join(tdir, 'meta.json'),
    JSON.stringify({ turn: dirId, skipped: true, skip_reason: reason, ...turnMeta }, null, 2),
  );
}

// Consent detection is property-based (chip/hold shape), never exact text.
function consentRequested(wire) {
  if (!wire) return false;
  if (wire.held_proposal) return true;
  const chips = Array.isArray(wire.suggested_actions) ? wire.suggested_actions : [];
  return chips.some((c) =>
    /\b(apply|confirm|approve|go ahead|yes)\b/i.test(`${c?.id ?? ''} ${c?.label ?? ''} ${c?.action ?? ''}`),
  );
}

// FACTOR re-resolution from this run's own draft (mirrors legacy/run-arm.sh).
function pickFactor(wire) {
  const nodes = wire?.draft_graph?.nodes;
  if (!Array.isArray(nodes)) return null;
  const factors = nodes
    .filter((n) => n?.kind === 'factor' && !String(n?.label ?? '').endsWith('Hired'))
    .map((n) => String(n.label));
  const preferred = factors.filter((l) => /capacity|speed|quality|maturity|throughput/i.test(l));
  return preferred[0] ?? factors[0] ?? null;
}

async function snapshotL0(label) {
  if (!wantL0) return;
  try {
    const snap = await captureL0Snapshot({ scenarioId });
    writeFileSync(join(runDir, 'l0', `${label}.json`), JSON.stringify({ label, ...snap }, null, 2));
  } catch (err) {
    writeFileSync(join(runDir, 'l0', `${label}.json`), JSON.stringify({ label, __error: String(err).slice(0, 300) }, null, 2));
  }
}

// ---- run ----
log(`RUN START ${new Date().toISOString()} arm=${arm} scenario=${scenarioId} base=${base} journey=${journeyPath}`);

if (!args._flags.has('no-manifest')) {
  try {
    const manifest = await buildConfigManifest({
      ceeBase: base,
      plotBase: args.plot,
      islBase: args.isl,
      flagsEnvFile: args['flags-env'] ? resolve(args['flags-env']) : undefined,
    });
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log(`manifest captured (cee build=${manifest.cee.deploy_sha ?? 'unknown'})`);
  } catch (err) {
    log(`manifest FAILED (continuing): ${String(err).slice(0, 200)}`);
  }
}

await snapshotL0('00-baseline');

let prevWire = null;
let aborted = false;
let seq = 0;
for (const turn of journey.turns) {
  seq += 1;
  const stage = turn.stage ?? journey.defaults?.stage ?? 'analyse';
  const message = String(turn.message).replace(/\{([A-Z_]+)\}/g, (m, name) => placeholders[name] ?? m);
  const turnMeta = {
    stage,
    message,
    turn_class_hint: turn.turn_class_hint ?? null,
    edit_intent: Boolean(turn.edit_intent),
    only_if: turn.only_if ?? null,
    concurrent_duplicate: Boolean(turn.concurrent_duplicate),
  };

  if (turn.only_if === 'consent_requested' && !consentRequested(prevWire)) {
    persistSkip(turn.id, 'previous turn did not request consent', turnMeta);
    log(`${turn.id} | SKIPPED (consent not requested by previous turn)`);
    continue;
  }

  if (turn.concurrent_duplicate) {
    // Fire a duplicate mid-flight with a FRESH client turn_id (S5). Neither
    // response aborts the run on non-2xx — the duplicate's status IS the
    // measurement, not an error.
    const dupDelay = Number(args['dup-delay-ms'] ?? 400);
    const [a, b] = await Promise.all([
      postTurn(message, stage),
      (async () => {
        await sleep(dupDelay);
        return postTurn(message, stage);
      })(),
    ]);
    prevWire = persistTurn(turn.id, a, turnMeta) ?? prevWire;
    persistTurn(`${turn.id}-dup`, b, { ...turnMeta, duplicate_of: turn.id, dup_delay_ms: dupDelay });
    log(`${turn.id} | ${a.startedAt} | http=${a.status} ${a.wallMs}ms | dup http=${b.status} ${b.wallMs}ms | msg=${message}`);
  } else {
    const r = await postTurn(message, stage);
    const wire = persistTurn(turn.id, r, turnMeta);
    log(`${turn.id} | ${r.startedAt} | http=${r.status} ${r.wallMs}ms | stage=${stage} | msg=${message}`);
    if (r.status == null || r.status >= 300) {
      log(`RUN ABORTED ${new Date().toISOString()} at ${turn.id} (turn failed: ${r.error ?? r.status})`);
      aborted = true;
      await snapshotL0(`${String(seq).padStart(2, '0')}-${turn.id}`);
      break;
    }
    prevWire = wire;
    if (wire?.draft_graph) {
      const picked = pickFactor(wire);
      if (picked) {
        placeholders.FACTOR = picked;
        log(`FACTOR resolved: ${picked}`);
      }
    }
  }

  await snapshotL0(`${String(seq).padStart(2, '0')}-${turn.id}`);
  await sleep(Number(args['turn-gap-ms'] ?? 2000));
}

if (!aborted) log(`RUN END ${new Date().toISOString()}`);
console.log(`ARM ${arm} ${aborted ? 'ABORTED' : 'COMPLETE'} -> ${runDir}`);
process.exit(aborted ? 1 : 0);
