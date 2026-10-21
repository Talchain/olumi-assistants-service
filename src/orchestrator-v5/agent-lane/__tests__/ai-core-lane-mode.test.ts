/**
 * ⭐ PATH-B (Paul 19 Oct: the AI core apart from Olumi's meaning layer, on the same build, per request). The lane mode for ONE
 * request (`laneModeFor`): `x-olumi-ai-mode: core` selects `core` on a staging, local or test runtime only; a read-only preview
 * stays read-only whatever the request says; production, an unknown runtime and any other header value keep the base mode.
 */
import { describe, expect, it } from 'vitest';
import { AI_CORE_MODE, laneModeFor, toolsFor } from '../runtime/agent-tools.js';

describe('laneModeFor: the per-request lane mode', () => {
  it('core on staging, local and test; the full tool surface either way', () => {
    for (const env of ['staging', 'local', 'test']) expect(laneModeFor('full', AI_CORE_MODE, env), env).toBe('core');
    expect(toolsFor('core').map((t) => t.name)).toEqual(toolsFor('full').map((t) => t.name));
  });

  it('⛔ never in production, nor on a runtime whose class is unknown', () => {
    expect(laneModeFor('full', 'core', 'prod')).toBe('full');
    expect(laneModeFor('full', 'core', '')).toBe('full');
  });

  it('⛔ a request never widens a read-only preview', () => {
    expect(laneModeFor('preview', 'core', 'staging')).toBe('preview');
    expect(laneModeFor('preview', 'openai', 'staging')).toBe('preview');
  });

  it('THIN CORE FLIP: the UI\'s staging default (`openai`) is the core lane on staging, local and test; never in production', () => {
    for (const env of ['staging', 'local', 'test']) expect(laneModeFor('full', 'openai', env), env).toBe('core');
    expect(laneModeFor('full', 'openai', 'prod')).toBe('full');
  });

  it('THE NAMED BRIDGE (Codex #3522 r3): on the default header, a scenario saved before the core lane keeps its legacy lane', () => {
    expect(laneModeFor('full', 'openai', 'staging', true)).toBe('full');
    expect(laneModeFor('full', 'openai', 'staging', false), 'CONTRAST: a core or new scenario').toBe('core');
    expect(laneModeFor('full', 'core', 'staging', true), 'an explicit core request is unchanged').toBe('core');
    expect(laneModeFor('preview', 'openai', 'staging', false)).toBe('preview');
  });

  it('any other value keeps the base mode (contrast: only the exact values select core)', () => {
    for (const value of [undefined, 'conventional', 'CORE', 'OPENAI', ['core'], 'core ']) {
      expect(laneModeFor('full', value, 'staging'), String(value)).toBe('full');
    }
  });
});
