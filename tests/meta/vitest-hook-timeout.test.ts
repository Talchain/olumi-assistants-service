/**
 * GLOBAL `hookTimeout` self-check (ROADMAP 2.157 / 2.753, 2026-08-14).
 *
 * THE DEFECT THIS PINS. vitest's default `hookTimeout` is an UNDOCUMENTED
 * 10 000 ms. A `beforeAll` that boots the full Fastify server (`await build()`
 * + `app.ready()`) takes ~3–4 s isolated, but under worker CPU starvation it
 * blows 10 s — and when it does, the file's tests are reported SKIPPED, not
 * failed. ROADMAP 2.157 recorded a run showing `219 skipped` with
 * green-looking output that manufactured a false "HEAD broke it" verdict.
 *
 * WHY A GLOBAL, AND WHY THIS GUARD. 2.157 fixed it by hand-passing
 * `SERVER_BOOT_HOOK_TIMEOUT_MS` as each hook's second argument — in three
 * files. Derived at `ae0b4af8`: **81 test files call `await build()` inside a
 * hook and 78 of them carry no explicit boot timeout**, i.e. the hand-passed
 * fix reached 4% of its own surface. `tests/integration/admin.routes.test.ts`
 * is the instance that came due (3/3 deterministic `Hook timed out in
 * 10000ms` → `18 skipped` under load). A hand-maintained mirror drifts
 * silently; the setting now lives once, in both configs, and this guard makes
 * its removal fail loud.
 *
 * ⚠ WHY NOT A BEHAVIOURAL PIN. The natural "sleep past 10 s in a hook and
 * assert the test ran" pin cannot be written honestly: the regression's
 * signature is that the tests SKIP, and a skipped test cannot fail. The suite
 * DOES surface it (the file reports as a failed suite), but the per-test
 * assertion would simply not execute. So this guard binds to the setting that
 * decides the behaviour, and proves below that it can tell PRESENT from
 * ABSENT rather than passing vacuously.
 */

import { describe, it, expect } from "vitest";
import { SERVER_BOOT_HOOK_TIMEOUT_MS } from "../../vitest.shared.js";

/**
 * vitest's built-in default. The number this guard exists to keep us off — NOT
 * a value we choose. If a future vitest raises its default above the measured
 * boot, this guard is still correct, just less load-bearing.
 */
const VITEST_DEFAULT_HOOK_TIMEOUT_MS = 10_000;

type ConfigShape = { test?: { hookTimeout?: number } };

async function loadConfig(specifier: string): Promise<ConfigShape> {
  const mod = (await import(specifier)) as { default: ConfigShape };
  return mod.default;
}

describe("vitest global hookTimeout (ROADMAP 2.157 / 2.753)", () => {
  // Both configs, named explicitly — the required gate is the one that decides
  // merges, the default config is what the advisory Full Test Suite uses, and
  // a boot flake in either produces the same false verdict.
  const CONFIGS: Array<[label: string, specifier: string]> = [
    ["vitest.required.config.ts (the required merge gate)", "../../vitest.required.config.js"],
    ["vitest.config.ts (default / advisory Full Test Suite)", "../../vitest.config.js"],
  ];

  it.each(CONFIGS)("%s sets an explicit global hookTimeout", async (_label, specifier) => {
    const config = await loadConfig(specifier);

    // Bind by IDENTITY to the setting under test, not to "some timeout exists".
    expect(config.test).toBeDefined();
    expect(config.test?.hookTimeout).toBeTypeOf("number");
    expect(config.test?.hookTimeout).toBe(SERVER_BOOT_HOOK_TIMEOUT_MS);
  });

  it.each(CONFIGS)(
    "%s keeps hookTimeout ABOVE vitest's 10s default (the silent-skip threshold)",
    async (_label, specifier) => {
      const config = await loadConfig(specifier);
      // The defect is specifically "a server boot exceeds the DEFAULT and the
      // file's tests skip". Asserting the relation, not just the literal, keeps
      // this meaningful if the constant is ever re-sized.
      expect(config.test?.hookTimeout).toBeGreaterThan(VITEST_DEFAULT_HOOK_TIMEOUT_MS);
    },
  );

  it("the shared constant is sized for a starved server boot, not for the default", () => {
    // Sized to the measured boot (~3–4s isolated) with ~15x headroom — see the
    // rationale on the constant. Floor asserted well above the default so a
    // "tidy-up" to 10_001 would not satisfy the intent silently.
    expect(SERVER_BOOT_HOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("POSITIVE CONTROL: this reader can tell an ABSENT hookTimeout from a present one", () => {
    // Trap 13 — an assertion that proves an absence must first prove it can see
    // a presence. Without this, a reader that silently returned `undefined` for
    // every config (wrong specifier, changed export shape) would pass the
    // "greater than" assertions above only by throwing... and pass a
    // `toBeUndefined()` style check by testing nothing at all.
    const present: ConfigShape = { test: { hookTimeout: 60_000 } };
    const absent: ConfigShape = { test: {} };
    const noTestBlock: ConfigShape = {};

    expect(present.test?.hookTimeout).toBe(60_000);
    expect(absent.test?.hookTimeout).toBeUndefined();
    expect(noTestBlock.test?.hookTimeout).toBeUndefined();

    // And the discrimination the real assertions rely on: an absent value must
    // FAIL the same comparison a present one passes.
    expect(() =>
      expect(absent.test?.hookTimeout).toBeGreaterThan(VITEST_DEFAULT_HOOK_TIMEOUT_MS),
    ).toThrow();
    expect(present.test?.hookTimeout).toBeGreaterThan(VITEST_DEFAULT_HOOK_TIMEOUT_MS);
  });
});
