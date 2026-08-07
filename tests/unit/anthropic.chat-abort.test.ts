/**
 * chatWithAnthropic — external abort-signal wiring (decompose-hardening lane,
 * Codex r2 blocker 3).
 *
 * The decomposed decision_review fan-out (and any adapter.chat caller that
 * forwards CallOpts.signal) relies on `args.signal` actually cancelling the
 * in-flight SDK request. These tests pin:
 *   - a client abort mid-flight aborts the underlying SDK call (the paid
 *     request is cancelled, not merely abandoned),
 *   - an already-aborted signal rejects immediately,
 *   - a plain timeout (no external signal) still classifies as a timeout,
 *     not an external abort.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the mock spy before vi.mock() hoists it
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Stub prompt-loader to prevent Supabase network calls in unit tests
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("mock system prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "test",
    prompt_hash: "abc",
    source: "default",
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: "test",
    use_staging_mode: false,
  }),
  buildDraftPrompt: vi.fn().mockResolvedValue({
    system: "mock system",
    userContent: "mock user content",
  }),
  invalidatePromptCache: vi.fn(),
}));

import { chatWithAnthropic } from "../../src/adapters/llm/anthropic.js";
import { UpstreamTimeoutError } from "../../src/adapters/llm/errors.js";

function abortError(): Error {
  const err = new Error("Request was aborted.");
  err.name = "AbortError";
  return err;
}

describe("chatWithAnthropic — external abort signal", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("client abort mid-flight cancels the underlying SDK request", async () => {
    let sdkSignal: AbortSignal | undefined;
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) => {
        sdkSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
          // Escape hatch: a regression (external signal not wired) fails the
          // assertions below instead of hanging the suite.
          setTimeout(() => reject(new Error("no-abort-escape")), 2_000);
        });
      },
    );

    const client = new AbortController();
    const promise = chatWithAnthropic({
      system: "s",
      userMessage: "u",
      model: "claude-haiku-4-5",
      timeoutMs: 30_000,
      signal: client.signal,
    });
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    client.abort();

    await expect(promise).rejects.toThrow(/aborted by external signal/i);
    // The SDK-level request signal fired — the paid HTTP call was cancelled.
    expect(sdkSignal?.aborted).toBe(true);
  });

  it("an already-aborted signal rejects immediately", async () => {
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) => {
        if (options.signal.aborted) return Promise.reject(abortError());
        return new Promise(() => {
          /* never settles — the pre-aborted path must not reach here unaborted */
        });
      },
    );

    const client = new AbortController();
    client.abort();
    await expect(
      chatWithAnthropic({
        system: "s",
        userMessage: "u",
        model: "claude-haiku-4-5",
        timeoutMs: 30_000,
        signal: client.signal,
      }),
    ).rejects.toThrow(/aborted by external signal/i);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("a timeout WITHOUT an external signal still classifies as a timeout", async () => {
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    );

    await expect(
      chatWithAnthropic({
        system: "s",
        userMessage: "u",
        model: "claude-haiku-4-5",
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  // M2 (Codex r2 pre-merge review): the external-abort branch must carry the
  // repo-canonical `pre_aborted` timeoutPhase — the discriminator m2-review.ts
  // and parse.ts key on to tell a client disconnect from an upstream timeout.
  it("an external abort is typed UpstreamTimeoutError with timeoutPhase 'pre_aborted'", async () => {
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) => {
        if (options.signal.aborted) return Promise.reject(abortError());
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      },
    );

    const client = new AbortController();
    client.abort();
    try {
      await chatWithAnthropic({
        system: "s",
        userMessage: "u",
        model: "claude-haiku-4-5",
        timeoutMs: 30_000,
        signal: client.signal,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      expect((err as UpstreamTimeoutError).timeoutPhase).toBe("pre_aborted");
    }
  });

  it("a genuine timeout (no external signal) keeps timeoutPhase 'body'", async () => {
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    );

    try {
      await chatWithAnthropic({
        system: "s",
        userMessage: "u",
        model: "claude-haiku-4-5",
        timeoutMs: 50,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      expect((err as UpstreamTimeoutError).timeoutPhase).toBe("body");
    }
  });
});
