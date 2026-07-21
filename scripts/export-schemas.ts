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
import {
  TurnRequestSchema,
  SystemEventSchema,
  AnalysisStateSchema,
  GraphSchema,
} from "../src/orchestrator/route-schemas.js";
import { V5RequestExtensionsSchema } from "../src/orchestrator-v5/boundary/request-extensions.js";
import { OrchestratorStreamEventSchema } from "../src/orchestrator/pipeline/stream-events.js";
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
  //   drift-check the shapes the live path depends on. (The four INPUT schemas
  //   below are V1-route-derived and NO live path validates them — kept for the
  //   UI's #394 KNOWN-DIVERGENCE mirror pins until the cross-repo retire window.)
  { name: "OrchestratorTurnPayloadSchema", filename: "orchestrator-turn-payload.schema.json", schema: OrchestratorTurnPayloadSchema },
  { name: "V5RequestExtensionsSchema", filename: "v5-request-extensions.schema.json", schema: V5RequestExtensionsSchema },

  // LEGACY input schemas (UI → CEE) — derived from the 410'd V1 route
  // (route.ts / route-stream.ts); their only runtime importers are those dead
  // routes. Retained as the contract the UI's mirror gate still pins; do NOT
  // delete without warning the UI first (their KNOWN-DIVERGENCE pins go red by
  // design). See contracts/README.md "Live vs legacy".
  { name: "TurnRequestSchema", filename: "turn-request.schema.json", schema: TurnRequestSchema },
  { name: "SystemEventSchema", filename: "system-event.schema.json", schema: SystemEventSchema },
  { name: "AnalysisStateSchema", filename: "analysis-state.schema.json", schema: AnalysisStateSchema },
  { name: "GraphSchema", filename: "graph-state.schema.json", schema: GraphSchema },

  // Output schemas (CEE → UI)
  { name: "OrchestratorResponseEnvelopeV2Schema", filename: "orchestrator-response-v2.schema.json", schema: OrchestratorResponseEnvelopeV2Schema },
  { name: "OrchestratorStreamEventSchema", filename: "stream-event.schema.json", schema: OrchestratorStreamEventSchema },
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
