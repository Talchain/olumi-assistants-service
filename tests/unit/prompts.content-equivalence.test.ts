/**
 * Content-equivalence guard for the five PMS-tracked prompts.
 *
 * Each test loads the prompt via the PMS loader (forceDefault, so the
 * registered default is returned) and compares it against the **direct
 * source of truth** for that prompt:
 *
 *   - routing         → on-disk Prompts/v40.txt
 *   - edit_graph      → EDIT_GRAPH_PROMPT_V6 (src/prompts/edit-graph-v6.ts)
 *   - draft_graph     → DRAFT_GRAPH_PROMPT_V187 (src/prompts/defaults-v187.ts)
 *   - decision_review → PROMPT_TEMPLATES.decision_review (src/prompts/defaults.ts)
 *   - repair_graph    → PROMPT_TEMPLATES.repair_graph (src/prompts/defaults.ts)
 *
 * This is the real drift guard — comparing the loader output to the
 * registered defaults registry would be tautological. Comparing to the
 * inline/filesystem source proves the registry pipeline didn't transform
 * or drop content.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  registerAllDefaultPrompts,
  PROMPT_TEMPLATES,
} from '../../src/prompts/defaults.js';
import { EDIT_GRAPH_PROMPT_V6 } from '../../src/prompts/edit-graph-v6.js';
import { getDraftGraphPromptV187 } from '../../src/prompts/defaults-v187.js';
import { loadPrompt } from '../../src/prompts/loader.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

describe('PMS content-equivalence vs direct source of truth', () => {
  it('[routing] PMS loader output equals on-disk Prompts/v40.txt', async () => {
    const onDisk = readFileSync(
      pathResolve(process.cwd(), 'Prompts', 'v40.txt'),
      'utf-8',
    );
    const loaded = await loadPrompt('routing', { forceDefault: true });
    expect(loaded.source).toBe('default');
    expect(sha16(loaded.content)).toBe(sha16(onDisk));
  });

  it('[edit_graph] PMS loader output equals EDIT_GRAPH_PROMPT_V6', async () => {
    const loaded = await loadPrompt('edit_graph', { forceDefault: true });
    expect(loaded.source).toBe('default');
    expect(sha16(loaded.content)).toBe(sha16(EDIT_GRAPH_PROMPT_V6));
  });

  it('[draft_graph] PMS loader output equals getDraftGraphPromptV187() (caps interpolated)', async () => {
    const loaded = await loadPrompt('draft_graph', { forceDefault: true });
    expect(loaded.source).toBe('default');
    expect(sha16(loaded.content)).toBe(sha16(getDraftGraphPromptV187()));
  });

  it('[decision_review] PMS loader output equals PROMPT_TEMPLATES.decision_review', async () => {
    const loaded = await loadPrompt('decision_review', { forceDefault: true });
    expect(loaded.source).toBe('default');
    expect(sha16(loaded.content)).toBe(sha16(PROMPT_TEMPLATES.decision_review));
  });

  it('[repair_graph] PMS loader output equals PROMPT_TEMPLATES.repair_graph', async () => {
    const loaded = await loadPrompt('repair_graph', { forceDefault: true });
    expect(loaded.source).toBe('default');
    expect(sha16(loaded.content)).toBe(sha16(PROMPT_TEMPLATES.repair_graph));
  });
});
