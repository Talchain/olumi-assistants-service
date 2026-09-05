#!/usr/bin/env -S node --enable-source-maps
/**
 * Founder-fixture wire harness — CLI.
 *
 * Runs `artefacts/founder-fixture/SCRIPT.md`'s eleven turns (after the brief)
 * against a DEPLOYED build and decides ACCEPTANCE.md section A.
 *
 *   pnpm fixture:founder -- \
 *     --brief /path/to/olumi-programme-docs/artefacts/founder-fixture/BRIEF-FOUNDER-VERBATIM.txt \
 *     --out test-diagnostics/founder-fixture/run.md
 *
 * Replay (no network, deterministic, this is the regression gate):
 *
 *   pnpm fixture:founder -- --replay tools/founder-fixture-harness/fixtures/green.json
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EXIT CODES
 *   0  no criterion FAILED.  ⚠ NOT "the fixture passed" — read the headline.
 *   1  at least one criterion FAILED (or, with --require-fully-assessed, at
 *      least one was NOT ASSESSED).
 *   2  fatal harness error.
 *   3  halted before deciding anything: brief hash mismatch, deploy gate, or
 *      the SHA of the service under test could not be established.
 *
 * Code 3 exists because of the fixture's own rule 8 ("pin the four deployed
 * builds before measuring") and the brief's rule 4: a run that cannot say what
 * it ran against reports that and stops. It does not guess and it does not
 * proceed.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getHealthz } from '../v5-journey-replay/client.js';
import { evaluateDeployGate } from '../v5-journey-replay/index.js';
import type { WireBody } from '../golden-journey-harness/observation.js';

import { BriefHashMismatchError, assertSentBrief, loadBrief, sha256Of } from './brief.js';
import { buildDetectors, loadCaptureAdapter } from './detectors.js';
import { evaluateCriteria } from './criteria.js';
import { collectMeasurements } from './measurements.js';
import { headline, renderReport, tally } from './report.js';
import { BRIEF_TURN_INDEX, RELOAD_SEMANTICS, SCRIPTED_TURNS } from './script.js';
import { carriesAnalysisResult } from './admission.js';
import { getUiVersion, postProxyTurn, type ProxyTurnPayload } from './proxy-client.js';
import type { BuildIdentity, HarnessOutcome, RunContext, TurnCapture } from './types.js';

const DEFAULT_CEE_BASE = 'https://cee-staging.onrender.com';
const DEFAULT_UI_BASE = 'https://staging--olumi.netlify.app';
/**
 * The canonical browser origin. Sent because it is the ONLY gate the route
 * has, and `src/security/browser-origin-policy.ts` is its allowlist. The route
 * says out loud that a non-browser caller can forge it — this harness IS that
 * caller, and it forges it deliberately so it exercises the same admission a
 * real user does.
 */
const DEFAULT_ORIGIN = 'https://staging--olumi.netlify.app';

interface Cli {
  readonly baseUrl: string;
  readonly uiBaseUrl: string;
  readonly origin: string;
  readonly briefPath?: string;
  readonly out?: string;
  readonly uiRepo?: string;
  readonly replay?: string;
  readonly expectedBuild?: string;
  readonly requireFullyAssessed: boolean;
  readonly timeoutMs: number;
  readonly scenarioPrefix?: string;
}

function parseArgs(argv: readonly string[]): Cli {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  return {
    baseUrl: get('--base-url') ?? process.env.OLUMI_FF_BASE_URL ?? DEFAULT_CEE_BASE,
    uiBaseUrl: get('--ui-base-url') ?? process.env.OLUMI_FF_UI_BASE_URL ?? DEFAULT_UI_BASE,
    origin: get('--origin') ?? process.env.OLUMI_FF_ORIGIN ?? DEFAULT_ORIGIN,
    briefPath: get('--brief') ?? process.env.OLUMI_FF_BRIEF,
    out: get('--out'),
    uiRepo: get('--ui-repo') ?? process.env.OLUMI_FF_UI_REPO,
    replay: get('--replay'),
    expectedBuild: get('--expected-build') ?? process.env.OLUMI_FF_EXPECTED_BUILD,
    requireFullyAssessed: argv.includes('--require-fully-assessed'),
    timeoutMs: Number(get('--timeout-ms') ?? '140000'),
    scenarioPrefix: get('--scenario-prefix'),
  };
}

class HaltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HaltError';
  }
}

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

async function establishBuilds(cli: Cli): Promise<readonly BuildIdentity[]> {
  const builds: BuildIdentity[] = [];

  const healthz = await getHealthz(cli.baseUrl).catch(() => undefined);
  const gate = evaluateDeployGate(cli.baseUrl, healthz, cli.expectedBuild);
  if (gate.halt) {
    throw new HaltError(
      `Deploy gate halted: ${gate.reason ?? 'unknown'}\n` +
        'A run that cannot establish what it ran against reports that and stops.',
    );
  }
  builds.push({
    service: 'CEE (the service under test)',
    sha: healthz?.body?.build,
    derivedFrom: `GET ${cli.baseUrl}/healthz → .build`,
    note: healthz?.body?.degraded === true ? 'reported degraded' : undefined,
  });

  const ui = await getUiVersion(cli.uiBaseUrl);
  builds.push({
    service: 'UI (not in the request path; recorded to identify whose DOM the unassessed limbs belong to)',
    sha: ui.ok ? ui.version.commit : undefined,
    derivedFrom: `GET ${cli.uiBaseUrl}/version.json → .commit, asserted /^[0-9a-f]{40}$/`,
    note: ui.ok
      ? undefined
      : `${ui.reason} — a 200 proves nothing here: the SPA fallback serves index.html for any path, so ` +
        'only the parsed shape is evidence.',
  });

  builds.push({
    service: 'PLoT / ISL',
    sha: undefined,
    derivedFrom: 'not derivable without a credential from this harness',
    note:
      'CEE calls them; this harness does not, and their health routes are auth-gated. Recorded as ' +
      'UNKNOWN rather than omitted, so a reader is not left thinking they were pinned.',
  });

  return builds;
}

async function runLive(cli: Cli): Promise<HarnessOutcome> {
  if (cli.briefPath === undefined) {
    throw new HaltError('--brief is required for a live run (or set OLUMI_FF_BRIEF).');
  }
  const brief = loadBrief(resolve(cli.briefPath));
  const builds = await establishBuilds(cli);

  const detectors = await buildDetectors(cli.uiRepo);
  const adaptCapture = cli.uiRepo !== undefined ? await loadCaptureAdapter(cli.uiRepo) : undefined;

  const scenarioId = randomUUID();
  const startedAt = new Date().toISOString();
  const turns: TurnCapture[] = [];
  let analysisSeen = false;

  const send = async (
    index: number,
    probes: string,
    message: string,
    afterReload: boolean,
  ): Promise<TurnCapture> => {
    const payload: ProxyTurnPayload = {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: scenarioId,
      // `deriveV5Stage`: `analyse` once analysis is complete, else `frame`.
      stage: analysisSeen ? 'analyse' : 'frame',
      turn_class: 'frame',
      source: 'composer',
      message,
    };
    process.stderr.write(`  → turn ${index} (${probes})… `);
    try {
      const res = await postProxyTurn(cli.baseUrl, cli.origin, payload, cli.timeoutMs);
      if (index === BRIEF_TURN_INDEX) assertSentBrief(res.serialisedBody, brief.sha256);
      const body = res.body as unknown as WireBody;
      if (carriesAnalysisResult(body)) analysisSeen = true;
      process.stderr.write(`HTTP ${res.status} in ${res.elapsed_ms}ms\n`);
      return {
        index,
        probes,
        sent: { index, message, sha256: sha256Of(message) },
        httpStatus: res.status,
        body,
        elapsedMs: res.elapsed_ms,
        afterReload: afterReload || undefined,
      };
    } catch (err) {
      if (err instanceof BriefHashMismatchError) throw err;
      process.stderr.write(`TRANSPORT ERROR\n`);
      return {
        index,
        probes,
        sent: { index, message, sha256: sha256Of(message) },
        httpStatus: 0,
        body: undefined,
        elapsedMs: 0,
        transportError: String(err),
        afterReload: afterReload || undefined,
      };
    }
  };

  process.stderr.write(`\nscenario ${scenarioId} (fresh guest — a new UUID per run, no idempotency on this seam)\n`);
  turns.push(await send(BRIEF_TURN_INDEX, 'the verbatim brief', brief.text, false));
  for (const t of SCRIPTED_TURNS) {
    if (t.reloadFirst === true) {
      // A wire harness's "reload": drop every client-side handle except the
      // scenario id. See RELOAD_SEMANTICS — this is NOT the user's reload.
      // A wire harness holds no localStorage, so there is nothing to clear but
      // the handles it kept itself. The scenario id is retained deliberately —
      // that IS what a returning guest has.
      process.stderr.write('  · reload: discarding client-side handles (scenario id retained)\n');
    }
    turns.push(await send(t.index, t.probes, t.message, t.reloadFirst === true));
  }

  const context: RunContext = {
    startedAt,
    mode: 'live',
    stateClass: 'fresh',
    briefSha256: brief.sha256,
    briefBytes: brief.bytes,
    briefPath: brief.path,
    ceeBaseUrl: cli.baseUrl,
    origin: cli.origin,
    scenarioId,
    builds,
    detectors: [
      detectors.narration.status,
      detectors.leaderClaim.status,
      detectors.claimVocabulary.status,
      detectors.coherence.status,
    ],
    reload_semantics: RELOAD_SEMANTICS,
  };

  const { criteria, caveats } = evaluateCriteria({ turns, detectors, adaptCapture });
  return { context, turns, criteria, measurements: collectMeasurements(turns), caveats };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayFixture {
  readonly note?: string;
  readonly brief_sha256?: string;
  readonly expect?: { readonly exit_code?: number; readonly criteria?: Record<string, string> };
  readonly turns: readonly {
    readonly index: number;
    readonly probes?: string;
    readonly message?: string;
    readonly http_status: number;
    readonly body?: unknown;
    readonly transport_error?: string;
  }[];
}

export function fixtureToCaptures(fixture: ReplayFixture): readonly TurnCapture[] {
  return fixture.turns.map((t) => {
    const message = t.message ?? '';
    return {
      index: t.index,
      probes:
        t.probes ??
        (t.index === BRIEF_TURN_INDEX
          ? 'the verbatim brief'
          : (SCRIPTED_TURNS.find((s) => s.index === t.index)?.probes ?? '')),
      sent: { index: t.index, message, sha256: sha256Of(message) },
      httpStatus: t.http_status,
      body: t.body as WireBody | undefined,
      elapsedMs: 0,
      transportError: t.transport_error,
    };
  });
}

async function runReplay(cli: Cli): Promise<HarnessOutcome> {
  const path = resolve(cli.replay as string);
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture;
  const detectors = await buildDetectors(cli.uiRepo);
  const adaptCapture = cli.uiRepo !== undefined ? await loadCaptureAdapter(cli.uiRepo) : undefined;
  const turns = fixtureToCaptures(fixture);

  const context: RunContext = {
    startedAt: new Date().toISOString(),
    mode: 'replay',
    // PROTOCOL.md rule 7: name the state class. A replayed transcript is not a
    // fresh journey and its numbers are not comparable with one.
    stateClass: 'replayed',
    briefSha256: fixture.brief_sha256 ?? '(not declared by the fixture)',
    briefBytes: 0,
    briefPath: path,
    ceeBaseUrl: '(replay — no network)',
    origin: '(replay — no network)',
    scenarioId: '(replay — no scenario)',
    builds: [
      {
        service: 'none',
        sha: undefined,
        derivedFrom: 'replay mode drives no service',
        note: 'A replay proves the CLASSIFIERS behave; it proves nothing about any deployed build.',
      },
    ],
    detectors: [
      detectors.narration.status,
      detectors.leaderClaim.status,
      detectors.claimVocabulary.status,
      detectors.coherence.status,
    ],
    reload_semantics: `${RELOAD_SEMANTICS} (replay: turn 11 is whatever the fixture recorded)`,
  };

  const { criteria, caveats } = evaluateCriteria({ turns, detectors, adaptCapture });
  return {
    context,
    turns,
    criteria,
    measurements: collectMeasurements(turns),
    caveats: [
      'REPLAY MODE — this run drove no deployed service. It exercises the classifiers only.',
      ...caveats,
    ],
  };
}

// ---------------------------------------------------------------------------

export function exitCodeFor(outcome: HarnessOutcome, requireFullyAssessed: boolean): number {
  const t = tally(outcome);
  if (t.fail > 0) return 1;
  if (requireFullyAssessed && t.notAssessed > 0) return 1;
  return 0;
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  let outcome: HarnessOutcome;
  try {
    outcome = cli.replay !== undefined ? await runReplay(cli) : await runLive(cli);
  } catch (err) {
    if (err instanceof HaltError || err instanceof BriefHashMismatchError) {
      process.stderr.write(`\nHALT — ${err.message}\n`);
      return 3;
    }
    process.stderr.write(`\nFATAL — ${String(err)}\n`);
    return 2;
  }

  const md = renderReport(outcome);
  if (cli.out !== undefined) {
    const out = resolve(cli.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md, 'utf8');
    process.stderr.write(`\nreport → ${out}\n`);
    // PROTOCOL.md rule 9 — route evidence to a FILE. A harness that decides a
    // FAIL and keeps none of the payload it decided on cannot be checked, and
    // its verdict has to be taken on trust. The captures go beside the report
    // in the SAME SHAPE the replay mode reads, so any live run can be replayed
    // through the classifiers without re-driving the service.
    //
    // There is no secret on this seam to redact: /proxy/v5/turn takes no
    // credential and CEE strips `user_id`, so a capture is a guest scenario's
    // own turns and nothing else.
    if (outcome.context.mode === 'live') {
      const capturesPath = out.replace(/\.md$/, '') + '.captures.json';
      writeFileSync(
        capturesPath,
        `${JSON.stringify(
          {
            note:
              'Raw captures from a LIVE run. Replayable: `--replay <this file>`. ' +
              'Not a committed fixture — turning a live run into one is the golden-journey ' +
              'capture flow and needs the same authorisation.',
            brief_sha256: outcome.context.briefSha256,
            scenario_id: outcome.context.scenarioId,
            builds: outcome.context.builds,
            turns: outcome.turns.map((t) => ({
              index: t.index,
              probes: t.probes,
              message: t.sent.message,
              http_status: t.httpStatus,
              elapsed_ms: t.elapsedMs,
              ...(t.transportError === undefined ? {} : { transport_error: t.transportError }),
              body: t.body,
            })),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      process.stderr.write(`captures → ${capturesPath}\n`);
    }
  } else {
    process.stdout.write(md);
  }

  process.stderr.write(`\n${headline(outcome)}\n`);
  for (const c of outcome.criteria) {
    process.stderr.write(`  ${c.id} ${c.verdict}\n`);
  }
  const t = tally(outcome);
  if (t.fail === 0 && t.notAssessed > 0) {
    process.stderr.write(
      `\n⚠ exit 0 means NOTHING FAILED. ${t.notAssessed} of 6 criteria were NOT ASSESSED — that is not a pass.\n`,
    );
  }
  return exitCodeFor(outcome, cli.requireFullyAssessed);
}

// Only run when invoked as a script, so the module stays importable by tests.
function isDirectCliInvocation(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`\nFATAL — ${String(err)}\n`);
      process.exitCode = 2;
    });
}
