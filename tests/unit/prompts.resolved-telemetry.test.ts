/**
 * v5.prompt_resolved telemetry shape — emitted on every loadPrompt() call,
 * with `trigger` carrying the resolution origin so dashboards can filter
 * probe noise (healthz/status) out of real-traffic signals.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { loadPrompt } from '../../src/prompts/loader.js';
import { setTestSink } from '../../src/utils/telemetry.js';

let captured: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  captured = [];
  setTestSink((event, data) => {
    captured.push({ event, data });
  });
});

afterEach(() => {
  setTestSink(null);
});

function lastResolved(): Record<string, unknown> | undefined {
  return [...captured].reverse().find((e) => e.event === 'v5.prompt_resolved')
    ?.data;
}

describe('v5.prompt_resolved telemetry', () => {
  it('emits source=default with explicit trigger', async () => {
    await loadPrompt('routing', { forceDefault: true, trigger: 'status' });
    const event = lastResolved();
    expect(event).toBeDefined();
    expect(event!.key).toBe('routing');
    expect(event!.source).toBe('default');
    expect(event!.version).toBe('v40');
    expect(event!.trigger).toBe('status');
    expect(String(event!.content_hash)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('defaults trigger to runtime when not specified', async () => {
    await loadPrompt('routing', { forceDefault: true });
    expect(lastResolved()!.trigger).toBe('runtime');
  });
});
