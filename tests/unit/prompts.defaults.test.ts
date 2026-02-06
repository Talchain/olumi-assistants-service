/**
 * Tests for Default Prompt Registry
 *
 * Verifies that:
 * - All expected prompts are registered
 * - Prompts have valid content
 * - Registration is idempotent
 * - Graph caps are properly interpolated
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAllDefaultPrompts,
  PROMPT_TEMPLATES,
  DECISION_REVIEW_PROMPT_VERSION,
} from '../../src/prompts/defaults.js';
import {
  getDefaultPrompts,
  registerDefaultPrompt,
  loadPromptSync,
} from '../../src/prompts/loader.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../../src/config/graphCaps.js';

// Reset loader state between tests
beforeEach(() => {
  // Clear default prompts by re-registering empty (if needed)
  // The loader uses a module-level object, so we need to work with it
});

describe('PROMPT_TEMPLATES', () => {
  it('exports all expected CEE task prompts', () => {
    expect(PROMPT_TEMPLATES).toHaveProperty('draft_graph');
    expect(PROMPT_TEMPLATES).toHaveProperty('suggest_options');
    expect(PROMPT_TEMPLATES).toHaveProperty('repair_graph');
    expect(PROMPT_TEMPLATES).toHaveProperty('clarify_brief');
    expect(PROMPT_TEMPLATES).toHaveProperty('critique_graph');
    expect(PROMPT_TEMPLATES).toHaveProperty('explainer');
    expect(PROMPT_TEMPLATES).toHaveProperty('bias_check');
  });

  it('draft_graph prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.draft_graph;
    expect(prompt).toContain('causal decision graph');
    expect(prompt).toContain('decision');
    expect(prompt).toContain('option');
    expect(prompt).toContain('factor');
    expect(prompt).toContain('outcome');
    expect(prompt).toContain('goal');
    expect(prompt).toContain('JSON');
    // V12 uses hardcoded limits (50/200) for prompt admin compatibility
    // Older versions (v6, v8, v22) use placeholders {{maxNodes}}/{{maxEdges}}
    const hasPlaceholders = prompt.includes('{{maxNodes}}') && prompt.includes('{{maxEdges}}');
    const hasHardcodedLimits = prompt.includes('Maximum 50 nodes') && prompt.includes('Maximum 200 edges');
    // V12.4 uses "max 50 nodes, 200 edges" format
    const hasV12Format = prompt.includes('max 50 nodes') && prompt.includes('200 edges');
    expect(hasPlaceholders || hasHardcodedLimits || hasV12Format).toBe(true);
  });

  it('suggest_options prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.suggest_options;
    expect(prompt).toContain('strategic options');
    expect(prompt).toContain('3-5 distinct');
    expect(prompt).toContain('pros');
    expect(prompt).toContain('cons');
    expect(prompt).toContain('evidence_to_gather');
  });

  it('repair_graph prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.repair_graph;
    expect(prompt).toContain('repair');
    expect(prompt).toContain('violations');
    expect(prompt).toContain('causal decision graphs');
    expect(prompt).toContain('MINIMAL DIFF');
  });

  it('clarify_brief prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.clarify_brief;
    expect(prompt).toContain('clarifying questions');
    expect(prompt).toContain('MCQ-First Rule');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('should_continue');
  });

  it('critique_graph prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.critique_graph;
    expect(prompt).toContain('critiquing');
    expect(prompt).toContain('BLOCKER');
    expect(prompt).toContain('IMPROVEMENT');
    expect(prompt).toContain('OBSERVATION');
    expect(prompt).toContain('overall_quality');
  });

  it('explainer prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.explainer;
    expect(prompt).toContain('explaining');
    expect(prompt).toContain('rationales');
    expect(prompt).toContain('provenance_source');
  });

  it('bias_check prompt contains key instructions', () => {
    const prompt = PROMPT_TEMPLATES.bias_check;
    expect(prompt).toContain('cognitive biases');
    expect(prompt).toContain('Confirmation bias');
    expect(prompt).toContain('Anchoring');
    expect(prompt).toContain('Sunk cost');
  });

  it('all prompts are non-empty strings', () => {
    for (const [_task, prompt] of Object.entries(PROMPT_TEMPLATES)) {
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    }
  });
});

describe('registerAllDefaultPrompts', () => {
  it('registers prompts that can be loaded', () => {
    registerAllDefaultPrompts();

    const defaults = getDefaultPrompts();

    expect(defaults).toHaveProperty('draft_graph');
    expect(defaults).toHaveProperty('suggest_options');
    expect(defaults).toHaveProperty('repair_graph');
    expect(defaults).toHaveProperty('clarify_brief');
    expect(defaults).toHaveProperty('critique_graph');
    expect(defaults).toHaveProperty('explainer');
    expect(defaults).toHaveProperty('bias_check');
  });

  it('interpolates graph caps into draft_graph prompt', () => {
    registerAllDefaultPrompts();

    const defaults = getDefaultPrompts();
    const draftPrompt = defaults.draft_graph;

    expect(draftPrompt).toBeDefined();
    expect(draftPrompt).toContain(String(GRAPH_MAX_NODES));
    expect(draftPrompt).toContain(String(GRAPH_MAX_EDGES));
    expect(draftPrompt).not.toContain('{{maxNodes}}');
    expect(draftPrompt).not.toContain('{{maxEdges}}');
  });

  it('is idempotent - can be called multiple times safely', () => {
    registerAllDefaultPrompts();
    const defaults1 = { ...getDefaultPrompts() };

    registerAllDefaultPrompts();
    const defaults2 = getDefaultPrompts();

    expect(defaults1).toEqual(defaults2);
  });

  it('allows prompts to be loaded with loadPromptSync', () => {
    registerAllDefaultPrompts();

    // Should not throw
    const draftPrompt = loadPromptSync('draft_graph');
    expect(typeof draftPrompt).toBe('string');
    expect(draftPrompt.length).toBeGreaterThan(0);

    const suggestPrompt = loadPromptSync('suggest_options');
    expect(typeof suggestPrompt).toBe('string');
    expect(suggestPrompt.length).toBeGreaterThan(0);
  });
});

describe('Prompt Content Quality', () => {
  beforeEach(() => {
    registerAllDefaultPrompts();
  });

  it('all prompts end with JSON-related instruction', () => {
    const defaults = getDefaultPrompts();

    for (const [_task, prompt] of Object.entries(defaults)) {
      if (!prompt) continue;
      // All prompts should end with JSON output guidance
      expect(prompt.toLowerCase()).toContain('json');
    }
  });

  it('draft_graph includes all valid node kinds', () => {
    const defaults = getDefaultPrompts();
    const prompt = defaults.draft_graph ?? '';

    // v4 uses factor instead of action, and explicitly notes action is not used in PoC
    const requiredKinds = ['goal', 'decision', 'option', 'outcome', 'risk', 'factor'];
    for (const kind of requiredKinds) {
      expect(prompt).toContain(kind);
    }
  });

  it('critique_graph includes all severity levels', () => {
    const defaults = getDefaultPrompts();
    const prompt = defaults.critique_graph ?? '';

    const requiredLevels = ['BLOCKER', 'IMPROVEMENT', 'OBSERVATION'];
    for (const level of requiredLevels) {
      expect(prompt).toContain(level);
    }
  });

  it('clarify_brief includes confidence and continuation guidance', () => {
    const defaults = getDefaultPrompts();
    const prompt = defaults.clarify_brief ?? '';

    expect(prompt).toContain('confidence');
    expect(prompt).toContain('0.0-1.0');
    expect(prompt).toContain('should_continue');
    expect(prompt).toContain('≥0.8');
  });
});

describe('Integration with Loader', () => {
  it('registerDefaultPrompt overwrites existing prompts', () => {
    // Register defaults
    registerAllDefaultPrompts();

    // Overwrite with custom prompt
    const customPrompt = 'Custom test prompt for draft_graph';
    registerDefaultPrompt('draft_graph', customPrompt);

    const loaded = loadPromptSync('draft_graph');
    expect(loaded).toBe(customPrompt);
  });

  it('throws when loading unregistered task', () => {
    registerAllDefaultPrompts();

    // Try to load a task that doesn't have a default
    expect(() => loadPromptSync('evidence_helper' as any)).toThrow('No default prompt');
  });
});

describe('Decision Review Fallback Prompt (v6)', () => {
  beforeEach(() => {
    registerAllDefaultPrompts();
  });

  it('exports DECISION_REVIEW_PROMPT_VERSION as v6', () => {
    expect(DECISION_REVIEW_PROMPT_VERSION).toBe('v6');
  });

  it('decision_review prompt is registered', () => {
    const defaults = getDefaultPrompts();
    expect(defaults).toHaveProperty('decision_review');
    expect(defaults.decision_review).toBeDefined();
    expect(typeof defaults.decision_review).toBe('string');
    expect(defaults.decision_review!.length).toBeGreaterThan(1000);
  });

  it('decision_review prompt can be loaded with loadPromptSync', () => {
    const prompt = loadPromptSync('decision_review');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('decision_review prompt contains required structural sections', () => {
    const prompt = loadPromptSync('decision_review');

    // Required XML-style sections from v6
    expect(prompt).toContain('<ROLE>');
    expect(prompt).toContain('</ROLE>');
    expect(prompt).toContain('<INPUT_FIELDS>');
    expect(prompt).toContain('</INPUT_FIELDS>');
    expect(prompt).toContain('<CONSTRUCTION_FLOW>');
    expect(prompt).toContain('</CONSTRUCTION_FLOW>');
    expect(prompt).toContain('<GROUNDING_RULES>');
    expect(prompt).toContain('</GROUNDING_RULES>');
    expect(prompt).toContain('<FIELD_SPECIFICATIONS>');
    expect(prompt).toContain('</FIELD_SPECIFICATIONS>');
    expect(prompt).toContain('<OUTPUT_SCHEMA>');
    expect(prompt).toContain('</OUTPUT_SCHEMA>');
    expect(prompt).toContain('<VALIDATION>');
    expect(prompt).toContain('</VALIDATION>');
  });

  it('decision_review prompt contains required output field definitions', () => {
    const prompt = loadPromptSync('decision_review');

    // Required output fields per M2 schema
    const requiredFields = [
      'narrative_summary',
      'story_headlines',
      'robustness_explanation',
      'readiness_rationale',
      'evidence_enhancements',
      'scenario_contexts',
      'flip_thresholds',
      'bias_findings',
      'key_assumptions',
      'decision_quality_prompts',
    ];

    for (const field of requiredFields) {
      expect(prompt).toContain(field);
    }
  });

  it('decision_review prompt contains grounding rules for numbers', () => {
    const prompt = loadPromptSync('decision_review');

    // Key grounding constraints from v6
    expect(prompt).toContain('Descriptive fields');
    expect(prompt).toContain('Prescriptive fields');
    expect(prompt).toContain('±10%');
    expect(prompt).toContain('Do NOT invent statistics');
    expect(prompt).toContain('Do NOT compute derived numbers');
  });

  it('decision_review prompt contains tone alignment table', () => {
    const prompt = loadPromptSync('decision_review');

    // Readiness levels and their tones
    expect(prompt).toContain('readiness');
    expect(prompt).toContain('headline_type');
    expect(prompt).toContain('ready');
    expect(prompt).toContain('close_call');
    expect(prompt).toContain('needs_evidence');
    expect(prompt).toContain('needs_framing');
    expect(prompt).toContain('Forbidden phrases');
  });

  it('decision_review prompt contains bias detection guidance', () => {
    const prompt = loadPromptSync('decision_review');

    // Bias types
    expect(prompt).toContain('STRUCTURAL');
    expect(prompt).toContain('SEMANTIC');
    expect(prompt).toContain('ANCHORING');
    expect(prompt).toContain('DOMINANT_FACTOR');
    expect(prompt).toContain('SUNK_COST');
    expect(prompt).toContain('linked_critique_code');
    expect(prompt).toContain('brief_evidence');
  });

  it('decision_review prompt contains validation error documentation', () => {
    const prompt = loadPromptSync('decision_review');

    // Validation section documents server-side checks
    expect(prompt).toContain('ERRORS (cause rejection)');
    expect(prompt).toContain('story_headlines missing');
    expect(prompt).toContain('Ungrounded number');
    expect(prompt).toContain('Readiness contradiction');
  });

  it('decision_review prompt requests JSON-only output', () => {
    const prompt = loadPromptSync('decision_review');

    expect(prompt).toContain('Return ONLY a JSON object');
    expect(prompt).toContain('No markdown fences');
  });
});
