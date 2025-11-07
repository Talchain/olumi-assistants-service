#!/usr/bin/env tsx
/**
 * Evidence Pack CLI Tool
 *
 * Generates privacy-preserving evidence packs for auditing and compliance.
 *
 * Usage:
 *   # From JSON file containing draft output
 *   pnpm ops:evidence output.json
 *
 *   # From stdin
 *   cat output.json | pnpm ops:evidence -
 *
 * The input JSON should contain the draft output with:
 *   - rationales (array)
 *   - citations (array)
 *   - csv_stats (array)
 *
 * Output: Pretty-printed evidence pack with document citations,
 *         CSV statistics, and rationales with provenance.
 */

import { readFileSync } from "node:fs";
import { env } from "node:process";

const ASSISTANTS_URL = env.ASSISTANTS_BASE_URL || "http://localhost:3101";

interface EvidencePack {
  schema: string;
  generated_at: string;
  service_version: string;
  document_citations: Array<{
    source?: string;
    location?: string;
    quote?: string;
    provenance_source?: string;
  }>;
  csv_statistics: Array<{
    filename?: string;
    row_count?: number;
    column_count?: number;
    statistics?: Record<string, any>;
  }>;
  rationales_with_provenance: Array<{
    target?: string;
    why?: string;
    provenance_source?: string;
    quote?: string;
    location?: string;
  }>;
  privacy_notice: string;
}

async function generateEvidencePack(draftOutput: any): Promise<EvidencePack> {
  const response = await fetch(`${ASSISTANTS_URL}/assist/evidence-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draftOutput),
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.error("❌ Evidence pack endpoint not enabled");
      console.error("   Set ENABLE_EVIDENCE_PACK=true in environment");
      process.exit(1);
    }
    throw new Error(`Evidence pack generation failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function prettyPrintEvidencePack(pack: EvidencePack): void {
  console.log("\n📦 Evidence Pack");
  console.log("═".repeat(70));
  console.log(`Schema: ${pack.schema}`);
  console.log(`Generated: ${pack.generated_at}`);
  console.log(`Service Version: ${pack.service_version}`);
  console.log("");

  // Document Citations
  if (pack.document_citations.length > 0) {
    console.log("📄 Document Citations");
    console.log("─".repeat(70));
    pack.document_citations.forEach((cit, i) => {
      console.log(`[${i + 1}] ${cit.source || "Unknown source"}`);
      if (cit.location) {
        console.log(`    Location: ${cit.location}`);
      }
      if (cit.quote) {
        console.log(`    Quote: "${cit.quote}"`);
      }
      if (cit.provenance_source) {
        console.log(`    Provenance: ${cit.provenance_source}`);
      }
      console.log("");
    });
  } else {
    console.log("📄 Document Citations: None");
    console.log("");
  }

  // CSV Statistics
  if (pack.csv_statistics.length > 0) {
    console.log("📊 CSV Statistics");
    console.log("─".repeat(70));
    pack.csv_statistics.forEach((stats, i) => {
      console.log(`[${i + 1}] ${stats.filename || "Unknown file"}`);
      if (stats.row_count !== undefined) {
        console.log(`    Rows: ${stats.row_count}`);
      }
      if (stats.column_count !== undefined) {
        console.log(`    Columns: ${stats.column_count}`);
      }
      if (stats.statistics) {
        console.log(`    Statistics:`);
        for (const [col, colStats] of Object.entries(stats.statistics)) {
          console.log(`      ${col}:`);
          for (const [key, value] of Object.entries(colStats as any)) {
            console.log(`        ${key}: ${value}`);
          }
        }
      }
      console.log("");
    });
  } else {
    console.log("📊 CSV Statistics: None");
    console.log("");
  }

  // Rationales with Provenance
  if (pack.rationales_with_provenance.length > 0) {
    console.log("💡 Rationales with Provenance");
    console.log("─".repeat(70));
    pack.rationales_with_provenance.forEach((rat, i) => {
      console.log(`[${i + 1}] Target: ${rat.target || "Unknown"}`);
      console.log(`    Why: ${rat.why || "No reasoning"}`);
      if (rat.provenance_source) {
        console.log(`    Source: ${rat.provenance_source}`);
      }
      if (rat.quote) {
        console.log(`    Quote: "${rat.quote}"`);
      }
      if (rat.location) {
        console.log(`    Location: ${rat.location}`);
      }
      console.log("");
    });
  } else {
    console.log("💡 Rationales with Provenance: None");
    console.log("");
  }

  // Privacy Notice
  console.log("🔒 Privacy Notice");
  console.log("─".repeat(70));
  console.log(pack.privacy_notice);
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: pnpm ops:evidence <file.json>");
    console.error("       cat output.json | pnpm ops:evidence -");
    process.exit(1);
  }

  let inputData: string;

  if (args[0] === "-") {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    inputData = Buffer.concat(chunks).toString("utf-8");
  } else {
    // Read from file
    try {
      inputData = readFileSync(args[0], "utf-8");
    } catch (error) {
      console.error(`❌ Failed to read file: ${args[0]}`);
      console.error(`   ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  }

  let draftOutput: any;
  try {
    draftOutput = JSON.parse(inputData);
  } catch (error) {
    console.error("❌ Invalid JSON input");
    console.error(`   ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exit(1);
  }

  console.log(`🔄 Generating evidence pack...`);
  console.log(`   Service: ${ASSISTANTS_URL}`);

  try {
    const pack = await generateEvidencePack(draftOutput);
    prettyPrintEvidencePack(pack);
    console.log("✅ Evidence pack generated successfully");
  } catch (error) {
    console.error("❌ Evidence pack generation failed");
    console.error(`   ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
