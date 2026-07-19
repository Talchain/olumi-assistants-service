import { describe, it, expect } from "vitest";

// Derive the set of tasks the ROUTER serves an override for straight from the
// router source — NOT a hand-maintained list in this test. If a task is added
// to the router's env-override table without a checked-in default, this fails.
import {
  TASK_TO_CONFIG_KEY,
  ROUTER_ENV_ONLY_TASKS,
} from "../../src/adapters/llm/router.js";
import { TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";

/**
 * Model-map drift tripwire.
 *
 * Invariant: every task the router can resolve a `CEE_MODEL_*` override for
 * (i.e. every key of the router's TASK_TO_CONFIG_KEY table) MUST either have a
 * checked-in default in TASK_MODEL_DEFAULTS — so a dropped env var lands on a
 * task-specific default rather than the global model — OR be explicitly
 * declared env-only in ROUTER_ENV_ONLY_TASKS.
 *
 * The router-served task list is DERIVED from TASK_TO_CONFIG_KEY (the router's
 * own runtime table), so adding a new routed task without a default trips this
 * test. ROUTER_ENV_ONLY_TASKS is the single hand-maintained exception, and the
 * assertions below force it to stay EXACT (disjoint from the defaults map and
 * never stale) so it cannot silently absorb a task that lost its default.
 */
describe("model-map drift tripwire", () => {
  const routerTasks = Object.keys(TASK_TO_CONFIG_KEY);
  const defaultTasks = new Set(Object.keys(TASK_MODEL_DEFAULTS));
  const envOnly = new Set(ROUTER_ENV_ONLY_TASKS);

  it("every router-routed task has a checked-in default (or is declared env-only)", () => {
    const uncovered = routerTasks.filter(
      (t) => !defaultTasks.has(t) && !envOnly.has(t),
    );
    expect(
      uncovered,
      `Router tasks with a CEE_MODEL_* route but no TASK_MODEL_DEFAULTS entry ` +
        `and not declared env-only: ${JSON.stringify(uncovered)}. Add a ` +
        `checked-in default in src/config/model-routing.ts, or declare the ` +
        `task in ROUTER_ENV_ONLY_TASKS if it intentionally has none.`,
    ).toEqual([]);
  });

  it("no router task is BOTH a checked-in default and declared env-only (disjoint)", () => {
    const both = ROUTER_ENV_ONLY_TASKS.filter((t) => defaultTasks.has(t));
    expect(
      both,
      `Tasks declared env-only that also have a TASK_MODEL_DEFAULTS entry: ` +
        `${JSON.stringify(both)}. Remove them from ROUTER_ENV_ONLY_TASKS.`,
    ).toEqual([]);
  });

  it("every declared env-only task is actually routed by the router (no stale declaration)", () => {
    const stale = ROUTER_ENV_ONLY_TASKS.filter(
      (t) => !(t in TASK_TO_CONFIG_KEY),
    );
    expect(
      stale,
      `env-only declarations no longer present in TASK_TO_CONFIG_KEY: ` +
        `${JSON.stringify(stale)}. Remove them from ROUTER_ENV_ONLY_TASKS.`,
    ).toEqual([]);
  });
});
