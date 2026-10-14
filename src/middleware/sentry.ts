/**
 * Sentry integration for CEE.
 *
 * Initialises Sentry with DSN from SENTRY_DSN env var.
 * Skips initialisation when DSN is not set (dev/test environments).
 *
 * Reporting contract (system S-H, shared with PLoT, ISL and the UI):
 *   - environment = SENTRY_ENVIRONMENT, else NODE_ENV;
 *   - release = the full build SHA (src/version.ts);
 *   - tag service=cee on every event.
 *
 * Privacy: request bodies are never captured (Http integration
 * maxIncomingRequestBodySize 'none'), and ONE filter (scrubSentryEvent) runs
 * on errors AND transactions: it strips credential headers, cookies and any
 * request body, redacts the decision-content key class in extra/contexts and
 * span data, and cuts breadcrumbs to their shape (console crumbs dropped).
 *
 * Known residual (reported, not closed here): exception MESSAGE text is sent
 * as written, so an error interpolating a label carries it.
 *
 * Request-scoped isolation ensures tags set for one request do not leak
 * into concurrent requests.
 */

import * as Sentry from '@sentry/node';
import type { Breadcrumb, Event as SentryEvent } from '@sentry/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getRequestId } from '../utils/request-id.js';
import { GIT_COMMIT_SHA } from '../version.js';
import {
  CREDENTIAL_FIELDS,
  CREDENTIAL_HEADER_NAMES,
  isDecisionContentField,
} from '../utils/logger-config.js';

/**
 * Sensitive header names to strip (lower-case for case-insensitive comparison).
 * Derived from the logger's credential-header owner list, so a header added
 * there is stripped here too.
 */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set<string>(CREDENTIAL_HEADER_NAMES);

/** Keys in extra/contexts that likely contain prompt or LLM payload content. */
const SENSITIVE_KEY_PATTERNS = [
  'prompt', 'brief', 'message', 'payload', 'body', 'content', 'llm',
];

const CREDENTIAL_FIELD_SET: ReadonlySet<string> = new Set(
  CREDENTIAL_FIELDS.map((f) => f.toLowerCase()),
);

/**
 * A key whose value must never reach Sentry: the prompt/payload substrings,
 * PLUS the logger's decision-content class (labels, goal text, headline,
 * statement, user/assistant text — logger-config.ts DECISION_CONTENT_FIELDS)
 * and its credential class. One owner list for "what is user content".
 */
function containsSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    SENSITIVE_KEY_PATTERNS.some(p => lower.includes(p)) ||
    isDecisionContentField(key) ||
    CREDENTIAL_FIELD_SET.has(lower)
  );
}

/**
 * Recursively redact sensitive values from an object tree.
 * Replaces values matching sensitive key patterns or large strings with '[Redacted]'.
 * Returns a new object — does not mutate the input.
 */
function deepRedact(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 8) return { _truncated: true };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (containsSensitiveKey(key)) {
      result[key] = '[Redacted]';
    } else if (typeof value === 'string' && value.length > 200) {
      result[key] = '[Redacted — long string]';
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? deepRedact(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else if (value && typeof value === 'object') {
      result[key] = deepRedact(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** A URL with its query string and fragment removed (queries can carry content). */
function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Remove every `?query` / `#fragment` run inside free text (span names). */
export function stripQueriesInText(text: string): string {
  return text.replace(/[?#]\S*/g, '');
}

/** Span / trace attribute keys that ARE a query or fragment: dropped. */
const QUERY_ATTRIBUTE_KEYS = new Set(['http.query', 'url.query', 'http.fragment', 'url.fragment']);

/** Span / trace attribute keys holding a URL: kept with the query stripped. */
function isUrlAttributeKey(key: string): boolean {
  return key === 'url' || key === 'http.url' || key === 'url.full' || key === 'http.target' || key.endsWith('referer');
}

/**
 * Span / trace `data`: the decision-content key class is redacted (as for
 * extra), query attributes are dropped and URL attributes lose their query.
 */
function scrubSpanData(data: Record<string, unknown>): Record<string, unknown> {
  const out = deepRedact(data);
  for (const key of Object.keys(out)) {
    if (QUERY_ATTRIBUTE_KEYS.has(key)) delete out[key];
    else if (isUrlAttributeKey(key)) out[key] = stripQuery(out[key]);
  }
  return out;
}

/**
 * Breadcrumb rule (applied when a crumb is recorded AND again on every
 * outgoing event). A breadcrumb keeps only its SHAPE, never free text:
 *   - console crumbs are dropped (any `console.*` argument can be a label or
 *     a brief; CEE's structured logs go through pino, not console);
 *   - every other crumb loses `message`, and its `data` is cut to the HTTP
 *     shape { method, url (query stripped), status_code }.
 */
function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;
  const out: Breadcrumb = {
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    timestamp: crumb.timestamp,
  };
  const data = crumb.data;
  if (data && typeof data === 'object') {
    const kept: Record<string, unknown> = {};
    if (typeof data.method === 'string') kept.method = data.method;
    if (data.url !== undefined) kept.url = stripQuery(data.url);
    if (typeof data.status_code === 'number') kept.status_code = data.status_code;
    out.data = kept;
  }
  return out;
}

/**
 * The single privacy filter for EVERY event type CEE sends (errors via
 * beforeSend, transactions via beforeSendTransaction). Exported for tests.
 */
export function scrubSentryEvent<E extends SentryEvent>(input: E): E {
  const event: SentryEvent = input;

  // Strip sensitive headers
  if (event.request?.headers) {
    for (const header of Object.keys(event.request.headers)) {
      if (SENSITIVE_HEADERS.has(header.toLowerCase())) {
        delete event.request.headers[header];
      }
    }
  }

  // Strip request body and cookies entirely — user decision briefs, LLM
  // prompts, and freetext fields are user data and must not be captured.
  if (event.request) {
    event.request.data = undefined;
    event.request.cookies = undefined;
    event.request.query_string = undefined;
    if (typeof event.request.url === 'string') event.request.url = stripQuery(event.request.url) as string;
    const headers = event.request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === 'referer') headers[name] = stripQuery(headers[name]) as string;
      }
    }
  }
  if (typeof event.transaction === 'string') event.transaction = stripQueriesInText(event.transaction);

  // Recursively redact extra values containing prompt content or LLM payloads
  if (event.extra) {
    event.extra = deepRedact(event.extra);
  }

  // Recursively redact contexts values containing prompt content or LLM payloads
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (containsSensitiveKey(key)) {
        delete event.contexts[key];
      } else if (event.contexts[key] && typeof event.contexts[key] === 'object') {
        event.contexts[key] = deepRedact(
          event.contexts[key] as Record<string, unknown>,
        );
      }
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Breadcrumb => b !== null);
  }

  // Span attributes (transactions): key-class redaction as for extra, plus
  // query attributes dropped, URL attributes and span names query-stripped.
  if (event.contexts?.trace?.data) {
    event.contexts.trace.data = scrubSpanData(event.contexts.trace.data as Record<string, unknown>);
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      if (span.data) span.data = scrubSpanData(span.data as Record<string, unknown>) as typeof span.data;
      if (typeof span.description === 'string') span.description = stripQueriesInText(span.description);
    }
  }

  return input;
}

/**
 * Environment label. SENTRY_ENVIRONMENT wins: production CEE deliberately runs
 * with NODE_ENV=staging (behaviour is gated on it), so NODE_ENV alone labels
 * every production event "staging". Blank counts as unset.
 */
export function resolveSentryEnvironment(env: NodeJS.ProcessEnv): string {
  const explicit = env.SENTRY_ENVIRONMENT?.trim();
  if (explicit) return explicit;
  return env.NODE_ENV || 'development';
}

/** The honest release when no build SHA is derivable (same word as the UI's build id). */
export const UNIDENTIFIED_RELEASE = 'unidentified';

/**
 * Release = the full build SHA from the ONE build-identity owner
 * (src/version.ts: GIT_COMMIT_SHA env → RENDER_GIT_COMMIT → git). No other
 * source: CEE_BUILD_HASH (set nowhere on Render), the package version and the
 * SDK's own env detection (e.g. SENTRY_RELEASE) all name something other than
 * this build. Underivable → 'unidentified', never a fallback.
 */
function resolveSentryRelease(): string {
  return /^[0-9a-f]{40}$/i.test(GIT_COMMIT_SHA) ? GIT_COMMIT_SHA : UNIDENTIFIED_RELEASE;
}

/**
 * Trace sample rate. A set, finite value in [0, 1] is honoured — INCLUDING 0,
 * which `Number(x) || 0.5` silently turned back into 0.5, so tracing could not
 * be switched off by env. Unset or invalid → 0.5 (unchanged default).
 */
export function resolveTracesSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0.5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
}

/**
 * Initialise Sentry. No-op when SENTRY_DSN is not set.
 * Call this early in the server build function.
 *
 * `testOverrides` exists only so a test can swap the transport and read the
 * envelopes the SDK would send; production calls initSentry() with no args.
 */
export function initSentry(testOverrides: Pick<Sentry.NodeOptions, 'transport'> = {}): void {
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 bootstrap: Sentry init reads env before/around config bootstrap
  const env = process.env;
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: resolveSentryEnvironment(env),
    release: resolveSentryRelease(),
    tracesSampleRate: resolveTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    // Pinned, not defaulted: with PII off the SDK filters IP / user headers
    // and the AI integrations do not record prompts or responses.
    sendDefaultPii: false,
    // Pinned, not defaulted: frame locals hold briefs and graphs.
    includeLocalVariables: false,
    initialScope: { tags: { service: 'cee' } },
    // Replaces the default Http integration (same name) so incoming request
    // bodies are never read into the scope — they would otherwise ride on
    // EVERY event type, transactions included, before any hook runs.
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],

    beforeSend(event) {
      return scrubSentryEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
    ...testOverrides,
  });
}

/**
 * Set the request_id tag on an isolated Sentry scope for this request.
 * Uses withScope to avoid tag leakage between concurrent requests.
 */
export function setSentryRequestTag(requestId: string): void {
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 bootstrap: Sentry init reads env before/around config bootstrap
  if (!process.env.SENTRY_DSN) return;
  Sentry.getCurrentScope().setTag('request_id', requestId);
}

/**
 * Create a Fastify onRequest hook that isolates Sentry scope per request.
 * Each request gets its own isolation scope so tags/breadcrumbs don't leak.
 */
export function createSentryRequestHook() {
  return async function sentryRequestHook(request: FastifyRequest): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 bootstrap: Sentry init reads env before/around config bootstrap
    if (!process.env.SENTRY_DSN) return;
    const requestId = getRequestId(request);
    Sentry.withIsolationScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('method', request.method);
      scope.setTag('route', request.url);
    });
  };
}

/**
 * Register the Sentry Fastify error handler.
 * Call after all routes are registered.
 */
export function setupSentryFastify(app: FastifyInstance): void {
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 bootstrap: Sentry init reads env before/around config bootstrap
  if (!process.env.SENTRY_DSN) return;
  Sentry.setupFastifyErrorHandler(app);
}
