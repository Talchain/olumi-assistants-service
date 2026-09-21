#!/usr/bin/env node
/**
 * Consistency check for docs/cee-text-flow-data.json
 * Computes totals from the actual field list and validates them against meta.summary.
 * Run: node scripts/verify-text-flow-audit.js
 */

const fs = require('fs');
const path = require('path');

const dataPath = path.resolve(__dirname, '../docs/cee-text-flow-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const counts = { PASSED_THROUGH: 0, TRANSFORMED: 0, GATED: 0, CONSUMED_INTERNALLY: 0, DROPPED: 0 };
let total = 0;
const perPrompt = {};
let missingRatings = 0;
const missingRatingDetails = [];

for (const [name, p] of Object.entries(data.prompts)) {
  const promptCounts = { PASSED_THROUGH: 0, TRANSFORMED: 0, GATED: 0, CONSUMED_INTERNALLY: 0, DROPPED: 0 };
  let promptTotal = 0;

  const allFields = [...(p.fields || [])];
  if (p.actual_consumers) {
    for (const c of Object.values(p.actual_consumers)) {
      if (c.fields) allFields.push(...c.fields);
    }
  }

  for (const f of allFields) {
    const cls = f.classification;
    if (!(cls in counts)) {
      console.error(`ERROR: Unknown classification "${cls}" in ${name}.${f.field}`);
      process.exit(1);
    }
    counts[cls]++;
    promptCounts[cls]++;
    total++;
    promptTotal++;

    if (['DROPPED', 'GATED', 'CONSUMED_INTERNALLY'].includes(cls) && !f.dead_text_quality) {
      missingRatings++;
      missingRatingDetails.push(`${name}.${f.field} (${cls})`);
    }
  }

  perPrompt[name] = { total: promptTotal, ...promptCounts };
}

// Validate against meta
const meta = data.meta;
let errors = 0;

if (meta.total_text_fields !== total) {
  console.error(`MISMATCH: meta.total_text_fields=${meta.total_text_fields}, computed=${total}`);
  errors++;
}
if (meta.summary.passed_through !== counts.PASSED_THROUGH) {
  console.error(`MISMATCH: meta.summary.passed_through=${meta.summary.passed_through}, computed=${counts.PASSED_THROUGH}`);
  errors++;
}
if (meta.summary.transformed !== counts.TRANSFORMED) {
  console.error(`MISMATCH: meta.summary.transformed=${meta.summary.transformed}, computed=${counts.TRANSFORMED}`);
  errors++;
}
if (meta.summary.gated !== counts.GATED) {
  console.error(`MISMATCH: meta.summary.gated=${meta.summary.gated}, computed=${counts.GATED}`);
  errors++;
}
if (meta.summary.consumed_internally !== counts.CONSUMED_INTERNALLY) {
  console.error(`MISMATCH: meta.summary.consumed_internally=${meta.summary.consumed_internally}, computed=${counts.CONSUMED_INTERNALLY}`);
  errors++;
}
if (meta.summary.dropped !== counts.DROPPED) {
  console.error(`MISMATCH: meta.summary.dropped=${meta.summary.dropped}, computed=${counts.DROPPED}`);
  errors++;
}

// Check all 13 prompts present
const expectedPrompts = [
  'draft_graph', 'edit_graph', 'repair_graph', 'validate_graph', 'decision_review',
  'orchestrator', 'suggest_options', 'clarify_brief', 'critique_graph',
  'explainer', 'bias_check', 'enrich_factors', 'repair_edit_graph'
];
for (const p of expectedPrompts) {
  if (!data.prompts[p]) {
    console.error(`MISSING: prompt "${p}" not found in data`);
    errors++;
  }
}

// Report
console.log('=== Text Flow Audit Consistency Check ===');
console.log(`Total fields: ${total}`);
console.log(`Counts: ${JSON.stringify(counts)}`);
console.log(`Prompts: ${Object.keys(data.prompts).length}/13`);
console.log('');
console.log('Per-prompt breakdown:');
for (const [name, c] of Object.entries(perPrompt)) {
  console.log(`  ${name}: ${c.total} (P:${c.PASSED_THROUGH} T:${c.TRANSFORMED} G:${c.GATED} C:${c.CONSUMED_INTERNALLY} D:${c.DROPPED})`);
}
console.log('');

if (missingRatings > 0) {
  console.error(`MISSING RATINGS: ${missingRatings} dropped/gated/consumed fields lack dead_text_quality:`);
  for (const d of missingRatingDetails) console.error(`  - ${d}`);
  errors++;
}

if (data.passthrough_inventory) {
  console.log(`Passthrough locations: ${data.passthrough_inventory.locations.length}`);
  const totalLeaks = data.passthrough_inventory.locations.reduce(
    (sum, loc) => sum + (loc.undeclared_fields_reaching_api || loc.undeclared_survivors || []).length, 0
  );
  console.log(`Undeclared fields reaching API: ${totalLeaks}`);
}

console.log('');
if (errors === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.error(`${errors} ERROR(S) FOUND`);
  process.exit(1);
}
