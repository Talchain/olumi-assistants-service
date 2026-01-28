/**
 * Prompt Diagnostic Script
 *
 * Captures and outputs the full LLM prompt being sent to the /draft-graph endpoint.
 * This is for diagnostic purposes to analyze why graph generation rules aren't being followed.
 *
 * Usage: LLM_PROVIDER=fixtures pnpm exec tsx scripts/prompt-diagnostic.ts
 */

import { registerAllDefaultPrompts } from '../src/prompts/defaults.js';
import { loadPromptSync } from '../src/prompts/loader.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../src/config/graphCaps.js';

// Test brief from the diagnostic request
const TEST_BRIEF = `Given our goal of reaching £20k MRR within 12 months while keeping monthly logo churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?`;

// Register default prompts
registerAllDefaultPrompts();

// Load the draft_graph system prompt with variable interpolation
const systemPrompt = loadPromptSync('draft_graph', {
  maxNodes: GRAPH_MAX_NODES,
  maxEdges: GRAPH_MAX_EDGES,
});

// Load the repair_graph system prompt
const repairPrompt = loadPromptSync('repair_graph', {});

console.log('='.repeat(80));
console.log('CEE PROMPT DIAGNOSTIC');
console.log('='.repeat(80));
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Brief: ${TEST_BRIEF}`);
console.log();

console.log('='.repeat(80));
console.log('SYSTEM PROMPT (draft_graph)');
console.log('='.repeat(80));
console.log(systemPrompt);
console.log();

console.log('='.repeat(80));
console.log('USER PROMPT (constructed)');
console.log('='.repeat(80));
console.log(`## Brief\n${TEST_BRIEF}`);
console.log();

console.log('='.repeat(80));
console.log('REPAIR PROMPT');
console.log('='.repeat(80));
console.log(repairPrompt);
console.log();

console.log('='.repeat(80));
console.log('MODEL CONFIGURATION');
console.log('='.repeat(80));
console.log(`- Default Provider: openai (from config/index.ts, LLM_PROVIDER env override)`);
console.log(`- draft_graph Model: gpt-4o (from model-routing.ts TASK_MODEL_DEFAULTS)`);
console.log(`- repair_graph Model: gpt-4o (same as draft)`);
console.log(`- If LLM_PROVIDER=anthropic: claude-3-5-sonnet-20241022`);
console.log(`- Temperature: 0 (implicit, not set)`);
console.log(`- Max Tokens: 4096 (default)`);
console.log(`- Max Nodes: ${GRAPH_MAX_NODES}`);
console.log(`- Max Edges: ${GRAPH_MAX_EDGES}`);
console.log();

// Analysis: Check for key rules in the prompt
console.log('='.repeat(80));
console.log('RULE PRESENCE ANALYSIS');
console.log('='.repeat(80));

const ruleChecks = [
  {
    name: 'Factor→Decision prohibition',
    patterns: ['factor → decision', 'factor→decision', 'factor to decision'],
    found: false,
  },
  {
    name: 'Factor→Option prohibition',
    patterns: ['factor → option', 'factor→option', 'factor to option'],
    found: false,
  },
  {
    name: 'Factor connects to outcomes/risks only',
    patterns: ['factor → outcome', 'factor → risk', 'factors influence outcomes'],
    found: false,
  },
  {
    name: 'Goal is terminal sink',
    patterns: ['goal.*sink', 'goal.*terminal', 'no.*outgoing.*goal', 'edges flow INTO'],
    found: false,
  },
  {
    name: 'Connectivity check (option→goal path)',
    patterns: ['option.*path.*goal', 'path TO the goal'],
    found: false,
  },
  {
    name: 'No factor→decision edges check',
    patterns: ['No factor→decision edges', 'factor→decision edges exist'],
    found: false,
  },
];

for (const check of ruleChecks) {
  for (const pattern of check.patterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(systemPrompt)) {
      check.found = true;
      break;
    }
  }
  const status = check.found ? '✅ PRESENT' : '❌ MISSING';
  console.log(`${status}: ${check.name}`);
}

console.log();
console.log('='.repeat(80));
console.log('KEY SECTIONS EXTRACTION');
console.log('='.repeat(80));

// Extract and highlight the WRONG direction section
const wrongDirectionMatch = systemPrompt.match(/### WRONG Direction.*?(?=\n###|\n##|$)/s);
if (wrongDirectionMatch) {
  console.log('### WRONG Direction Section:');
  console.log(wrongDirectionMatch[0]);
  console.log();
}

// Extract the connectivity checks section
const connectivityMatch = systemPrompt.match(/### Connectivity Checks.*?(?=\n⚠️|\n##|$)/s);
if (connectivityMatch) {
  console.log('### Connectivity Checks Section:');
  console.log(connectivityMatch[0]);
  console.log();
}

// Extract the edge direction rules table
const edgeRulesMatch = systemPrompt.match(/### Edge Direction Rules.*?(?=\n###|\n##|$)/s);
if (edgeRulesMatch) {
  console.log('### Edge Direction Rules Section:');
  console.log(edgeRulesMatch[0]);
  console.log();
}

console.log('='.repeat(80));
console.log('END OF DIAGNOSTIC');
console.log('='.repeat(80));
