/**
 * Pre-flight gate — REQUIRED before any live model call.
 *
 * Checks: key present, per-model metadata + 1-token generation probe (records
 * the SERVED model ID from the response — no silent substitution ever), the
 * advisor-tool pairing for arm D, and pricing-table staleness. A failed probe
 * blocks that arm cleanly; it never silently downgrades or substitutes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey } from "./client.ts";
import { pricingStaleness, PRICING_TABLE } from "./pricing.ts";
import { ADVISOR_BETA, buildAdvisorTool } from "../arms/arm-d.ts";
import { anthropicSdkVersion as sdkVersion } from "../util/sdk-version.ts";
import type { ArmId, PreflightModelResult, PreflightResult, ResolvedArmModels } from "../types.ts";

async function probeModel(client: Anthropic, model: string): Promise<PreflightModelResult> {
  const result: PreflightModelResult = {
    requested_model: model,
    models_api_ok: false,
    generation_ok: false,
    served_model: null,
    error: null,
  };
  try {
    await client.models.retrieve(model);
    result.models_api_ok = true;
  } catch (err) {
    result.error = `models.retrieve: ${(err as Error).message}`;
  }
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    result.generation_ok = true;
    result.served_model = msg.model;
  } catch (err) {
    result.error = (result.error ? result.error + "; " : "") + `generation: ${(err as Error).message}`;
  }
  return result;
}

async function probeAdvisorPairing(
  client: Anthropic,
  executor: string,
  advisor: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await client.beta.messages.create({
      model: executor,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word ok." }],
      tools: [buildAdvisorTool(advisor)],
      betas: [ADVISOR_BETA],
    } as never);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function runPreflight(models: ResolvedArmModels, now: Date): Promise<PreflightResult> {
  const staleness = pricingStaleness(now);
  const base: PreflightResult = {
    ran_at: now.toISOString(),
    key_present: hasApiKey(),
    sdk_version: sdkVersion(),
    models: [],
    advisor_pairing_ok: null,
    advisor_error: null,
    pricing_stale: staleness.stale,
    pricing_age_days: staleness.age_days,
    arm_gate: {
      A: { allowed: false, reason: "not evaluated" },
      B: { allowed: false, reason: "not evaluated" },
      C: { allowed: false, reason: "not evaluated" },
      D: { allowed: false, reason: "not evaluated" },
    },
  };

  if (!base.key_present) {
    const reason = "ANTHROPIC_API_KEY absent — live path blocked cleanly at pre-flight";
    for (const arm of ["A", "B", "C", "D"] as ArmId[]) base.arm_gate[arm] = { allowed: false, reason };
    return base;
  }

  const client = new Anthropic();
  const uniqueModels = [...new Set([models.A.model, models.B.model, models.C.m1, models.C.m2, models.D.executor, models.D.advisor])];
  for (const model of uniqueModels) {
    base.models.push(await probeModel(client, model));
  }
  const ok = (model: string) => base.models.find((m) => m.requested_model === model)?.generation_ok === true;

  const advisorProbe = await probeAdvisorPairing(client, models.D.executor, models.D.advisor);
  base.advisor_pairing_ok = advisorProbe.ok;
  base.advisor_error = advisorProbe.error;

  base.arm_gate.A = ok(models.A.model)
    ? { allowed: true, reason: "probe passed" }
    : { allowed: false, reason: `model ${models.A.model} failed probe` };
  base.arm_gate.B = ok(models.B.model)
    ? { allowed: true, reason: "probe passed" }
    : { allowed: false, reason: `model ${models.B.model} failed probe` };
  base.arm_gate.C = ok(models.C.m1) && ok(models.C.m2)
    ? { allowed: true, reason: "probes passed" }
    : { allowed: false, reason: "M1 or M2 failed probe" };
  base.arm_gate.D = ok(models.D.executor) && advisorProbe.ok
    ? { allowed: true, reason: "executor + advisor pairing probes passed" }
    : { allowed: false, reason: advisorProbe.error ? `advisor pairing: ${advisorProbe.error}` : "executor failed probe" };

  return base;
}

export function mockPreflight(now: Date): PreflightResult {
  const staleness = pricingStaleness(now, PRICING_TABLE);
  return {
    ran_at: now.toISOString(),
    key_present: false,
    sdk_version: sdkVersion(),
    models: [],
    advisor_pairing_ok: null,
    advisor_error: null,
    pricing_stale: staleness.stale,
    pricing_age_days: staleness.age_days,
    arm_gate: {
      A: { allowed: true, reason: "mock mode — deterministic fixture client, no network" },
      B: { allowed: true, reason: "mock mode — deterministic fixture client, no network" },
      C: { allowed: true, reason: "mock mode — deterministic fixture client, no network" },
      D: { allowed: true, reason: "mock mode — deterministic fixture client, no network" },
    },
  };
}
