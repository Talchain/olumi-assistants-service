/**
 * Generate / check the canonical analysis-ready fixture.
 *
 * Governance rule: Any change to the analysis_ready shape requires all three
 * of these in the same changeset:
 * 1. Schema version bump in ANALYSIS_READY_CONTRACT_VERSION
 * 2. Canonical fixture regeneration via `pnpm generate:analysis-ready-fixture`
 * 3. Notification to UI workstream to update adapter tests
 *
 * Usage:
 *   # Generate (overwrites fixture):
 *   pnpm generate:analysis-ready-fixture
 *
 *   # Check mode (CI-safe, exits non-zero on mismatch):
 *   pnpm check:analysis-ready-contract
 *
 * Env vars:
 *   ASSIST_API_KEY       API key for staging
 *   CEE_STAGING_URL      Base URL (default: https://cee-staging.onrender.com)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { env, exit, argv } from "node:process";
import { AnalysisReadyPayload, ANALYSIS_READY_CONTRACT_VERSION } from "../src/schemas/analysis-ready.js";

const FIXTURE_PATH = path.resolve("tools/fixtures/canonical/analysis-ready.json");
const CHECK_MODE = argv.includes("--check");

const HIRING_BRIEF = `We need to decide whether to hire two additional developers or a single tech lead for our 8-person engineering team. The project deadline is in 6 months and we're currently behind schedule by about 3 weeks. Budget allows for either option but not both. The tech lead would cost about 40% more than a single developer. Key factors include team velocity, code quality, mentorship capacity, and timeline risk.`;

interface CanonicalFixture {
  _contract_version: string;
  _generated_at: string;
  _source_endpoint: string;
  _request_id: string | null;
  _brief_name: string;
  _model: string | null;
  _governance: string;
  payload: Record<string, unknown>;
}

async function sendDraftGraphRequest(baseUrl: string, apiKey: string) {
  const url = `${baseUrl}/orchestrate/v1/turn`;
  const body = {
    message: HIRING_BRIEF,
    scenario_id: `fixture-gen-${Date.now()}`,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} returned ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

function extractAnalysisReadyFromResponse(envelope: Record<string, unknown>): Record<string, unknown> | null {
  const blocks = envelope.blocks as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(blocks)) return null;

  for (const block of blocks) {
    if (block.block_type !== "graph_patch") continue;
    const data = block.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (data.patch_type !== "full_draft") continue;
    if (data.analysis_ready && typeof data.analysis_ready === "object") {
      return data.analysis_ready as Record<string, unknown>;
    }
  }
  return null;
}

function diffSummary(oldFixture: CanonicalFixture, newPayload: Record<string, unknown>): string[] {
  const diffs: string[] = [];
  const oldKeys = new Set(Object.keys(oldFixture.payload));
  const newKeys = new Set(Object.keys(newPayload));

  for (const k of newKeys) {
    if (!oldKeys.has(k)) diffs.push(`+ field added: ${k}`);
  }
  for (const k of oldKeys) {
    if (!newKeys.has(k)) diffs.push(`- field removed: ${k}`);
  }

  // Check option field differences
  const oldOptions = (oldFixture.payload.options ?? []) as Array<Record<string, unknown>>;
  const newOptions = (newPayload.options ?? []) as Array<Record<string, unknown>>;
  if (oldOptions.length > 0 && newOptions.length > 0) {
    const oldOptKeys = new Set(Object.keys(oldOptions[0]));
    const newOptKeys = new Set(Object.keys(newOptions[0]));
    for (const k of newOptKeys) {
      if (!oldOptKeys.has(k)) diffs.push(`+ option field added: ${k}`);
    }
    for (const k of oldOptKeys) {
      if (!newOptKeys.has(k)) diffs.push(`- option field removed: ${k}`);
    }
  }

  if (oldFixture._contract_version !== ANALYSIS_READY_CONTRACT_VERSION) {
    diffs.push(`~ contract version changed: ${oldFixture._contract_version} → ${ANALYSIS_READY_CONTRACT_VERSION}`);
  }

  return diffs;
}

async function main() {
  const baseUrl = env.CEE_STAGING_URL || "https://cee-staging.onrender.com";
  const apiKey = env.ASSIST_API_KEY || "";

  if (!apiKey) {
    console.error("ERROR: ASSIST_API_KEY is required");
    exit(1);
  }

  console.log(`Mode: ${CHECK_MODE ? "CHECK" : "GENERATE"}`);
  console.log(`Endpoint: ${baseUrl}/orchestrate/v1/turn`);
  console.log(`Brief: hiring-decision (pinned)\n`);

  // Send draft_graph request
  console.log("Sending draft_graph request...");
  const envelope = await sendDraftGraphRequest(baseUrl, apiKey);

  const requestId = (envelope.turn_id as string) || null;
  console.log(`Response turn_id: ${requestId}`);

  // Extract analysis_ready from blocks
  const analysisReady = extractAnalysisReadyFromResponse(envelope);
  if (!analysisReady) {
    console.error("ERROR: No analysis_ready found in any full_draft graph_patch block");
    console.error("Blocks:", JSON.stringify((envelope.blocks as unknown[])?.map((b: unknown) => {
      const blk = b as Record<string, unknown>;
      return { type: blk.type, patch_type: (blk.data as Record<string, unknown>)?.patch_type };
    }), null, 2));
    exit(1);
  }

  // Validate against schema — remap option_id → id for validation
  const forValidation = {
    ...analysisReady,
    options: ((analysisReady.options ?? []) as Array<Record<string, unknown>>).map(o => ({
      ...o,
      id: o.option_id ?? o.id,
    })),
  };
  const parseResult = AnalysisReadyPayload.safeParse(forValidation);
  if (!parseResult.success) {
    console.error("ERROR: analysis_ready payload fails AnalysisReadyPayload validation:");
    console.error(JSON.stringify(parseResult.error.flatten(), null, 2));
    exit(1);
  }
  console.log("Schema validation: PASSED\n");

  // Print summary
  const opts = (analysisReady.options ?? []) as Array<Record<string, unknown>>;
  console.log(`  status: ${analysisReady.status}`);
  console.log(`  goal_node_id: ${analysisReady.goal_node_id}`);
  console.log(`  options: ${opts.length}`);
  for (const o of opts) {
    console.log(`    ${o.option_id}: ${o.label} (status=${o.status}, interventions=${JSON.stringify(o.interventions)})`);
  }

  if (CHECK_MODE) {
    // Compare against existing fixture
    if (!existsSync(FIXTURE_PATH)) {
      console.error(`\nERROR: Canonical fixture not found at ${FIXTURE_PATH}`);
      console.error("Run without --check to generate it first.");
      exit(1);
    }

    const existing = JSON.parse(await readFile(FIXTURE_PATH, "utf-8")) as CanonicalFixture;
    const diffs = diffSummary(existing, analysisReady);

    if (diffs.length === 0) {
      console.log("\nCHECK PASSED: Staging output matches canonical fixture shape.");
      exit(0);
    } else {
      console.error("\nCHECK FAILED: Shape differences detected:");
      for (const d of diffs) console.error(`  ${d}`);
      exit(1);
    }
  }

  // Generate mode: write fixture
  const fixture: CanonicalFixture = {
    _contract_version: ANALYSIS_READY_CONTRACT_VERSION,
    _generated_at: new Date().toISOString(),
    _source_endpoint: `${baseUrl}/orchestrate/v1/turn`,
    _request_id: requestId,
    _brief_name: "hiring-decision",
    _model: null,
    _governance: "Any change to analysis_ready shape requires: 1) Schema version bump 2) Fixture regeneration 3) UI adapter test update",
    payload: analysisReady,
  };

  // Print diff if existing file
  if (existsSync(FIXTURE_PATH)) {
    const existing = JSON.parse(await readFile(FIXTURE_PATH, "utf-8")) as CanonicalFixture;
    const diffs = diffSummary(existing, analysisReady);
    if (diffs.length > 0) {
      console.log("\nChanges from previous fixture:");
      for (const d of diffs) console.log(`  ${d}`);
    } else {
      console.log("\nNo shape changes from previous fixture.");
    }
  }

  await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`\nFixture written to ${FIXTURE_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  exit(1);
});
