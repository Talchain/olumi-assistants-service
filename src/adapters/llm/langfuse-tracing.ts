/**
 * Langfuse tracing for the LLM adapter stack.
 *
 * ⭐ WHY A PROXY AND NOT A MIRRORED CLASS. `LLMAdapter` has eight methods, two
 * of them async generators. `UsageTrackingAdapter` mirrors each one by hand,
 * which is correct there because each needs a different task label. Tracing
 * needs no per-method knowledge, so a hand-written mirror here would buy
 * nothing and cost the estate's dominant defect: a method added to the
 * interface later would be silently UNTRACED, and nothing would fail. The
 * Proxy adapts automatically. (CLAUDE.md trap 12 — derive, don't mirror.)
 *
 * ⚠ WHAT THIS SENDS, STATED PLAINLY. Langfuse captures prompt and response
 * content. This is an EGRESS OF USER DECISION CONTENT to Langfuse Cloud
 * (cloud.langfuse.com — verified, not self-hosted). Paul authorised this on
 * 17 Sep 2026 for STAGING CONTENT ONLY, on the basis that staging holds
 * disposable internal scenarios. It does NOT extend to production.
 * ⛔ The §5 redaction contract in `src/utils/logger-config.ts` is LOGGER-scoped
 * and does NOT apply to an outbound HTTP SDK. Nothing here is redacted.
 *
 * ⚠ SPAN GRANULARITY. This wraps OUTSIDE `FailoverAdapter`, so a retry or a
 * cross-provider failover collapses into ONE span. That is a deliberate v1
 * choice: wrapping inside failover means wrapping each concrete adapter and is
 * a larger change. If per-attempt spans are wanted, that is the follow-up.
 *
 * FAIL-OPEN BY CONSTRUCTION: absent credentials ⇒ the adapter is returned
 * untouched, and every tracing error is swallowed. Tracing must never be able
 * to fail a turn.
 */
import type { LLMAdapter } from './types.js';
import { log } from '../../utils/telemetry.js';

/** All three must be present. A partial configuration is treated as OFF. */
export function isLangfuseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY && env.LANGFUSE_BASE_URL);
}

type AnyFn = (...args: unknown[]) => unknown;

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v;
}

interface TraceSink {
  generation(input: Record<string, unknown>): { end(output: Record<string, unknown>): void };
}

/**
 * Wrap an adapter so every method call becomes a Langfuse generation.
 * Returns the adapter UNCHANGED when Langfuse is not configured.
 */
export function withLangfuseTracing(adapter: LLMAdapter, sink?: TraceSink): LLMAdapter {
  const client = sink ?? getSink();
  if (!client) return adapter;

  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || prop === 'constructor') return value;

      return function traced(this: unknown, ...args: unknown[]) {
        const opts = args[1] as { requestId?: string } | undefined;
        let span: { end(o: Record<string, unknown>): void } | undefined;
        try {
          span = client.generation({
            name: String(prop),
            model: target.model,
            metadata: { provider: target.name, requestId: opts?.requestId },
            input: args[0],
          });
        } catch (err) {
          log.debug('[langfuse] span open failed', { err: String(err) });
        }

        let out: unknown;
        try {
          out = (value as AnyFn).apply(target, args);
        } catch (err) {
          try { span?.end({ level: 'ERROR', statusMessage: String(err) }); } catch { /* never throw */ }
          throw err;
        }

        // Async generator methods (streamDraftGraph, streamChatWithTools) must
        // NOT be awaited — close the span when the stream is exhausted.
        if (isAsyncIterable(out)) {
          const src = out as AsyncIterable<unknown>;
          return (async function* () {
            try {
              for await (const chunk of src) yield chunk;
              try { span?.end({ output: '[stream completed]' }); } catch { /* never throw */ }
            } catch (err) {
              try { span?.end({ level: 'ERROR', statusMessage: String(err) }); } catch { /* never throw */ }
              throw err;
            }
          })();
        }

        if (out instanceof Promise) {
          return out.then(
            (r) => { try { span?.end({ output: r, usage: (r as { usage?: unknown })?.usage }); } catch { /* never throw */ } return r; },
            (e) => { try { span?.end({ level: 'ERROR', statusMessage: String(e) }); } catch { /* never throw */ } throw e; },
          );
        }

        try { span?.end({ output: out }); } catch { /* never throw */ }
        return out;
      };
    },
  });
}

let cached: TraceSink | null | undefined;

/** Lazily construct the client. Any failure ⇒ tracing is OFF, never an error. */
function getSink(): TraceSink | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!isLangfuseConfigured()) return cached;
  try {
     
    const { Langfuse } = require('langfuse') as { Langfuse: new (c: object) => TraceSink };
    cached = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
    });
    log.info('[langfuse] tracing enabled');
  } catch (err) {
    log.warn('[langfuse] SDK unavailable; tracing disabled', { err: String(err) });
    cached = null;
  }
  return cached;
}

/** Test seam: forget the memoised client. */
export function __resetLangfuseSinkForTests(): void { cached = undefined; }
