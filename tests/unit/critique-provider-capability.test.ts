/**
 * THE CAPABILITY MAP MUST STATE A FACT, NOT A PREFERENCE.
 *
 * `ROUTER_TASK_PROVIDER_CAPABILITIES` exists to record which providers actually
 * IMPLEMENT a routed operation, as against exposing a stub that throws before
 * making a call. Its value is that it is derived from reality; the moment an
 * entry disagrees with the adapters it describes, it fails a capable provider
 * closed or routes to one that throws.
 *
 * This suite binds the map to the adapters in BOTH directions, so neither can
 * move alone:
 *   · `critique_graph` lists 'openai' because `OpenAIAdapter.critiqueGraph` is
 *     implemented (it previously threw `openai_critique_not_supported`).
 *   · `explain_diff` does NOT list 'openai' because `OpenAIAdapter.explainDiff`
 *     still throws — the asymmetry is the evidence that the map means something.
 *
 * ⚠ AND IT PINS THE THING MOST AT RISK OF QUIET CHANGE: the default. Widening a
 * capability must NOT re-route anything by itself. `TASK_MODEL_DEFAULTS
 * .critique_graph` stays Anthropic, so an OpenAI-only deployment has to select
 * OpenAI explicitly via `CEE_MODEL_CRITIQUE`. If a later change flips the
 * default, this REDs — which is the protection the governing brief asks for when
 * it says "Conventional stays untouched".
 */
import { describe, expect, it } from 'vitest';
import {
  ROUTER_TASK_PROVIDER_CAPABILITIES,
  TASK_MODEL_DEFAULTS,
} from '../../src/config/model-routing.js';
import { MODEL_REGISTRY } from '../../src/config/models.js';

describe('critique_graph is capability-open to OpenAI because the adapter implements it', () => {
  it('⛔ lists openai', () => {
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.critique_graph).toContain('openai');
  });

  it('keeps anthropic and fixtures — this widens, it does not replace', () => {
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.critique_graph).toContain('anthropic');
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.critique_graph).toContain('fixtures');
  });

  it('⚠ CONVENTIONAL GUARD — the checked-in default is still an ANTHROPIC model', () => {
    // The load-bearing assertion. A capability is permission, not assignment: if
    // this default ever became an OpenAI model, every existing caller of
    // critique_graph would silently change provider, which is exactly what the
    // brief forbids. Derived from the registry rather than string-matched, so a
    // rename cannot fool it.
    const def = TASK_MODEL_DEFAULTS.critique_graph;
    expect(typeof def).toBe('string');
    const entry = MODEL_REGISTRY[def as keyof typeof MODEL_REGISTRY];
    expect(entry, `critique_graph default '${def}' must exist in the registry`).toBeDefined();
    expect(entry.provider).toBe('anthropic');
  });

  it('⛔ CONTRAST CONTROL — explain_diff stays closed to openai, because its adapter still throws', () => {
    // Without this the suite would pass on a map that had simply been opened to
    // everything. The asymmetry is the evidence that the map tracks adapters.
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).not.toContain('openai');
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).toContain('anthropic');
  });
});

describe('the map agrees with the adapters it claims to describe', () => {
  it('OpenAIAdapter implements critiqueGraph and still stubs explainDiff', async () => {
    // Read the adapter's own source rather than instantiating it: constructing a
    // real adapter needs credentials and a client, and this assertion is about
    // which methods are implementations versus throwing stubs.
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const path = url.fileURLToPath(
      new URL('../../src/adapters/llm/openai.ts', import.meta.url),
    );
    const src = await fs.readFile(path, 'utf8');

    // POSITIVE CONTROL first: if the file ever fails to load or is renamed, the
    // absence checks below would pass by seeing nothing (trap 13).
    expect(src.length, 'the adapter source must be readable').toBeGreaterThan(1000);
    expect(src).toContain('async critiqueGraph(');
    expect(src).toContain('async explainDiff(');

    // critique_graph: the old stub message must be gone from executable code.
    // It survives only inside the docblock that records the change, so match the
    // throw form rather than the bare string.
    expect(src).not.toContain('throw new Error("openai_critique_not_supported');
    // explain_diff: still a stub, which is why its capability stays closed.
    expect(src).toContain('openai_explain_diff_not_supported');
  });
});
