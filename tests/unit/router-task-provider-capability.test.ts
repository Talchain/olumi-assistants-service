import { describe, it, expect, beforeEach, vi } from "vitest";

import { _resetConfigCache } from "../../src/config/index.js";
import {
  ROUTER_TASK_PROVIDER_CAPABILITIES,
  TASK_MODEL_DEFAULTS,
  getDefaultModelForTask,
  isValidCeeTask,
  type CeeTask,
} from "../../src/config/model-routing.js";
import {
  resolveConfiguredRouterPlan,
  getAdapter,
  TASK_TO_CONFIG_KEY,
} from "../../src/adapters/llm/router.js";

/**
 * Provider capability coherence for router-resolved tasks.
 *
 * Two tasks declare a provider constraint in ROUTER_TASK_PROVIDER_CAPABILITIES
 * (critique_graph, explain_diff): only Anthropic and the deterministic Fixtures
 * adapter implement them. `requireTaskModelAssignmentCapability` enforces that
 * at resolution time — BEFORE any adapter is constructed — so a task whose
 * winning model resolves to OpenAI fails with MODEL_PROVIDER_MISMATCH and the
 * OpenAI `*_not_supported` stubs are never reached through the router.
 *
 * That enforcement was already correct. What was missing is that neither task
 * had a CHECKED-IN default the constraint could be satisfied by:
 *   - critique_graph carried an OpenAI default (gpt-5.2) — guaranteed to fail;
 *   - explain_diff carried NO default at all, so it inherited the global
 *     fallback, which is PROVIDER_DEFAULT_MODELS.openai on the deployed
 *     posture (LLM_PROVIDER unset → config default "openai").
 *
 * The guard below is DERIVED from ROUTER_TASK_PROVIDER_CAPABILITIES, not from a
 * second hand-written list, so a newly constrained task cannot be added without
 * a coherent checked-in default.
 */

/**
 * The deployed cee-staging posture: LLM_PROVIDER is absent from the service
 * environment (so config falls through to its "openai" code default) and no
 * CEE_MODEL_* override is set for the constrained tasks. Cleared explicitly so
 * this suite pins its own precondition rather than inheriting an ambient env.
 */
const DEPLOYED_POSTURE_CLEARED_ENV = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_FAILOVER_PROVIDERS",
  "CEE_MODEL_CRITIQUE",
  "CEE_MODEL_DRAFT",
  "CEE_MODEL_EDIT_GRAPH",
  "CEE_MODEL_ORCHESTRATOR",
  "CEE_MODEL_REPAIR",
  "CEE_MODEL_DECISION_REVIEW",
  "CEE_MODEL_VALIDATION",
  "CEE_MODEL_OPTIONS",
  "CEE_MODEL_CLARIFICATION",
  "CEE_MODEL_M2_REVIEW",
] as const;

function applyDeployedPosture(): void {
  for (const key of DEPLOYED_POSTURE_CLEARED_ENV) {
    vi.stubEnv(key, undefined as unknown as string);
  }
  _resetConfigCache();
}

beforeEach(() => {
  applyDeployedPosture();
});

describe("router task provider capability", () => {
  it("resolves every provider-constrained task to a provider that implements it", () => {
    const constrained = Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES) as Array<
      keyof typeof ROUTER_TASK_PROVIDER_CAPABILITIES
    >;

    // Pin the precondition: this assertion is only meaningful while the
    // capability map is non-empty. An emptied map would make it vacuous.
    expect(
      constrained.length,
      "ROUTER_TASK_PROVIDER_CAPABILITIES is empty; this guard would be vacuous.",
    ).toBeGreaterThan(0);

    const offenders = constrained
      .map((task) => {
        const outcome = resolveConfiguredRouterPlan(task);
        if (outcome.kind !== "single") {
          return {
            task,
            problem:
              outcome.kind === "configuration_error"
                ? `${outcome.error.code} on model '${outcome.model}'`
                : outcome.kind,
          };
        }
        const supported = ROUTER_TASK_PROVIDER_CAPABILITIES[
          task
        ] as readonly string[];
        return supported.includes(outcome.assignment.provider)
          ? null
          : {
              task,
              problem: `resolved provider '${outcome.assignment.provider}' not in [${supported.join(", ")}]`,
            };
      })
      .filter((entry): entry is { task: string; problem: string } => entry !== null);

    expect(
      offenders,
      `Provider-constrained tasks that cannot be served on the deployed posture: ` +
        `${JSON.stringify(offenders)}. Give the task a checked-in ` +
        `TASK_MODEL_DEFAULTS model whose registry provider implements it.`,
    ).toEqual([]);
  });

  it("gives every provider-constrained task a checked-in default rather than the global fallback", () => {
    const constrained = Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES) as string[];

    const withoutCheckedInDefault = constrained.filter(
      (task) => !isValidCeeTask(task) || !getDefaultModelForTask(task as CeeTask),
    );

    expect(
      withoutCheckedInDefault,
      `Provider-constrained tasks with no TASK_MODEL_DEFAULTS entry: ` +
        `${JSON.stringify(withoutCheckedInDefault)}. Without one the task ` +
        `inherits the global LLM_MODEL/provider fallback, so its provider ` +
        `becomes an accident of deployment env rather than a checked-in fact.`,
    ).toEqual([]);
  });

  /**
   * The two assertions above DERIVE their subject from
   * ROUTER_TASK_PROVIDER_CAPABILITIES, which proves the constrained tasks agree
   * with their defaults but can never prove the MAP itself is right — removing
   * a task from it would shrink both guards to silence. This is the corpus
   * half: the list is pinned by hand, so it fails loud in BOTH directions.
   */
  it("pins the constrained task set itself, so the derived guards cannot silently shrink", () => {
    expect(Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES).sort()).toEqual([
      "critique_graph",
      "explain_diff",
    ]);
  });

  it("constructs an Anthropic adapter for explain_diff through the real router path", () => {
    const adapter = getAdapter("explain_diff");
    expect(adapter.name).toBe("anthropic");
    expect(adapter.model).toBe(TASK_MODEL_DEFAULTS.explain_diff);
  });

  it("constructs an Anthropic adapter for critique_graph through the real router path", () => {
    const adapter = getAdapter("critique_graph");
    expect(adapter.name).toBe("anthropic");
    expect(adapter.model).toBe(TASK_MODEL_DEFAULTS.critique_graph);
  });
});

/**
 * OPPOSITE-DIRECTION TWINS.
 *
 * Every task the router can resolve, pinned BY NAME to the exact provider and
 * model it served at staging tip 77e2e7d9 under the deployed posture. Only
 * critique_graph and explain_diff are permitted to move; the other eighteen
 * rows are the control. A per-task provider change anywhere else REDs here.
 */
const PINNED_TASK_RESOLUTIONS: Readonly<Record<string, string>> = Object.freeze({
  bias_check: "anthropic / claude-sonnet-4-20250514",
  clarification: "openai / gpt-4.1-2025-04-14",
  clarify_brief: "openai / gpt-4o-mini",
  decision_review: "openai / gpt-4.1-2025-04-14",
  draft_graph: "anthropic / claude-sonnet-5",
  edit_graph: "anthropic / claude-sonnet-5",
  evidence_helper: "openai / gpt-4.1-2025-04-14",
  explainer: "openai / gpt-4.1-2025-04-14",
  m2_graph_review: "anthropic / claude-opus-4-8",
  options: "openai / gpt-5.2",
  orchestrator: "anthropic / claude-sonnet-5",
  preflight: "openai / gpt-4.1-2025-04-14",
  repair_graph: "openai / gpt-4.1-2025-04-14",
  routing: "anthropic / claude-sonnet-4-20250514",
  sensitivity_coach: "openai / gpt-4.1-2025-04-14",
  suggest_options: "openai / gpt-5.2",
  validate: "openai / gpt-4o-mini",
  validate_graph: "openai / o4-mini",
  // The two tasks this lane moves, pinned to their post-fix identities.
  critique_graph: "anthropic / claude-sonnet-5",
  explain_diff: "anthropic / claude-sonnet-5",
});

describe("router task provider assignment is per-task", () => {
  it("pins every router-resolvable task's provider and model by name", () => {
    const tasks = Array.from(
      new Set([
        ...Object.keys(TASK_MODEL_DEFAULTS),
        ...Object.keys(TASK_TO_CONFIG_KEY),
        ...Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES),
      ]),
    ).sort();

    // The census must cover the pinned table exactly — a task disappearing
    // from the router would otherwise silently shrink this guard to nothing.
    expect(tasks.sort()).toEqual(Object.keys(PINNED_TASK_RESOLUTIONS).sort());

    const actual: Record<string, string> = {};
    for (const task of tasks) {
      const outcome = resolveConfiguredRouterPlan(task);
      actual[task] =
        outcome.kind === "single"
          ? `${outcome.assignment.provider} / ${outcome.assignment.model}`
          : outcome.kind === "configuration_error"
            ? `ERROR ${outcome.error.code} model=${outcome.model}`
            : outcome.kind;
    }

    expect(actual).toEqual(PINNED_TASK_RESOLUTIONS);
  });
});
