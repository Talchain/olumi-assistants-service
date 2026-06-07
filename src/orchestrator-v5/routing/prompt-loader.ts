/**
 * V5 — routing prompt loader.
 *
 * Loads `Prompts/v40.txt` once at module import. Exposes the prompt text
 * plus observability primitives (version, hash, systemChars) for the
 * routing call and lifecycle logs (Phase 2.5).
 *
 * Missing/corrupt prompt at init is fatal — process fails to start. This is
 * intentional: deploying without the prompt would produce a silent routing
 * regression (the previous 662-char constant would still route). Fail fast.
 *
 * Path resolution uses `process.cwd()` — the established pattern in this
 * repo for external data files (see dsk-loader.ts, routing-log.ts,
 * draft-coaching-log.ts). The prompt lives under `Prompts/v40.txt`
 * (capital P). Casing matters on Linux/Render — hard-coded lowercase
 * would compile on macOS and 500 at module init on deploy.
 *
 * Test seam: `loadRoutingPrompt(pathResolver)` accepts an injectable path
 * resolver so load-failure tests can point at a missing file without
 * mutating the filesystem or destabilising unrelated module imports.
 *
 * Sanity range [18500, 20500] is a range check, not a correctness field.
 * Hash + version are the primary proof of installation. The check exists
 * to catch "wrong file copied" or "accidental truncation" at init.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const ROUTING_PROMPT_VERSION = 'v40';

/**
 * Sanity range for the prompt size. Range, not equality — lets a small
 * editorial edit land without a deploy block, while catching wrong-file
 * / truncation disasters at module init.
 */
export const EXPECTED_SYSTEM_CHARS_MIN = 18_500;
export const EXPECTED_SYSTEM_CHARS_MAX = 22_000;

export interface LoadedPrompt {
  readonly text: string;
  /**
   * 16-char lowercase hex prefix of SHA-256(text-as-sent).
   * Aliased to `sentHash`; retained as `hash` so existing log fields
   * (`v5.routing.calling_anthropic.prompt_hash`) keep their meaning.
   */
  readonly hash: string;
  /** SHA-256 prefix of the raw on-disk bytes (pre-normalization). */
  readonly sourceHash: string;
  /** SHA-256 prefix of the normalized bytes actually sent to Anthropic. */
  readonly sentHash: string;
  readonly systemChars: number;
  readonly version: typeof ROUTING_PROMPT_VERSION;
}

/**
 * Default resolver — exported so tests can replace it via the
 * `loadRoutingPrompt` seam without touching `fs` or env vars.
 */
export function defaultPromptPath(): string {
  return resolve(process.cwd(), 'Prompts', 'v40.txt');
}

/**
 * Load the routing prompt and compute observability primitives. Non-cached
 * — call sites should use `LOADED_PROMPT` below; this factory exists for
 * isolated tests.
 */
export function loadRoutingPrompt(
  resolvePath: () => string = defaultPromptPath,
): LoadedPrompt {
  const path = resolvePath();
  const raw = readFileSync(path, 'utf-8');
  const sourceHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  // Byte-stability normalization: CRLF/CR → LF, strip trailing whitespace
  // per line. Whitespace-only — no non-whitespace content is changed.
  // (Asserted by prompt-loader.normalization-content-preserving.test.ts.)
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
  const sentHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const systemChars = text.length;
  if (
    systemChars < EXPECTED_SYSTEM_CHARS_MIN ||
    systemChars > EXPECTED_SYSTEM_CHARS_MAX
  ) {
    throw new Error(
      `Routing prompt size ${systemChars} outside expected range ` +
        `[${EXPECTED_SYSTEM_CHARS_MIN}, ${EXPECTED_SYSTEM_CHARS_MAX}]. ` +
        `Likely wrong file at "${path}" or truncation. Refusing to start.`,
    );
  }
  return {
    text,
    hash: sentHash,
    sourceHash,
    sentHash,
    systemChars,
    version: ROUTING_PROMPT_VERSION,
  };
}

/**
 * Module-level eager load. Throws at import time if the prompt is missing
 * or out-of-range. Retained as the on-disk reference + back-compat surface
 * for tests and exported `ROUTING_SYSTEM_PROMPT` constants in
 * `route-with-tool-use.ts`. The actual routing call resolves the snapshot
 * via `ensureRoutingPromptSnapshot()` (PMS-backed, with default fallback).
 */
export const LOADED_PROMPT: LoadedPrompt = loadRoutingPrompt();

// ─────────────────────────────────────────────────────────────────────────
// PMS-backed snapshot API
// ─────────────────────────────────────────────────────────────────────────

import {
  loadPrompt,
  getDefaultPrompts,
  registerDefaultPrompt,
} from '../../prompts/loader.js';
import { mapSource, pmsResolveTaskId, resolvePublicVersion } from '../../prompts/tracked.js';
import { recordPromptResolutionObservation } from '../../prompts/resolution-policy.js';
import { getRuntimeEnv } from '../../config/env-resolver.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';

// Module-init registration: ensure the 'routing' default is always available
// once this module has been imported. The canonical registration also lives
// in `src/prompts/defaults.ts` (registerAllDefaultPrompts) which production
// boot calls; this duplicate registration is idempotent and guarantees
// snapshot builders / routing tests don't have to ordering-depend on the
// bulk-defaults module having been imported first.
try {
  if (!getDefaultPrompts().routing) {
    registerDefaultPrompt('routing', LOADED_PROMPT.text);
  }
} catch {
  // Non-fatal — production registration via registerAllDefaultPrompts() is
  // the source of truth. This block exists only to harden test environments
  // that import the routing loader without booting the full server.
}

/**
 * Routing prompt snapshot — the text actually sent to Anthropic, plus
 * observability primitives. Built once at startup (or lazily) and
 * refreshed by the admin reload endpoint.
 */
export interface RoutingPromptSnapshot {
  readonly text: string;
  /** SHA-256 prefix of pre-normalisation content (PMS equivalence key). */
  readonly raw_hash: string;
  /** SHA-256 prefix of normalised text (Anthropic cache key). */
  readonly sent_hash: string;
  readonly source: 'store' | 'default';
  readonly version: string;
  readonly systemChars: number;
  readonly systemBytes: number;
}

let cachedSnapshot: RoutingPromptSnapshot | null = null;
// Single-flight: coalesce concurrent build calls so the cold path doesn't
// fire `loadPrompt('routing')` multiple times under request burst (which
// would also produce duplicate `v5.prompt_resolved` startup telemetry).
let inflightBuild: Promise<RoutingPromptSnapshot> | null = null;

/**
 * Same content-preserving normalisation applied by `loadRoutingPrompt`:
 * CRLF/CR → LF, strip trailing whitespace per line.
 */
function normaliseRoutingText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

/**
 * Build the routing snapshot from the PMS loader (with default fallback).
 * Throws if the resolved prompt fails the size sanity check, or if the
 * default for `routing` has not yet been registered (ordering guard).
 *
 * Concurrent callers are coalesced via the module-level `inflightBuild`
 * promise so we don't double-fire `loadPrompt('routing')` under burst.
 */
export async function buildRoutingPromptSnapshot(): Promise<RoutingPromptSnapshot> {
  if (inflightBuild) return inflightBuild;
  inflightBuild = doBuildRoutingPromptSnapshot().finally(() => {
    inflightBuild = null;
  });
  return inflightBuild;
}

async function doBuildRoutingPromptSnapshot(): Promise<RoutingPromptSnapshot> {
  const defaults = getDefaultPrompts();
  if (!defaults.routing) {
    throw new Error(
      "buildRoutingPromptSnapshot(): no default registered for task 'routing'. " +
        'registerAllDefaultPrompts() must run before buildRoutingPromptSnapshot().',
    );
  }

  const loaded = await loadPrompt('routing', { trigger: 'startup' });
  const raw = loaded.content;
  const text = normaliseRoutingText(raw);
  const raw_hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const sent_hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const systemChars = text.length;
  const systemBytes = Buffer.byteLength(text, 'utf-8');

  if (
    systemChars < EXPECTED_SYSTEM_CHARS_MIN ||
    systemChars > EXPECTED_SYSTEM_CHARS_MAX
  ) {
    throw new Error(
      `Routing prompt size ${systemChars} outside expected range ` +
        `[${EXPECTED_SYSTEM_CHARS_MIN}, ${EXPECTED_SYSTEM_CHARS_MAX}] ` +
        `(source=${loaded.source}). Refusing to start.`,
    );
  }

  const snapshot: RoutingPromptSnapshot = {
    text,
    raw_hash,
    sent_hash,
    source: loaded.source,
    version: loaded.version != null ? String(loaded.version) : ROUTING_PROMPT_VERSION,
    systemChars,
    systemBytes,
  };
  cachedSnapshot = snapshot;
  log.info(
    {
      key: 'routing',
      // The operator-managed PMS task this snapshot resolves from
      // (alias-aware): `orchestrator`, not a separate `routing` row.
      // Makes the PMS-backed orchestrator source explicit in ops logs.
      pms_task: pmsResolveTaskId('routing'),
      source: snapshot.source,
      version: snapshot.version,
      raw_hash: snapshot.raw_hash,
      sent_hash: snapshot.sent_hash,
      systemChars: snapshot.systemChars,
    },
    'routing.prompt_snapshot.built',
  );
  // PR1 observability (no behaviour change): classify + loudly log/telemeter
  // when the routing prompt resolves from the bundled default in staging/prod.
  // The decision is made once here at build time (the snapshot has no TTL).
  recordPromptResolutionObservation({
    key: 'routing',
    runtimeEnv: getRuntimeEnv(),
    resolvedSource: loaded.source,
    fallbackReason: loaded.fallbackReason,
    trigger: 'startup',
  });
  return snapshot;
}

/**
 * Synchronous accessor for the cached snapshot. Throws if not yet built —
 * use only from code that asserts startup has completed.
 */
export function getRoutingPromptSnapshot(): RoutingPromptSnapshot {
  if (!cachedSnapshot) {
    throw new Error(
      'getRoutingPromptSnapshot(): snapshot not initialised. ' +
        'Call buildRoutingPromptSnapshot() during server startup, or use ' +
        'ensureRoutingPromptSnapshot() from code paths that may run before boot.',
    );
  }
  return cachedSnapshot;
}

/**
 * Lazy accessor: returns the cached snapshot if present, otherwise builds
 * it. Safe to call from request paths and tests that skip server boot.
 *
 * On cache hit, emits `v5.prompt_resolved` with `cache: 'hit'` so every
 * routing turn after boot is observable. The build path is silent here —
 * `buildRoutingPromptSnapshot()` already triggers an emission via the
 * underlying `loadPrompt('routing', { trigger: 'startup' })` call.
 *
 * `trigger` defaults to 'runtime' for the routing call site. Admin status
 * and reload routes pass 'status' / 'reload' so dashboards can filter
 * probe noise out of real-traffic events.
 */
export async function ensureRoutingPromptSnapshot(
  trigger: 'runtime' | 'status' | 'reload' | 'healthz' = 'runtime',
): Promise<RoutingPromptSnapshot> {
  if (cachedSnapshot) {
    const internalSource: 'store' | 'default' = cachedSnapshot.source;
    emit(TelemetryEvents.V5PromptResolved, {
      key: 'routing',
      source: mapSource(internalSource),
      version: resolvePublicVersion('routing', internalSource, cachedSnapshot.version),
      content_hash: cachedSnapshot.raw_hash,
      trigger,
      cache: 'hit',
    });
    return cachedSnapshot;
  }
  return buildRoutingPromptSnapshot();
}

/**
 * Force a rebuild of the snapshot from current PMS state. Used by the
 * admin reload endpoint after cache invalidation. Atomic: cachedSnapshot
 * is only swapped on successful rebuild.
 */
export async function refreshRoutingPromptSnapshot(): Promise<RoutingPromptSnapshot> {
  // Build into a local first so a failed rebuild leaves the existing
  // snapshot intact.
  const previous = cachedSnapshot;
  try {
    cachedSnapshot = null;
    const next = await buildRoutingPromptSnapshot();
    return next;
  } catch (err) {
    cachedSnapshot = previous;
    throw err;
  }
}

/** Test-only — clears the in-memory snapshot. */
export function __resetRoutingPromptSnapshotForTests(): void {
  cachedSnapshot = null;
}
