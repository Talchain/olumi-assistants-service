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

import {
  TurnRequestSchema,
  SystemEventSchema,
  AnalysisStateSchema,
  GraphSchema,
} from "../src/orchestrator/route-schemas.js";
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
  // Input schemas (UI → CEE)
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
