#!/usr/bin/env tsx
/**
 * Export boundary Zod schemas as JSON Schema files to contracts/.
 *
 * Usage:
 *   npx tsx scripts/export-schemas.ts
 *
 * Exits non-zero if any conversion fails.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

import { OrchestratorTurnPayloadSchema } from "@talchain/schemas/boundary";
import { V5RequestExtensionsSchema } from "../src/orchestrator-v5/boundary/request-extensions.js";
import { OrchestratorResponseEnvelopeV2Schema } from "../src/orchestrator/validation/response-envelope-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "..", "contracts");

interface SchemaEntry {
  name: string;
  filename: string;
  schema: ZodTypeAny;
}

const schemas: SchemaEntry[] = [
  // LIVE V5 ingress schemas (UI → CEE, /orchestrate/v2/turn — the real wire).
  // These are what CEE's runPreFlight actually validates today:
  //   OrchestratorTurnPayload = B1 core (strip extensions, then this .strict()
  //   discriminated union), V5RequestExtensions = the graph_state/
  //   analysis_state/user_id/selected_elements slice re-parsed after B1.
  // Exporting them here is the whole point of the "Contract schemas" job:
  //   drift-check the shapes the live path depends on.
  { name: "OrchestratorTurnPayloadSchema", filename: "orchestrator-turn-payload.schema.json", schema: OrchestratorTurnPayloadSchema },
  { name: "V5RequestExtensionsSchema", filename: "v5-request-extensions.schema.json", schema: V5RequestExtensionsSchema },

  // Output schema (CEE → UI)
  { name: "OrchestratorResponseEnvelopeV2Schema", filename: "orchestrator-response-v2.schema.json", schema: OrchestratorResponseEnvelopeV2Schema },

  // FROZEN legacy contracts — NO LONGER EXPORTED HERE.
  //   turn-request / system-event / analysis-state / graph-state (V1-route Zod,
  //   `src/orchestrator/route-schemas.ts`) and stream-event
  //   (`src/orchestrator/pipeline/stream-events.ts`) had their Zod source
  //   DELETED with the V1 orchestrator belt (PR #615). The generated
  //   contracts/*.schema.json for those five are RETAINED, committed, and
  //   frozen — they are the pins the UI's #394 KNOWN-DIVERGENCE mirror gate
  //   still consumes, and the tests/contracts/schema-self-test.test.ts fixtures.
  //   They can only be retired in a cross-repo window: warn the UI first (their
  //   pins go red by design), then delete the JSON + their self-test blocks.
  //   Because their Zod source is gone they can no longer be regenerated; do NOT
  //   re-add an export entry for them. See contracts/README.md "Live vs legacy".
];

mkdirSync(CONTRACTS_DIR, { recursive: true });

let failed = false;

for (const entry of schemas) {
  try {
    const jsonSchema = zodToJsonSchema(entry.schema, { name: entry.name, target: "jsonSchema7" });
    const outPath = resolve(CONTRACTS_DIR, entry.filename);
    writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");
    console.log(`✓ ${entry.filename}`);
  } catch (err) {
    console.error(`✗ ${entry.filename}: ${err}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nSchema export failed.");
  process.exit(1);
}

console.log(`\nAll ${schemas.length} schemas exported to contracts/`);
