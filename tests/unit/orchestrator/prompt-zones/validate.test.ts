import { describe, it, expect } from 'vitest';
import { validateAssembly } from '../../../../src/orchestrator/prompt-zones/validate.js';
import { assembleFullPrompt, BUDGET_MAX_CHARS } from '../../../../src/orchestrator/prompt-zones/assemble.js';
import { ZONE2_BLOCKS } from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';
import type { TurnContext } from '../../../../src/orchestrator/prompt-zones/zone2-blocks.js';
import type { AssembledPrompt } from '../../../../src/orchestrator/prompt-zones/assemble.js';

const ZONE1 = 'Zone 1 test content';

function makeCtx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    stage: 'frame',
    goal: undefined,
    constraints: undefined,
    options: undefined,
    graphCompact: null,
    analysisSummary: null,
    eventLogSummary: '',
    messages: [],
    selectedElements: [],
    bilContext: undefined,
    bilEnabled: false,
    hasGraph: false,
    hasAnalysis: false,
    generateModel: false,
    ...overrides,
  };
}

function makeCleanAssembled(): AssembledPrompt {
  const ctx = makeCtx({ messages: [{ role: 'user', content: 'Hello' }] });
  return assembleFullPrompt(ZONE1, 'cf-v9', ctx);
}

describe('validateAssembly', () => {
  it('clean assembly produces no warnings', () => {
    const assembled = makeCleanAssembled();
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    expect(warnings).toEqual([]);
  });

  it('detects banned term in Zone 2', () => {
    const assembled = makeCleanAssembled();
    // Inject a banned term into the system prompt (after Zone 1)
    assembled.system_prompt = ZONE1 + '\n\ncanonical_state is referenced here';
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const banned = warnings.filter((w) => w.code === 'BANNED_TERM');
    expect(banned.length).toBeGreaterThan(0);
    expect(banned[0].severity).toBe('warn');
  });

  it('detects tool instruction in Zone 2', () => {
    const assembled = makeCleanAssembled();
    assembled.system_prompt = ZONE1 + '\n\nPlease select tool for this operation';
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const toolInstr = warnings.filter((w) => w.code === 'TOOL_INSTRUCTION');
    expect(toolInstr.length).toBeGreaterThan(0);
  });

  it('detects duplicate block names', () => {
    const assembled = makeCleanAssembled();
    assembled.active_blocks = [
      { name: 'stage_context', version: '1.0.0', owner: 'orchestrator', chars_rendered: 10 },
      { name: 'stage_context', version: '1.0.0', owner: 'orchestrator', chars_rendered: 10 },
    ];
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const dups = warnings.filter((w) => w.code === 'DUPLICATE_BLOCK');
    expect(dups.length).toBe(1);
    expect(dups[0].severity).toBe('error');
  });

  it('warns at budget warning threshold', () => {
    const assembled = makeCleanAssembled();
    assembled.total_chars = Math.floor(BUDGET_MAX_CHARS * 0.85);
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const budget = warnings.filter((w) => w.code === 'BUDGET_WARN');
    expect(budget.length).toBe(1);
    expect(budget[0].severity).toBe('warn');
  });

  it('errors at budget error threshold', () => {
    const assembled = makeCleanAssembled();
    assembled.total_chars = Math.floor(BUDGET_MAX_CHARS * 0.96);
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const budget = warnings.filter((w) => w.code === 'BUDGET_ERROR');
    expect(budget.length).toBe(1);
    expect(budget[0].severity).toBe('error');
  });

  it('detects unbalanced XML tags', () => {
    const assembled = makeCleanAssembled();
    assembled.system_prompt = ZONE1 + '\n\n<GRAPH_STATE>\nopen without close';
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    const xml = warnings.filter((w) => w.code === 'XML_UNBALANCED');
    expect(xml.length).toBeGreaterThan(0);
    expect(xml[0].severity).toBe('error');
  });

  it('ValidationWarning has required contract fields', () => {
    const assembled = makeCleanAssembled();
    assembled.system_prompt = ZONE1 + '\n\ncanonical_state leaked';
    const warnings = validateAssembly(assembled, ZONE2_BLOCKS, ZONE1.length);
    for (const w of warnings) {
      expect(w).toHaveProperty('code');
      expect(w).toHaveProperty('block_name');
      expect(w).toHaveProperty('message');
      expect(w).toHaveProperty('severity');
      expect(['warn', 'error']).toContain(w.severity);
    }
  });

  it('never throws', () => {
    const assembled = makeCleanAssembled();
    assembled.system_prompt = '';
    assembled.active_blocks = [];
    assembled.total_chars = 0;
    expect(() => validateAssembly(assembled, ZONE2_BLOCKS, 0)).not.toThrow();
  });
});
