import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  beginLiveEvalSingleAttempt,
  isLiveEvalSingleAttempt,
  retryConfigForLiveEval,
  sdkMaxRetriesForLiveEval,
} from '../../../src/adapters/llm/live-eval-retry-policy.js';

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function between(text: string, startMarker: string, endMarker?: string): string {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`source marker is absent: ${startMarker}`);
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  if (end < 0) throw new Error(`source marker is absent: ${endMarker}`);
  return text.slice(start, end);
}

function occurrenceCount(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('live evaluator single-attempt retry policy', () => {
  it('is inert by default and disables both retry layers only inside a scoped live eval', () => {
    expect(isLiveEvalSingleAttempt()).toBe(false);
    expect(sdkMaxRetriesForLiveEval()).toBeUndefined();
    expect(retryConfigForLiveEval()).toBeUndefined();

    const release = beginLiveEvalSingleAttempt();
    expect(isLiveEvalSingleAttempt()).toBe(true);
    expect(sdkMaxRetriesForLiveEval()).toBe(0);
    expect(retryConfigForLiveEval()).toMatchObject({ maxAttempts: 1 });
    release();
    release();
    expect(isLiveEvalSingleAttempt()).toBe(false);
  });

  it('pins one provider call site and both retry controls on Anthropic tool routing', () => {
    const text = source('../../../src/adapters/llm/anthropic.ts');
    const clientFactory = between(text, 'function getClient(): Anthropic', 'const TIMEOUT_MS');
    const toolRoute = between(
      text,
      'export async function chatWithToolsAnthropic',
      'export async function* streamChatWithToolsAnthropic',
    );

    expect(occurrenceCount(toolRoute, 'apiClient.messages.create')).toBe(1);
    expect(toolRoute).toContain('retryConfigForLiveEval()');
    expect(clientFactory).toContain('const sdkMaxRetries = sdkMaxRetriesForLiveEval();');
    expect(clientFactory).toContain('{ maxRetries: sdkMaxRetries }');
    expect(clientFactory).toContain('clientSdkMaxRetries !== sdkMaxRetries');
  });

  it('pins one provider call site and both retry controls on OpenAI tool routing', () => {
    const text = source('../../../src/adapters/llm/openai.ts');
    const clientFactory = between(text, 'function getClient(): OpenAI', 'const TIMEOUT_MS');
    const toolRoute = between(text, '  async chatWithTools(args: ChatWithToolsArgs');

    expect(occurrenceCount(toolRoute, 'apiClient.chat.completions.create')).toBe(1);
    expect(toolRoute).toContain('retryConfigForLiveEval()');
    expect(clientFactory).toContain('const sdkMaxRetries = sdkMaxRetriesForLiveEval();');
    expect(clientFactory).toContain('{ maxRetries: sdkMaxRetries }');
    expect(clientFactory).toContain('clientSdkMaxRetries !== sdkMaxRetries');
  });

  it('opens the single-attempt scope before resolving or calling the live model', () => {
    const text = source('../canonical-precedence-cli.ts');
    const scorer = source('../scorer/canonical-state-precedence.ts');
    const liveBody = between(
      text,
      'export async function runCanonicalPrecedenceCli',
      'const invokedPath',
    );
    const scope = liveBody.indexOf('beginLiveEvalSingleAttempt()');
    const resolution = liveBody.indexOf('resolveLiveOrchestrator()');
    const call = liveBody.indexOf('runLiveCanonicalPrecedenceCase(');
    const release = liveBody.indexOf('releaseRetryPolicy();');

    expect(scope).toBeGreaterThanOrEqual(0);
    expect(resolution).toBeGreaterThan(scope);
    expect(call).toBeGreaterThan(resolution);
    expect(release).toBeGreaterThan(call);
    expect(scorer).toContain("resolution.provider !== 'anthropic' && resolution.provider !== 'openai'");
  });
});
