/**
 * DSK Claim ID Registry Generator.
 *
 * Generates a skeleton DSK bundle with allocated IDs and PLACEHOLDER content.
 * The linter will fail on this skeleton (placeholders aren't valid content),
 * but IDs are usable immediately.
 *
 * Also writes data/dsk/context-tags.json if it doesn't already exist.
 *
 * Usage:
 *   pnpm dsk:init
 */

import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DSKBundle,
  DSKClaim,
  DSKProtocol,
  DSKTrigger,
} from "../src/dsk/types.js";
import { computeDSKHash } from "../src/dsk/hash.js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename));

const OUTPUT_PATH = resolve(repoRoot, "data/dsk/v1.json");
const CONTEXT_TAGS_PATH = resolve(repoRoot, "data/dsk/context-tags.json");

const CONTEXT_TAGS_VOCAB = [
  "pricing",
  "hiring",
  "build_vs_buy",
  "market_entry",
  "resource_allocation",
  "prioritisation",
  "team_structure",
  "vendor_selection",
  "feature_scope",
  "investment",
  "partnership",
  "product_strategy",
  "go_to_market",
  "general",
];

// Illustrative registry — Paul will supply the finalised ID allocation.
// IDs follow the canonical format: DSK-(B|T|F|G|P|TR)-NNN
const planned = {
  claims: [
    // Bias claims (empirical)
    { id: "DSK-B-001", title: "Anchoring bias" },
    { id: "DSK-B-002", title: "Confirmation bias" },
    { id: "DSK-B-003", title: "Sunk cost fallacy" },
    { id: "DSK-B-004", title: "Overconfidence" },
    { id: "DSK-B-005", title: "Availability heuristic" },
    { id: "DSK-B-006", title: "Status quo bias" },
    { id: "DSK-B-007", title: "Narrow framing" },
    { id: "DSK-B-008", title: "Planning fallacy" },
    { id: "DSK-B-009", title: "Affect heuristic" },
    // Technique efficacy claims
    { id: "DSK-T-001", title: "Pre-mortem efficacy" },
    { id: "DSK-T-002", title: "Disconfirmation efficacy" },
    { id: "DSK-T-003", title: "Outside view / base rates efficacy" },
    { id: "DSK-T-004", title: "10-10-10 efficacy" },
    { id: "DSK-T-005", title: "Devils advocate efficacy" },
    { id: "DSK-T-006", title: "Evidence typing efficacy" },
    { id: "DSK-T-007", title: "Opportunity cost analysis efficacy" },
  ],
  protocols: [
    { id: "DSK-P-001", title: "Pre-mortem protocol" },
    { id: "DSK-P-002", title: "Disconfirmation protocol" },
    { id: "DSK-P-003", title: "Outside view protocol" },
    { id: "DSK-P-004", title: "10-10-10 protocol" },
    { id: "DSK-P-005", title: "Devils advocate protocol" },
    { id: "DSK-P-006", title: "Evidence typing protocol" },
    { id: "DSK-P-007", title: "Opportunity cost protocol" },
  ],
  triggers: [
    { id: "DSK-TR-001", title: "Binary framing detected" },
    { id: "DSK-TR-002", title: "Certainty language detected" },
    { id: "DSK-TR-003", title: "Sunk cost language detected" },
    { id: "DSK-TR-004", title: "Defaulted confidence cluster" },
    { id: "DSK-TR-005", title: "Single dominant factor" },
    { id: "DSK-TR-006", title: "Affect language detected" },
    { id: "DSK-TR-007", title: "Optimistic timeline language detected" },
    { id: "DSK-TR-008", title: "Narrow option set detected" },
  ],
};

const today = new Date().toISOString().split("T")[0]!;

function makeClaim(entry: { id: string; title: string }): DSKClaim {
  return {
    id: entry.id,
    type: "claim",
    title: entry.title,
    evidence_strength: "medium",
    contraindications: ["PLACEHOLDER — needs review"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "0.1.0",
    last_reviewed_at: today,
    source_citations: [
      {
        doi_or_isbn: "PLACEHOLDER — needs review",
        page_or_section: "PLACEHOLDER — needs review",
      },
    ],
    deprecated: false,
    claim_category: "empirical",
    scope: {
      decision_contexts: ["general"],
      stages: ["evaluate"],
      populations: ["PLACEHOLDER — needs review"],
      exclusions: ["PLACEHOLDER — needs review"],
    },
    permitted_phrasing_band: "medium",
    evidence_pack: {
      key_findings: "PLACEHOLDER — needs review",
      effect_direction: "negative",
      boundary_conditions: "PLACEHOLDER — needs review",
      known_limitations: "PLACEHOLDER — needs review",
    },
  };
}

function makeProtocol(entry: { id: string; title: string }): DSKProtocol {
  return {
    id: entry.id,
    type: "protocol",
    title: entry.title,
    evidence_strength: "medium",
    contraindications: ["PLACEHOLDER — needs review"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "0.1.0",
    last_reviewed_at: today,
    source_citations: [
      {
        doi_or_isbn: "PLACEHOLDER — needs review",
        page_or_section: "PLACEHOLDER — needs review",
      },
    ],
    deprecated: false,
    steps: ["PLACEHOLDER — needs review"],
    required_inputs: ["PLACEHOLDER — needs review"],
    expected_outputs: ["PLACEHOLDER — needs review"],
  };
}

function makeTrigger(entry: { id: string; title: string }): DSKTrigger {
  return {
    id: entry.id,
    type: "trigger",
    title: entry.title,
    evidence_strength: "medium",
    contraindications: ["PLACEHOLDER — needs review"],
    stage_applicability: ["evaluate"],
    context_tags: ["general"],
    version: "0.1.0",
    last_reviewed_at: today,
    source_citations: [
      {
        doi_or_isbn: "PLACEHOLDER — needs review",
        page_or_section: "PLACEHOLDER — needs review",
      },
    ],
    deprecated: false,
    observable_signal: "PLACEHOLDER — needs review",
    recommended_behaviour: "PLACEHOLDER — needs review",
    negative_conditions: ["PLACEHOLDER — needs review"],
    linked_claim_ids: [],
    linked_protocol_ids: [],
  };
}

async function main(): Promise<void> {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });

  // Write context-tags.json if it doesn't already exist
  let wroteVocab = false;
  try {
    await access(CONTEXT_TAGS_PATH);
  } catch {
    await writeFile(
      CONTEXT_TAGS_PATH,
      JSON.stringify(CONTEXT_TAGS_VOCAB, null, 2) + "\n",
      "utf-8",
    );
    wroteVocab = true;
  }

  // Gather all objects in canonical id order
  const objects = [
    ...planned.claims.map(makeClaim),
    ...planned.protocols.map(makeProtocol),
    ...planned.triggers.map(makeTrigger),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const bundle: DSKBundle = {
    version: "0.1.0",
    generated_at: new Date().toISOString(),
    dsk_version_hash: "",
    objects,
  };

  // Compute and set the canonical hash
  bundle.dsk_version_hash = computeDSKHash(bundle);

  await writeFile(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n", "utf-8");

  console.log(`Generated DSK skeleton: ${OUTPUT_PATH}`);
  console.log(
    `  Objects: ${objects.length} (${planned.claims.length} claims, ${planned.protocols.length} protocols, ${planned.triggers.length} triggers)`,
  );
  console.log(`  Hash: ${bundle.dsk_version_hash}`);
  if (wroteVocab) {
    console.log(`  Wrote context-tags vocabulary: ${CONTEXT_TAGS_PATH}`);
  }
}

main();
